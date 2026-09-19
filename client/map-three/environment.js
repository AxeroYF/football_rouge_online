import * as THREE from "three";
import { mapAssetUrl } from "../../shared/config/map-assets.mjs";
import { shoreBandGeometry } from "./shore.js";
import { LAND_STENCIL_BIT } from "./settings.js";
import { RELIEF_SHEAR, subdivideReliefPath } from "./relief-field.js";

export function decodeSnowMask(snow) {
  const length = snow.width * snow.height;
  if (!Number.isSafeInteger(length) || snow.width < 1 || snow.height < 1 || length > 16000000) throw new Error("Invalid snow mask dimensions");
  const bytes = Uint8Array.from(atob(snow.rle), (c) => c.charCodeAt(0));
  if (bytes.length % 3) throw new Error("Invalid snow mask encoding");
  const pixels = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const run = bytes[i] | (bytes[i + 1] << 8);
    if (!run || offset + run > length) throw new Error("Snow mask overflow");
    pixels.fill(bytes[i + 2], offset, offset + run);
    offset += run;
  }
  if (offset !== length) throw new Error("Snow mask truncated");
  return pixels;
}

export function environmentVisibility(pixelsPerUnit) {
  const smooth = (a, b) => {
    const t = THREE.MathUtils.clamp((pixelsPerUnit - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  return { majorRiver: 0.38 + smooth(2, 7) * 0.42, minorRiver: smooth(6, 15) * 0.65 };
}

function applySnow(material, mask, visibility) {
  if (!mask || material.userData.environmentSnow) return;
  material.userData.environmentSnow = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      environmentSnow: { value: mask.texture }, environmentSnowOrigin: { value: mask.origin },
      environmentSnowExtent: { value: mask.extent }, environmentSnowTint: { value: new THREE.Color("#e0e8dc") },
      environmentSnowVisible: visibility,
    });
    shader.vertexShader = "varying vec2 vEnvironmentPosition;\n"
      + (material.userData.reliefSurface ? "attribute vec2 reliefMapPosition;\n" : "") + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvEnvironmentPosition = "
        + (material.userData.reliefSurface ? "reliefMapPosition;" : "(modelMatrix * vec4(position, 1.0)).xz;"));
    shader.fragmentShader = "varying vec2 vEnvironmentPosition;\nuniform sampler2D environmentSnow;\n"
      + "uniform vec2 environmentSnowOrigin;\nuniform vec2 environmentSnowExtent;\nuniform vec3 environmentSnowTint;\nuniform float environmentSnowVisible;\n"
      + shader.fragmentShader;
    // Run after the pale-green grade, before physical lighting. Keep luminance
    // variation from the actual DEM shade, rather than white polygons on top.
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>",
      "vec2 snowUv = (vEnvironmentPosition - environmentSnowOrigin) / environmentSnowExtent;\n"
      + "float insideSnow = step(0.0, snowUv.x) * step(0.0, snowUv.y) * step(snowUv.x, 1.0) * step(snowUv.y, 1.0);\n"
      + "float snowCover = texture2D(environmentSnow, snowUv).r * insideSnow * environmentSnowVisible;\n"
      + "float snowShade = clamp(0.42 + dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) * 2.8, 0.42, 1.0);\n"
      + "diffuseColor.rgb = mix(diffuseColor.rgb, environmentSnowTint * snowShade, snowCover * 0.90);\n"
      + "#include <roughnessmap_fragment>");
  };
  material.customProgramCacheKey = () => previousKey() + "-snow-toggle-v3";
  material.needsUpdate = true;
}

export class MapEnvironment {
  constructor(data, { height = 1.1, surface = null } = {}) {
    if (data.schemaVersion !== 1 || !data.regions) throw new Error("Unsupported map environment data");
    this.group = new THREE.Group();
    this.group.name = "map-environment";
    this.masks = new Map();
    this.riverMeshes = [];
    this.snowVisibility = { value: 1 };
    this.disposed = false;
    this.surface = surface;
    for (const [region, contents] of Object.entries(data.regions)) {
      const snow = contents.snow;
      const texture = new THREE.DataTexture(decodeSnowMask(snow), snow.width, snow.height, THREE.RedFormat);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      this.masks.set(region, {
        texture,
        // Data pixels encode grid nodes; adjust half a texel to align samples.
        origin: new THREE.Vector2(snow.origin[0] - snow.step / 2, snow.origin[1] - snow.step / 2),
        extent: new THREE.Vector2(snow.width * snow.step, snow.height * snow.step),
      });
      for (const major of [true, false]) {
        const paths = contents.rivers.filter((river) => (river.rank <= 3) === major)
          .map((river) => {
            const points = river.points.map(([x, z]) => ({ x, z }));
            return surface ? subdivideReliefPath(points) : points;
          });
        if (!paths.length) continue;
        const geometry = shoreBandGeometry(paths, major ? .038 : .022);
        const material = new THREE.MeshBasicMaterial({
          color: major ? "#4e8798" : "#61929c", transparent: true, opacity: 0,
          side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false, toneMapped: false,
          // Land bit + a private river bit: clip to land and union overlaps.
          stencilWrite: true, stencilRef: LAND_STENCIL_BIT,
          stencilFuncMask: LAND_STENCIL_BIT | 8, stencilWriteMask: 8,
          stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.InvertStencilOp,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = .06; mesh.renderOrder = 10;
        this.riverMeshes.push({ mesh, major }); this.group.add(mesh);
      }
    }
    this.setHeight(height);
    if (surface) this.setSurface(surface);
  }
  setSurface(surface) {
    this.surface = surface;
    for (const {mesh} of this.riverMeshes) {
      const geometry = mesh.geometry, position = geometry.attributes.position;
      geometry.userData.flatRiverPositions ??= position.array.slice();
      const original = geometry.userData.flatRiverPositions;
      for (let i=0;i<position.count;i++) {
        const x=original[i*3], z=original[i*3+2], h=surface?.sample(x,z) ?? 0;
        position.setXYZ(i,x,original[i*3+1]+h,z+(surface ? RELIEF_SHEAR*(h+mesh.position.y) : 0));
      }
      position.needsUpdate = true; geometry.computeBoundingSphere();
    }
  }
  applyTo(material, region) { applySnow(material, this.masks.get(region), this.snowVisibility); }
  setRiversVisible(visible) { this.group.visible = Boolean(visible); }
  setSnowVisible(visible) { this.snowVisibility.value = visible ? 1 : 0; }
  update(pixelsPerUnit) {
    const lod = environmentVisibility(pixelsPerUnit);
    for (const { mesh, major } of this.riverMeshes) {
      mesh.material.opacity = major ? lod.majorRiver : lod.minorRiver;
      mesh.visible = mesh.material.opacity > .01;
    }
  }
  setHeight(height) { this.group.position.y = height; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const { texture } of this.masks.values()) texture.dispose();
    for (const { mesh } of this.riverMeshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.group.clear();
  }
}

export async function loadMapEnvironment({ signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(mapAssetUrl("./assets/data/map-environment.json"), { signal, cache: "default" });
  if (!response.ok) throw new Error("河流与雪线资源读取失败");
  return response.json();
}

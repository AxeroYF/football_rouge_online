import * as THREE from "three";

export const ATLAS_VERSION = "20260908-pre-civ-visual-v1";
export const ATLAS_LIGHTING = Object.freeze({
  sunColor: "#fff0ce", sunIntensity: 2.1,
  skyColor: "#dae9ee", groundColor: "#535c39", ambientIntensity: 1.65, shadowIntensity: .62,
});
export const ATLAS_PALETTE = Object.freeze({
  sea: "#174b66", grass: "#71834f", meadow: "#929d61", rock: "#978974",
  summit: "#c6c4b3", outerShore: "#287d91", innerShore: "#78b6aa",
});
const grass = new THREE.Color(ATLAS_PALETTE.grass), meadow = new THREE.Color(ATLAS_PALETTE.meadow);
const rock = new THREE.Color(ATLAS_PALETTE.rock), summit = new THREE.Color(ATLAS_PALETTE.summit);
export const smooth = (a, b, value) => { const t = THREE.MathUtils.clamp((value-a)/(b-a),0,1); return t*t*(3-2*t); };

// Large color masses keep a strategy map readable. The deterministic variation
// follows map coordinates and never changes when chunks/LODs are reconstructed.
export function atlasColor(metres, slope, x, z, valley = 0) {
  const variation = .5 + .25*Math.sin(x*.42+Math.sin(z*.24)) + .25*Math.sin(z*.37-x*.12);
  const color = grass.clone().lerp(meadow, variation*.58);
  color.lerp(rock, Math.max(smooth(900,2600,metres)*.82, smooth(.35,1.7,slope)*.8));
  color.lerp(summit,smooth(2600,4800,metres)*.65);
  return color.multiplyScalar(1-Math.min(.16,Math.max(0,valley)*.15));
}

export const atlasWaterHeight = thickness => Math.max(0, thickness - .28);

export function createAtlasOcean(thickness = 1.1) {
  const material = new THREE.MeshStandardMaterial({color:ATLAS_PALETTE.sea,roughness:.92,metalness:0,toneMapped:false});
  material.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec2 vAtlasSea;\n"+shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvAtlasSea = position.xy;");
    shader.fragmentShader = "varying vec2 vAtlasSea;\n"+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\nfloat waves = sin(vAtlasSea.x*2.1+sin(vAtlasSea.y*.8))*sin(vAtlasSea.y*3.4);\ndiffuseColor.rgb *= .99 + .018*waves;");
  };
  material.customProgramCacheKey = () => "atlas-ocean-v1";
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),material);
  mesh.rotation.x = -Math.PI/2; mesh.receiveShadow = true;
  mesh.position.y = atlasWaterHeight(thickness);
  mesh.userData.setThickness = height => { mesh.position.y = atlasWaterHeight(height); };
  return mesh;
}

import * as THREE from "three";

const canvas = document.querySelector("#trophy-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:"high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0c0f12, 0.035);

const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
const cameraTarget = new THREE.Vector3(0, 3.25, 0);
const defaultOrbit = { theta:0.28, phi:1.48, radius:12.8 };
let orbit = { ...defaultOrbit, radius:window.innerWidth < 680 ? 15.6 : defaultOrbit.radius };

const silver = new THREE.MeshPhysicalMaterial({ color:0xe9edf0, metalness:.58, roughness:.19, clearcoat:.68, clearcoatRoughness:.12 });
const silverDark = new THREE.MeshPhysicalMaterial({ color:0x8d979d, metalness:.62, roughness:.24, clearcoat:.35 });
const gold = new THREE.MeshPhysicalMaterial({ color:0xd6a638, metalness:.92, roughness:.2, clearcoat:.35 });
const obsidian = new THREE.MeshPhysicalMaterial({ color:0x101417, metalness:.5, roughness:.22, clearcoat:.72, clearcoatRoughness:.16 });
const stone = new THREE.MeshStandardMaterial({ color:0x202428, metalness:.2, roughness:.48 });

function mesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

const trophy = new THREE.Group();
scene.add(trophy);

// A compact architectural base keeps the silhouette readable at honour-room scale.
trophy.add(mesh(new THREE.CylinderGeometry(1.55, 1.72, .34, 64), obsidian, [0, .17, 0]));
trophy.add(mesh(new THREE.CylinderGeometry(1.42, 1.5, .25, 64), gold, [0, .44, 0]));
trophy.add(mesh(new THREE.CylinderGeometry(1.33, 1.42, .64, 64), stone, [0, .87, 0]));
trophy.add(mesh(new THREE.CylinderGeometry(1.38, 1.38, .08, 64), silverDark, [0, 1.23, 0]));
trophy.add(mesh(new THREE.CylinderGeometry(.6, .86, .34, 48), silver, [0, 1.43, 0]));
trophy.add(mesh(new THREE.CylinderGeometry(.37, .5, .78, 48), silver, [0, 1.95, 0]));
trophy.add(mesh(new THREE.TorusGeometry(.48, .075, 18, 64), gold, [0, 2.28, 0], [Math.PI / 2, 0, 0]));

const cupProfile = [
  [.42, 0], [.5, .12], [.66, .32], [.9, .72], [1.2, 1.08], [1.46, 1.34],
  [1.58, 1.58], [1.61, 1.88], [1.56, 2.1], [1.5, 2.2],
].map(([x, y]) => new THREE.Vector2(x, y));
const cup = mesh(new THREE.LatheGeometry(cupProfile, 96), silver, [0, 2.22, 0]);
trophy.add(cup);
trophy.add(mesh(new THREE.TorusGeometry(1.53, .105, 24, 96), silver, [0, 4.43, 0], [Math.PI / 2, 0, 0]));
trophy.add(mesh(new THREE.TorusGeometry(1.42, .035, 12, 96), gold, [0, 4.47, 0], [Math.PI / 2, 0, 0]));

const inner = mesh(new THREE.CylinderGeometry(1.43, .54, .62, 64, 1, true), new THREE.MeshStandardMaterial({ color:0x11161a, metalness:.7, roughness:.3, side:THREE.BackSide }), [0, 4.15, 0]);
trophy.add(inner);

function handle(side) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 1.42, 3.05, 0),
    new THREE.Vector3(side * 2.05, 3.28, 0),
    new THREE.Vector3(side * 2.34, 4.08, 0),
    new THREE.Vector3(side * 2.13, 4.82, 0),
    new THREE.Vector3(side * 1.58, 4.92, 0),
  ]);
  const outer = mesh(new THREE.TubeGeometry(curve, 80, .105, 16, false), silver);
  trophy.add(outer);
  const goldCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 1.53, 3.23, .02),
    new THREE.Vector3(side * 2.0, 3.52, .02),
    new THREE.Vector3(side * 2.13, 4.13, .02),
  ]);
  trophy.add(mesh(new THREE.TubeGeometry(goldCurve, 40, .035, 10, false), gold));
  trophy.add(mesh(new THREE.SphereGeometry(.16, 24, 16), gold, [side * 1.55, 4.91, 0]));
}
handle(-1);
handle(1);

const crown = new THREE.Group();
crown.position.y = 4.5;
crown.add(mesh(new THREE.CylinderGeometry(.77, .84, .22, 64), gold, [0, .1, 0]));
crown.add(mesh(new THREE.TorusGeometry(.82, .065, 16, 64), gold, [0, .21, 0], [Math.PI / 2, 0, 0]));
for (let index = 0; index < 8; index += 1) {
  const angle = index / 8 * Math.PI * 2;
  const spike = mesh(new THREE.ConeGeometry(.12, .72, 16), gold, [Math.cos(angle) * .69, .55, Math.sin(angle) * .69]);
  spike.rotation.z = -Math.cos(angle) * .18;
  spike.rotation.x = Math.sin(angle) * .18;
  crown.add(spike);
  crown.add(mesh(new THREE.SphereGeometry(.075, 16, 12), gold, [Math.cos(angle) * .75, .94, Math.sin(angle) * .75]));
}
crown.add(mesh(new THREE.SphereGeometry(.13, 24, 16), gold, [0, 1.0, 0]));
trophy.add(crown);

function plaqueTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 768;
  textureCanvas.height = 320;
  const context = textureCanvas.getContext("2d");
  context.fillStyle = "#d1a743";
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.strokeStyle = "#755516";
  context.lineWidth = 10;
  context.strokeRect(22, 22, 724, 276);
  context.fillStyle = "#151719";
  context.textAlign = "center";
  context.font = "700 52px Arial";
  context.fillText("YELLOWDOGS LEAGUE", 384, 126);
  context.font = "500 34px Arial";
  context.fillText("CHAMPIONS", 384, 184);
  context.font = "22px Arial";
  context.letterSpacing = "8px";
  context.fillText("EST. 2026", 384, 242);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

const plaque = mesh(new THREE.BoxGeometry(1.64, .66, .055), [
  gold, gold, gold, gold,
  new THREE.MeshStandardMaterial({ map:plaqueTexture(), metalness:.7, roughness:.28 }),
  gold,
], [0, .88, 1.47]);
trophy.add(plaque);

function ribbonGeometry(side, zOffset, sway) {
  const points = [
    new THREE.Vector3(side * 1.72, 4.78, zOffset),
    new THREE.Vector3(side * 1.9, 4.2, zOffset + sway),
    new THREE.Vector3(side * 1.72, 3.45, zOffset - sway * .6),
    new THREE.Vector3(side * 1.88, 2.72, zOffset + sway * .45),
    new THREE.Vector3(side * 1.66, 2.1, zOffset),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const segments = 44;
  const width = .25;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const across = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(width);
    positions.push(point.x + across.x, point.y + across.y, point.z + across.z);
    positions.push(point.x - across.x, point.y - across.y, point.z - across.z);
    uvs.push(0, t, 1, t);
    if (index < segments) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const ribbonPalettes = {
  royal:[0x164caf, 0xeee9dc],
  crimson:[0xa6172a, 0xd5a93e],
  noir:[0x17191c, 0xc1a360],
};
const ribbons = [];
[-1, 1].forEach((side) => {
  [0, 1].forEach((layer) => {
    const material = new THREE.MeshPhysicalMaterial({ color:ribbonPalettes.royal[layer], roughness:.72, sheen:1, sheenColor:0xffffff, side:THREE.DoubleSide });
    const ribbon = mesh(ribbonGeometry(side, layer ? -.16 : .16, side * (layer ? -.08 : .08)), material);
    ribbon.castShadow = false;
    ribbon.userData.paletteIndex = layer;
    trophy.add(ribbon);
    ribbons.push(ribbon);
  });
});

const floor = mesh(new THREE.CircleGeometry(8, 96), new THREE.MeshStandardMaterial({ color:0x0c0f12, roughness:.78, metalness:.1 }), [0, -.01, 0], [-Math.PI / 2, 0, 0]);
floor.receiveShadow = true;
scene.add(floor);
const halo = mesh(new THREE.RingGeometry(2.15, 2.18, 96), new THREE.MeshBasicMaterial({ color:0xd5a93e, transparent:true, opacity:.24, side:THREE.DoubleSide }), [0, .012, 0], [-Math.PI / 2, 0, 0]);
scene.add(halo);

scene.add(new THREE.HemisphereLight(0xbfd5e5, 0x19120a, 1.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 5.4);
keyLight.position.set(5, 9, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -5;
keyLight.shadow.camera.right = 5;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -2;
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x4d83ff, 55, 14, 2);
rimLight.position.set(-5, 4.5, -2);
scene.add(rimLight);
const goldLight = new THREE.PointLight(0xffbf55, 34, 10, 2);
goldLight.position.set(4, 2.5, 3);
scene.add(goldLight);
const frontFill = new THREE.PointLight(0xe8f3ff, 42, 15, 2);
frontFill.position.set(-1.5, 5.5, 8);
scene.add(frontFill);

let autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let pointer = null;
let lastFrame = performance.now();
let pixelCheckComplete = false;

function updateCamera() {
  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    cameraTarget.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
    cameraTarget.y + orbit.radius * Math.cos(orbit.phi),
    cameraTarget.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
  );
  camera.lookAt(cameraTarget);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.fov = width < 680 ? 42 : 31;
  camera.updateProjectionMatrix();
}

canvas.addEventListener("pointerdown", (event) => {
  pointer = { id:event.pointerId, x:event.clientX, y:event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  orbit.theta -= (event.clientX - pointer.x) * .006;
  orbit.phi = THREE.MathUtils.clamp(orbit.phi + (event.clientY - pointer.y) * .005, .72, 2.06);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});
canvas.addEventListener("pointerup", () => { pointer = null; });
canvas.addEventListener("pointercancel", () => { pointer = null; });
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  orbit.radius = THREE.MathUtils.clamp(orbit.radius + event.deltaY * .008, 8.8, 18);
}, { passive:false });

document.querySelector("#toggle-rotation").addEventListener("click", (event) => {
  autoRotate = !autoRotate;
  event.currentTarget.textContent = autoRotate ? "Ⅱ" : "▶";
  event.currentTarget.setAttribute("aria-label", autoRotate ? "暂停自动旋转" : "开始自动旋转");
  event.currentTarget.title = event.currentTarget.getAttribute("aria-label");
});
document.querySelector("#reset-view").addEventListener("click", () => {
  orbit = { ...defaultOrbit, radius:canvas.clientWidth < 680 ? 15.6 : defaultOrbit.radius };
});
document.querySelectorAll("[data-ribbon]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-ribbon]").forEach((entry) => entry.classList.toggle("active", entry === button));
  ribbons.forEach((ribbon) => ribbon.material.color.setHex(ribbonPalettes[button.dataset.ribbon][ribbon.userData.paletteIndex]));
}));

function render(now) {
  const delta = Math.min(.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (autoRotate && !pointer) orbit.theta += delta * .14;
  updateCamera();
  renderer.render(scene, camera);
  if (!pixelCheckComplete && canvas.width && canvas.height) {
    const context = renderer.getContext();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    let nonBlankSamples = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 45 && pixels[index + 3] > 0) nonBlankSamples += 1;
    }
    canvas.dataset.pixelCheck = nonBlankSamples > 100 ? "pass" : "fail";
    canvas.dataset.nonBlankSamples = String(nonBlankSamples);
    pixelCheckComplete = true;
  }
  window.__YDL_TROPHY_RENDERED__ = true;
  requestAnimationFrame(render);
}

resize();
window.addEventListener("resize", resize);
requestAnimationFrame(render);

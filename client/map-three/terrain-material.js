import * as THREE from "three";
import { MAP_THREE_LAND } from "./settings.js";

// Grade the existing DEM texture in linear space, at every LOD. Changing only
// the land mesh color would be hidden by the almost-opaque terrain tiles.
export function applyTerrainGrade(material, visibility = { value: 1 }) {
  const tint = new THREE.Color(MAP_THREE_LAND.base);
  const tintLuma = tint.r * 0.2126 + tint.g * 0.7152 + tint.b * 0.0722;
  tint.multiplyScalar(1 / tintLuma);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainTint = { value: tint };
    shader.uniforms.terrainSaturation = { value: MAP_THREE_LAND.saturation };
    shader.uniforms.terrainBrightness = { value: MAP_THREE_LAND.brightness };
    shader.uniforms.terrainVisible = visibility;
    shader.uniforms.terrainBase = { value: new THREE.Color(MAP_THREE_LAND.flat) };
    shader.fragmentShader = "uniform vec3 terrainTint;\nuniform float terrainSaturation;\n"
      + "uniform float terrainBrightness;\nuniform float terrainVisible;\nuniform vec3 terrainBase;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\n"
      + "float terrainLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\n"
      + "diffuseColor.rgb = mix(terrainLuma * terrainTint, diffuseColor.rgb, terrainSaturation) * terrainBrightness;\n"
      + "diffuseColor.rgb = mix(terrainBase, diffuseColor.rgb, terrainVisible);");
  };
  material.customProgramCacheKey = () => "campaign-pale-green-toggle-v2";
  return material;
}

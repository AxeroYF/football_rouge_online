// Keep the pre-generalization terrain and its original grade independently addressable.
export const TERRAIN_PROFILES = Object.freeze({
  atlas: Object.freeze({ id: "atlas", label: "风格化地形", version: "20260905-nature-v1" }),
  relief: Object.freeze({ id: "relief", label: "立体地形", version: "20260904-relief-mesh-v1" }),
  soft: Object.freeze({ id: "soft", label: "柔和地形", version: "20260904-soft-relief-v1" }),
  classic: Object.freeze({ id: "classic", label: "原版地形", version: "20260904-deep-olive-relief-v3" }),
});

export function terrainProfile(search = "") {
  const selected = new URLSearchParams(search).get("terrain");
  return Object.hasOwn(TERRAIN_PROFILES, selected) ? selected : "atlas";
}

export function terrainProfileLink(location, profile) {
  const url = new URL(location.href);
  url.searchParams.set("terrain", Object.hasOwn(TERRAIN_PROFILES, profile) ? profile : "atlas");
  // Both terrain versions use Three. The separate Leaflet fallback remains available.
  url.searchParams.delete("renderer");
  return url.pathname + url.search + url.hash;
}

export function setupTerrainProfileLinks(documentRef, location) {
  const current = terrainProfile(location.search);
  for (const link of documentRef.querySelectorAll("[data-terrain-profile]")) {
    const profile = link.dataset.terrainProfile;
    link.href = terrainProfileLink(location, profile);
    if (profile === current && new URLSearchParams(location.search).get("renderer") !== "leaflet") {
      link.setAttribute("aria-current", "true");
    } else link.removeAttribute("aria-current");
  }
  return current;
}

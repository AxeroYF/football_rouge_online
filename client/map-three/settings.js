// One visual profile shared by the live map and the optional material preview.
export const MAP_THREE_SETTINGS = Object.freeze({ pitch: 35, thickness: 1.1, exposure: 1.3 });
// Lift diffuse land lighting without changing the accepted camera/exposure.
export const MAP_THREE_LIGHTING = Object.freeze({
  sunColor: "#ffedc2", sunIntensity: 2.4,
  skyColor: "#e1e7da", groundColor: "#182e2c", ambientIntensity: 1.8,
});
export const MAP_THREE_PALETTE = Object.freeze({
  background: "#071e30", sea: "#082d49",
  outerShore: "#164660", innerShore: "#2b6b83",
});
export const MAP_THREE_LAND = Object.freeze({
  base: "#839765", saturation: 0.58, brightness: 1.65,
  // Separate flat-map ground from the accepted DEM grading tint.
  flat: "#304844",
});
export const LAND_STENCIL_BIT = 4;

// Orthographic north-up view: geographic north/south distances shrink by cos(pitch).
// Using the same CRS for ALL business overlays also preserves inverse hit testing.
export function createTiltedCRS(Leaflet, pitch = MAP_THREE_SETTINGS.pitch) {
  const base = Leaflet.CRS.EPSG3857;
  const coefficient = 0.5 / (Math.PI * base.projection.R);
  return Leaflet.extend({}, base, {
    code: "CAMPAIGN:ORTHOGRAPHIC",
    transformation: new Leaflet.Transformation(
      coefficient, 0.5, -coefficient * Math.cos(pitch * Math.PI / 180), 0.5,
    ),
  });
}

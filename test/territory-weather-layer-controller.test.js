import assert from "node:assert/strict";
import test from "node:test";
import { createTerritoryWeatherLayerController } from "../client/map/territory-weather-layer-controller.js";

const displayTerritories = {
  type:"FeatureCollection",
  features:[
    { type:"Feature", properties:{territoryId:"rain"}, geometry:{type:"Polygon",coordinates:[]} },
    { type:"Feature", properties:{territoryId:"storm"}, geometry:{type:"Polygon",coordinates:[]} },
    { type:"Feature", properties:{territoryId:"clear"}, geometry:{type:"Polygon",coordinates:[]} },
  ],
};

function createHarness() {
  const layers = [];
  const map = {
    hasLayer(layer) { return layers.includes(layer); },
    removeLayer(layer) { layers.splice(layers.indexOf(layer), 1); },
  };
  const renderedStyles = [];
  const Leaflet = {
    geoJSON(data, options) {
      for (const feature of data.features) renderedStyles.push(options.style(feature));
      return { addTo() { layers.push(this); return this; } };
    },
  };
  let snapshot = {
    hourKey:1,
    territories:{
      rain:{type:"rain"},
      storm:{type:"superStorm"},
      clear:{type:"sunny"},
    },
  };
  const controller = createTerritoryWeatherLayerController({
    Leaflet,
    map,
    renderer:{ type:"svg" },
    displayTerritories,
    getWeatherSnapshot:() => snapshot,
  });
  return { controller, layers, renderedStyles, setSnapshot:(value) => { snapshot = value; } };
}

test("weather territory wash stays unloaded by default and is removed when disabled", () => {
  const harness = createHarness();
  assert.equal(harness.controller.isEnabled(), false);
  assert.equal(harness.layers.length, 0);
  assert.equal(harness.renderedStyles.length, 0);
  harness.controller.setEnabled(true);
  assert.equal(harness.layers.length, 1);
  assert.equal(harness.controller.polygonCount(), 3);
  assert.match(harness.renderedStyles[0].className, /territory-weather-fill weather-rain/);
  assert.equal(harness.renderedStyles[0].fillColor, "url(#ydl-weather-rain-pattern)");
  assert.match(harness.renderedStyles[1].className, /weather-superStorm/);
  assert.equal(harness.renderedStyles[1].fillColor, "url(#ydl-weather-super-storm-pattern)");
  assert.equal(harness.renderedStyles[0].interactive, false);
  assert.ok(harness.renderedStyles[0].fillOpacity > 0);
  harness.controller.setEnabled(false);
  assert.equal(harness.layers.length, 0);
  assert.equal(harness.controller.polygonCount(), 0);
});

test("weather territory wash rebuilds only when the hourly snapshot changes", () => {
  const harness = createHarness();
  harness.controller.setEnabled(true);
  const initialLayer = harness.layers[0];
  assert.equal(harness.controller.refresh(), 3);
  assert.equal(harness.layers[0], initialLayer);
  harness.setSnapshot({ hourKey:2, territories:{ rain:{type:"snow"} } });
  assert.equal(harness.controller.refresh(), 3);
  assert.equal(harness.layers.length, 1);
  assert.notEqual(harness.layers[0], initialLayer);
  assert.match(harness.renderedStyles.at(-3).className, /weather-snow/);
  assert.equal(harness.renderedStyles.at(-3).fillColor, "url(#ydl-weather-snow-pattern)");
  assert.match(harness.renderedStyles.at(-2).className, /weather-sunny/);
  harness.controller.destroy();
  assert.equal(harness.layers.length, 0);
});

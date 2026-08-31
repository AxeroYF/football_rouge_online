import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { topology } from "topojson-server";
import { MARITIME_ANGULAR_SECTOR_DEGREES, MARITIME_MAX_RANGE_KM } from "../shared/config/maritime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, "assets", "data");
const collection = JSON.parse(await fs.readFile(path.join(dataDirectory, "campaign-territories.geojson"), "utf8"));
const topo = topology({ territories:collection }, 100000);
const geometries = topo.objects.territories.geometries;
const usage = new Map();

function visitArcIndexes(value, callback) {
  if (Number.isInteger(value)) { callback(value < 0 ? ~value : value); return; }
  if (Array.isArray(value)) value.forEach((child) => visitArcIndexes(child, callback));
}

geometries.forEach((geometry) => visitArcIndexes(geometry.arcs, (index) => usage.set(index, (usage.get(index) ?? 0) + 1)));

function decodedArc(indexValue) {
  const reversed = indexValue < 0;
  const index = reversed ? ~indexValue : indexValue;
  const source = topo.arcs[index] ?? [];
  let x = 0; let y = 0;
  const coordinates = source.map((entry) => {
    if (topo.transform) {
      x += entry[0]; y += entry[1];
      return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]];
    }
    return [entry[0],entry[1]];
  });
  return reversed ? coordinates.reverse() : coordinates;
}

function flattenArcValues(value, result = []) {
  if (Number.isInteger(value)) result.push(value);
  else if (Array.isArray(value)) value.forEach((child) => flattenArcValues(child,result));
  return result;
}


const territories = {};
geometries.forEach((geometry) => {
  const territoryId = geometry.properties?.territoryId;
  const coastlines = flattenArcValues(geometry.arcs)
    .filter((value) => usage.get(value < 0 ? ~value : value) === 1)
    .map((value) => decodedArc(value))
    .filter((points) => points.length >= 2);
  if (!territoryId || !coastlines.length) return;
  territories[territoryId] = { coastlines };
});

const output = { schemaVersion:2, maxRangeKm:MARITIME_MAX_RANGE_KM, angularSectorDegrees:MARITIME_ANGULAR_SECTOR_DEGREES, coastalTerritoryCount:Object.keys(territories).length, territories };
await fs.writeFile(path.join(dataDirectory, "campaign-coastlines.json"), JSON.stringify(output));
console.log(JSON.stringify({ coastalTerritoryCount:output.coastalTerritoryCount }, null, 2));

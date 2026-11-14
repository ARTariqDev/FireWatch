import assert from "node:assert/strict";
import test from "node:test";
import { harmonizeHotspots } from "../lib/harmonization.js";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const HOUR = 3600000;
const km = 180 / (Math.PI * 6371.0088);
const modis = (lon, lat, time = NOW, confidence = "60", satellite = "T") =>
  [lon, lat, 20, 0, time, confidence, satellite];
const viirs = (lon, lat, time = NOW, confidence = "n", satellite = "N20") =>
  [lon, lat, 10, 1, time, confidence, satellite];

test("matches the geodesic distance and time thresholds, keeping actual VIIRS observations", () => {
  const [match] = harmonizeHotspots([modis(0, 0), viirs(km * 0.999, 0, NOW + 4 * HOUR, "h")]);
  assert.equal(match[0], km * 0.999);
  assert.equal(match[2], 10);
  assert.equal(match[5], NOW + 4 * HOUR);
  assert.equal(match[7], 3);
  assert.deepEqual(match[11], [modis(0, 0)]);

  assert.equal(harmonizeHotspots([modis(0, 0), viirs(km * 1.001, 0)]).length, 2);
  assert.equal(harmonizeHotspots([modis(0, 0), viirs(0, 0, NOW + 4 * HOUR + 1)]).length, 2);
  assert.equal(harmonizeHotspots([modis(0, 0), viirs(km * 0.8, km * 0.8)]).length, 2);
});

test("matches across the antimeridian and at high latitudes", () => {
  assert.equal(harmonizeHotspots([modis(179.999, 0), viirs(-179.999, 0)]).length, 1);
  assert.equal(harmonizeHotspots([modis(20, 89), viirs(20.1, 89)])[0][7], 3);
});

test("retains each VIIRS pixel without inventing or merging observations", () => {
  const results = harmonizeHotspots([
    modis(0, 0), viirs(0.001, 0), viirs(-0.001, 0),
    viirs(-0.001, 0), viirs(-0.001, 0, NOW + HOUR),
  ]);
  assert.equal(results.length, 3);
  assert.ok(results.every((point) => point[3] === 1 && point[7] === 3));
  assert.equal(results.flatMap((point) => point[11]).length, 1);
});

test("keeps MODIS-only and unknown-confidence observations without inferring extinction", () => {
  const points = harmonizeHotspots([
    modis(0, 0, NOW - 10 * HOUR, "90"),
    viirs(0.1, 0, NOW, null),
    viirs(1, 0, NOW, "n"),
    viirs(2, 0, NOW, "h"),
  ]);
  assert.deepEqual(points.map((point) => point[7]), [0, 1, 2, 0]);
  assert.ok(points.every((point) => point[6] === null));
  assert.equal(points.find((point) => point[3] === 0)[9], "90");
  assert.equal(points[0][9], null);
});

test("deduplicates exact observations but preserves distinct satellites and times", () => {
  const points = harmonizeHotspots([
    modis(0, 0), modis(0, 0),
    modis(0, 0, NOW, "60", "A"),
    modis(0, 0, NOW + 1),
  ]);
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((point) => point[10]), ["T", "A", "T"]);
  assert.throws(() => harmonizeHotspots([[0, 0, 1, 0, undefined]]), /Invalid FIRMS observation/);
});

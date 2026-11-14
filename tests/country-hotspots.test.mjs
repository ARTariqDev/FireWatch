import assert from "node:assert/strict";
import test from "node:test";
import { findCountry, isInsideCountry, queryBbox } from "../lib/countries.js";
import { thinToGrid } from "../lib/firms.js";
import { ensureCountryLayers, toFeatureCollection } from "../app/components/globe/layers.js";

test("country containment excludes neighboring countries", () => {
  const pakistan = findCountry("PAK");
  assert.ok(isInsideCountry(pakistan, 74.3587, 31.5204)); // Lahore
  assert.equal(isInsideCountry(pakistan, 74.8723, 31.634), false); // Amritsar
  assert.equal(isInsideCountry(pakistan, 69.2075, 34.5553), false); // Kabul

  const germany = findCountry("DEU");
  assert.ok(isInsideCountry(germany, 13.405, 52.52)); // Berlin
  assert.equal(isInsideCountry(germany, 2.3522, 48.8566), false); // Paris
});

test("the FIRMS query encloses the country without fetching a wide border buffer", () => {
  const country = findCountry("PAK");
  const [west, south, east, north] = queryBbox(country);
  for (const { bbox } of country.polygons) {
    assert.ok(west <= bbox[0] && south <= bbox[1]);
    assert.ok(east >= bbox[2] && north >= bbox[3]);
  }
  assert.ok(country.focusBbox[0] - west < 0.1);
});

test("country containment includes borders, holes' borders, and separate islands", () => {
  const country = {
    polygons: [
      {
        bbox: [0, 0, 10, 10],
        rings: [
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
          [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
        ],
      },
      {
        bbox: [20, 20, 22, 22],
        rings: [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
      },
    ],
  };
  assert.ok(isInsideCountry(country, 1, 1));
  assert.ok(isInsideCountry(country, 0, 5));
  assert.ok(isInsideCountry(country, 10, 10));
  assert.ok(isInsideCountry(country, 3, 5));
  assert.equal(isInsideCountry(country, 5, 5), false);
  assert.equal(isInsideCountry(country, 10.000001, 5), false);
  assert.ok(isInsideCountry(country, 21, 21));
});

test("thinning preserves coordinates near borders", () => {
  const country = {
    polygons: [{
      bbox: [0, 0, 0.0006, 1],
      rings: [[[0, 0], [0.0006, 0], [0.0006, 1], [0, 1], [0, 0]]],
    }],
  };
  const [point] = thinToGrid([[0.00059, 0.5, 12, 0]], 0.0001, 10);
  assert.equal(point[0], 0.00059);
  assert.ok(isInsideCountry(country, point[0], point[1]));
});

test("thinning preserves harmonized tier, evidence, and dual matches", () => {
  const acquired = Date.parse("2026-11-14T12:00:00Z");
  const match = [0, 0, 20, 0, acquired, "80", "T"];
  const dual = [0.001, 0, 42.567, 1, 1, acquired, null, 3, 1, "h", "N20", [match]];
  const [point] = thinToGrid([dual], 0.0001, 10);
  assert.equal(point[2], 42.6);
  assert.equal(point[5], acquired);
  assert.equal(point[7], 3);
  assert.equal(point[8], 1);
  assert.equal(point[9], "h");
  assert.equal(point[10], "N20");
  assert.deepEqual(point[11], [match]);
});

test("cached outside-country points are not rendered", () => {
  const features = toFeatureCollection([
    [74.3587, 31.5204, 10, 0, 1],
    [74.8723, 31.634, 20, 1, 0],
  ]).features;
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates, [74.3587, 31.5204]);
});

test("the highlighted country uses the same geometry as the hotspot filter", () => {
  const sources = new Map();
  const layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    getStyle: () => ({ layers: [] }),
    addSource(id, source) {
      sources.set(id, { ...source, setData(data) { this.data = data; } });
    },
    removeSource: (id) => sources.delete(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    removeLayer: (id) => layers.delete(id),
  };
  const pakistan = findCountry("PAK");
  assert.equal(ensureCountryLayers(map, { iso3: "PAK", geometry: pakistan.geometry }), true);
  assert.equal(sources.get("country-boundaries").type, "geojson");
  assert.deepEqual(sources.get("country-boundaries").data.geometry, pakistan.geometry);
  assert.equal(layers.get("country-line")["source-layer"], undefined);

  assert.equal(ensureCountryLayers(map, null), true);
  assert.equal(sources.get("country-boundaries").type, "vector");
  assert.equal(layers.get("country-line")["source-layer"], "country_boundaries");
  assert.equal(ensureCountryLayers(map, { iso3: "PAK", geometry: pakistan.geometry }), true);
  assert.deepEqual(sources.get("country-boundaries").data.geometry, pakistan.geometry);
});

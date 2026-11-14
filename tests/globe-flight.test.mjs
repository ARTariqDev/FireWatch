import assert from "node:assert/strict";
import test from "node:test";
import { flyToCountry, framePadding, returnToOrbit } from "../app/components/globe/flights.js";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

test.before(() => {
  globalThis.window = { innerWidth: 1200, matchMedia: () => ({ matches: true }) };
  globalThis.document = { documentElement: { classList: { add() {}, remove() {} } }, querySelector: () => null };
});

test.after(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

function makeStage() {
  const sources = new Map([["hotspots", { type: "geojson", setData(data) { this.data = data; } }]]);
  const layers = new Map();
  const rect = { left: 0, top: 0, width: 1200, height: 800 };
  const handler = { enable() {}, disable() {}, enableRotation() {}, disableRotation() {} };
  const container = { classList: { add() {}, remove() {} }, getBoundingClientRect: () => rect };
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id, source) { sources.set(id, { ...source, setData(data) { this.data = data; } }); },
    removeSource: (id) => sources.delete(id),
    getStyle: () => ({ layers: [] }),
    addLayer: (layer) => layers.set(layer.id, layer),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    setFilter() {},
    setPaintProperty() {},
    resize() {},
    getContainer: () => container,
    cameraForBounds: () => ({ center: [69, 30], zoom: 4 }),
    getCenter: () => ({ lng: 69, lat: 30 }),
    getZoom: () => 4,
    getPitch: () => 58,
    getBearing: () => -14,
    dragPan: handler,
    scrollZoom: handler,
    doubleClickZoom: handler,
    touchZoomRotate: handler,
    keyboard: handler,
    dragRotate: handler,
    touchPitch: handler,
  };
  return {
    ready: Promise.resolve(true),
    mode: "intro",
    map,
    sources,
    camera: { state: { lng: 62, lat: 16, zoom: 1, pitch: 0, bearing: 0, terrain: 0 }, apply() {} },
    container,
    slot: { getBoundingClientRect: () => rect },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const data = {
  country: {
    iso3: "PAK",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  },
  points: [[0.5, 0.5, 10, 0, 1]],
};

test("the country becomes interactive before a slow hotspot response", { timeout: 2000 }, async () => {
  const stage = makeStage();
  const request = deferred();
  assert.equal(await flyToCountry(stage, {
    iso3: "PAK", focus: { lng: 69, lat: 30 }, bounds: Promise.resolve([60, 23, 78, 38]), request: request.promise,
  }), true);
  assert.equal(stage.mode, "country");
  assert.equal(stage.viewMode, "2d");
  assert.equal(stage.camera.state.pitch, 0);
  assert.equal(stage.sources.get("hotspots").data.features.length, 0);

  request.resolve(data);
  await Promise.resolve();
  assert.equal(stage.sources.get("country-boundaries").type, "geojson");
  assert.deepEqual(stage.sources.get("hotspots").data.features[0].geometry.coordinates, [0.5, 0.5]);
  stage.highlight.pause();
});

test("country framing accounts for an open or collapsed mobile drawer", () => {
  const originalQuery = document.querySelector;
  const originalWidth = window.innerWidth;
  const drawer = { dataset: { open: "true" }, offsetHeight: 310 };
  window.innerWidth = 390;
  document.querySelector = () => drawer;
  try {
    assert.equal(framePadding().bottom, 334);
    drawer.dataset.open = "false";
    assert.equal(framePadding().bottom, 70);
  } finally {
    window.innerWidth = originalWidth;
    document.querySelector = originalQuery;
  }
});

test("the normal-motion flight finishes promptly when data is ready", { timeout: 7000 }, async () => {
  const stage = makeStage();
  globalThis.window.matchMedia = () => ({ matches: false });
  try {
    const start = performance.now();
    await flyToCountry(stage, {
      iso3: "PAK", focus: { lng: 69, lat: 30 }, bounds: Promise.resolve([60, 23, 78, 38]), request: Promise.resolve(data),
    });
    assert.ok(performance.now() - start < 5000);
    stage.highlight.pause();
  } finally {
    globalThis.window.matchMedia = () => ({ matches: true });
  }
});

test("a late hotspot response cannot overwrite the returned preview", async () => {
  const stage = makeStage();
  const request = deferred();
  await flyToCountry(stage, {
    iso3: "PAK", focus: { lng: 69, lat: 30 }, bounds: Promise.resolve([60, 23, 78, 38]), request: request.promise,
  });
  await returnToOrbit(stage);
  const preview = stage.sources.get("hotspots").data;
  request.resolve(data);
  await Promise.resolve();
  assert.equal(stage.mode, "orbit");
  assert.strictEqual(stage.sources.get("hotspots").data, preview);
  assert.notDeepEqual(preview.features[0].geometry.coordinates, [0.5, 0.5]);
});

test("supports seamless country-to-country flight transition", async () => {
  const stage = makeStage();
  // Fly to country 1 (Pakistan)
  const ok1 = await flyToCountry(stage, {
    iso3: "PAK",
    focus: { lng: 69, lat: 30 },
    bounds: Promise.resolve([60, 23, 78, 38]),
    request: Promise.resolve(data),
  });
  assert.equal(ok1, true);
  assert.equal(stage.mode, "country");

  // Fly directly to country 2 (Australia) from country mode
  const dataAus = {
    country: {
      iso3: "AUS",
      geometry: { type: "Polygon", coordinates: [[[130, -25], [131, -25], [131, -24], [130, -25]]] },
    },
    points: [[130.5, -25.2, 55, 1, 1]],
  };

  const ok2 = await flyToCountry(stage, {
    iso3: "AUS",
    focus: { lng: 133.7, lat: -25.2 },
    bounds: Promise.resolve([113, -44, 154, -10]),
    request: Promise.resolve(dataAus),
  });
  assert.equal(ok2, true);
  assert.equal(stage.mode, "country");
  assert.equal(stage.sources.get("hotspots").data.features[0].geometry.coordinates[0], 130.5);
  stage.highlight?.pause();
});

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { MAP_STYLE, monitorMapErrors } from "../app/components/globe/mapErrors.js";

const styleUrl = "https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=test-token";

function fakeMap() {
  const map = new EventEmitter();
  map.setStyle = (...args) => { map.lastStyle = args; };
  return map;
}

test("retries a transient initial style failure once, then reports a persistent failure", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "error", () => {});
  const map = fakeMap();
  let failures = 0;
  const stop = monitorMapErrors(map, { isBooting: () => true, onFatal: () => failures++ });
  const error = { message: `Failed to fetch ${styleUrl}` };

  map.emit("error", { error });
  map.emit("error", { error });
  assert.equal(failures, 0);
  t.mock.timers.tick(500);
  assert.deepEqual(map.lastStyle, [MAP_STYLE, { diff: false }]);
  map.emit("error", { error });
  assert.equal(failures, 1);
  assert.ok(!JSON.stringify(log.mock.calls[0].arguments).includes("test-token"));
  stop();
});

test("reports an unauthorized style immediately without retrying", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  const map = fakeMap();
  let failures = 0;
  const stop = monitorMapErrors(map, { isBooting: () => true, onFatal: () => failures++ });
  map.emit("error", { error: { url: styleUrl, message: "Unauthorized", status: 401 } });
  t.mock.timers.tick(500);
  assert.equal(failures, 1);
  assert.equal(map.lastStyle, undefined);
  stop();
});

test("does not mistake tile errors for fatal style failures", (t) => {
  t.mock.method(console, "error", () => {});
  const map = fakeMap();
  let failures = 0;
  const stop = monitorMapErrors(map, { isBooting: () => true, onFatal: () => failures++ });
  map.emit("error", { error: { url: "https://api.mapbox.com/v4/tiles/1", status: 404, message: "Not Found" } });
  assert.equal(failures, 0);
  assert.equal(map.lastStyle, undefined);
  stop();
});

test("cancels a scheduled retry after successful loading or cleanup", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  const map = fakeMap();
  const stop = monitorMapErrors(map, { isBooting: () => true, onFatal: () => assert.fail() });
  map.emit("error", { error: { message: `Failed to fetch ${styleUrl}` } });
  map.emit("load");
  t.mock.timers.tick(500);
  assert.equal(map.lastStyle, undefined);
  stop();

  const secondMap = fakeMap();
  const stopSecond = monitorMapErrors(secondMap, { isBooting: () => true, onFatal: () => assert.fail() });
  secondMap.emit("error", { error: { message: `Failed to fetch ${styleUrl}` } });
  stopSecond();
  t.mock.timers.tick(500);
  assert.equal(secondMap.lastStyle, undefined);
});

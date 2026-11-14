import assert from "node:assert/strict";
import test from "node:test";
import { fetchDetections, FirmsError } from "../lib/firms.js";

const source = { id: "MODIS_NRT", sensor: 0 };
const now = Date.parse("2026-11-14T06:00:00Z");
const csv = "latitude,longitude,frp,acq_date,acq_time\n30.1,69.2,12.3,2026-11-14,530";
const oldKey = process.env.FIRMS_MAP_KEY;

test.before(() => { process.env.FIRMS_MAP_KEY = "test-key"; });
test.after(() => {
  if (oldKey === undefined) delete process.env.FIRMS_MAP_KEY;
  else process.env.FIRMS_MAP_KEY = oldKey;
});

test("retries a transient network failure and returns real detections", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++attempts === 1) throw new TypeError("fetch failed");
    return new Response(csv);
  });
  const result = fetchDetections(source, "60,20,80,40", now);
  await new Promise(setImmediate);
  t.mock.timers.tick(500);
  assert.deepEqual(await result, [[69.2, 30.1, 12.3, 0]]);
  assert.equal(attempts, 2);
});

test("retries temporary upstream errors but not authentication errors", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    return attempts === 1 ? new Response("", { status: 503 }) : new Response(csv);
  });
  const result = fetchDetections(source, "60,20,80,40", now);
  await new Promise(setImmediate);
  t.mock.timers.tick(500);
  assert.equal((await result).length, 1);
  assert.equal(attempts, 2);

  attempts = 0;
  globalThis.fetch.mock.mockImplementation(async () => {
    attempts++;
    return new Response("", { status: 401 });
  });

  await assert.rejects(fetchDetections(source, "60,20,80,40"), FirmsError);
  assert.equal(attempts, 1);
});

test("requests two UTC days but includes only the rolling 24-hour window", async (t) => {
  const rows = [
    "latitude,longitude,frp,acq_date,acq_time",
    "30,60,1,2026-11-13,559",
    "30,61,2,2026-11-13,600",
    "30,62,3,2026-11-13,2359",
    "30,63,4,2026-11-14,30",
    "30,64,5,2026-11-14,601",
  ].join("\n");
  let url;
  t.mock.method(globalThis, "fetch", async (input) => {
    url = input;
    return new Response(rows);
  });
  assert.deepEqual(await fetchDetections(source, "60,20,80,40", now), [
    [61, 30, 2, 0],
    [62, 30, 3, 0],
    [63, 30, 4, 0],
  ]);
  assert.ok(url.endsWith("/2"));
});

test("fetches historical date and preserves detections within that window", async (t) => {
  const rows = [
    "latitude,longitude,frp,acq_date,acq_time",
    "30,60,1,2026-11-01,500",
    "31,61,2,2026-11-02,1200",
    "32,62,3,2026-11-03,100",
  ].join("\n");
  let url;
  t.mock.method(globalThis, "fetch", async (input) => {
    url = input;
    return new Response(rows);
  });
  const start = Date.parse("2026-11-01T00:00:00Z");
  const end = start + 2 * 24 * 3600 * 1000;
  const result = await fetchDetections(source, "60,20,80,40", end, {
    withAcquired: true,
    date: "2026-11-01",
    dayRange: 2,
    windowStart: start,
  });
  assert.equal(result.length, 2);
  assert.equal(result[0][0], 60);
  assert.equal(result[1][0], 61);
  assert.ok(url.endsWith("/2/2026-11-01"));
});

test("reports invalid or missing acquisition times instead of treating them as current", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("latitude,longitude,frp,acq_date,acq_time\n30,60,1,2026-11-14,2460"),
  );
  await assert.rejects(fetchDetections(source, "60,20,80,40", now), /acquisition time/);
  globalThis.fetch.mock.mockImplementation(async () => new Response("latitude,longitude,frp\n30,60,1"));
  await assert.rejects(fetchDetections(source, "60,20,80,40", now), /CSV format/);
});

test("reports a persistent network failure after one retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    throw new TypeError("fetch failed");
  });
  const result = fetchDetections(source, "60,20,80,40");
  await new Promise(setImmediate);
  t.mock.timers.tick(500);
  await assert.rejects(result, /FIRMS MODIS_NRT is unreachable/);
  assert.equal(attempts, 2);
});

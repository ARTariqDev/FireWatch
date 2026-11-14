import assert from "node:assert/strict";
import test from "node:test";
import { classifyHotspots } from "../lib/hotspot-data.js";
import { toFeatureCollection } from "../app/components/globe/layers.js";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ONE_HOUR = 3600 * 1000;

test("classifies fires as active or extinguished based on recent presence", () => {
  // Fire A: detected 2 hours ago (active)
  // Fire B: detected 18 hours ago in a different area (extinguished - no recent detection)
  // Fire C: detected 18 hours ago AND 1 hour ago in the same area (active)
  const points = [
    [70.0, 30.0, 50, 0, 1, NOW - 2 * ONE_HOUR], // A
    [75.0, 35.0, 40, 1, 1, NOW - 18 * ONE_HOUR], // B
    [80.0, 25.0, 80, 0, 1, NOW - 18 * ONE_HOUR], // C (old)
    [80.01, 25.01, 90, 1, 1, NOW - 1 * ONE_HOUR], // C (recent)
  ];

  // Live (hoursBack: 0)
  const live = classifyHotspots(points, { hoursBack: 0, referenceTime: NOW });
  assert.equal(live.stats.total, 4);
  assert.equal(live.stats.active, 3); // A, C(old), C(recent)
  assert.equal(live.stats.extinguished, 1); // B

  // Slider at 18 hours ago:
  // Shows fires detected around 18h ago (B and C old)
  const past = classifyHotspots(points, { hoursBack: 18, referenceTime: NOW });
  assert.equal(past.stats.total, 2);
  const fireB = past.filteredPoints.find((p) => p[0] === 75.0);
  const fireC = past.filteredPoints.find((p) => p[0] === 80.0);
  assert.ok(fireB);
  assert.ok(fireC);
  assert.equal(fireB[6], 1); // Extinguished (lighter shade)
  assert.equal(fireC[6], 0); // Still active currently
});

test("filters fires strictly by custom date and time interval", () => {
  const points = [
    [70.0, 30.0, 20, 0, 1, NOW - 10 * ONE_HOUR],
    [71.0, 31.0, 30, 0, 1, NOW - 5 * ONE_HOUR],
    [72.0, 32.0, 40, 0, 1, NOW - 1 * ONE_HOUR],
  ];

  const interval = {
    startMs: NOW - 6 * ONE_HOUR,
    endMs: NOW - 4 * ONE_HOUR,
  };

  const result = classifyHotspots(points, { interval });
  assert.equal(result.filteredPoints.length, 1);
  assert.equal(result.filteredPoints[0][0], 71.0);
});

test("toFeatureCollection preserves extinguished property for Mapbox styling", () => {
  const fc = toFeatureCollection([
    [70.0, 30.0, 50, 0, 1, NOW, 0], // active
    [75.0, 35.0, 20, 1, 1, NOW - 10 * ONE_HOUR, 1], // extinguished
  ]);
  assert.equal(fc.features.length, 2);
  assert.equal(fc.features[0].properties.extinguished, 0);
  assert.equal(fc.features[1].properties.extinguished, 1);
});

test("filters hotspots by confidence tierFilter", () => {
  const points = [
    // [lon, lat, frp, sensor, inside, acquired, extinguished, evidence, tier, confidence]
    [70.0, 30.0, 80, 1, 1, NOW, 0, 3, 1, 95], // Tier 1: Dual-confirmed
    [71.0, 31.0, 45, 1, 1, NOW, 0, 2, 2, 85], // Tier 2: VIIRS solo
    [72.0, 32.0, 30, 0, 1, NOW, 0, 1, 3, 40], // Tier 3: MODIS solo
  ];

  const all = classifyHotspots(points, { hoursBack: 0, tierFilter: "all", referenceTime: NOW });
  assert.equal(all.filteredPoints.length, 3);
  assert.equal(all.stats.dual, 1);

  const viirsAndDual = classifyHotspots(points, { hoursBack: 0, tierFilter: "viirs_and_dual", referenceTime: NOW });
  assert.equal(viirsAndDual.filteredPoints.length, 2);
  assert.ok(viirsAndDual.filteredPoints.every((p) => p[8] === 1 || p[8] === 2));

  const dualOnly = classifyHotspots(points, { hoursBack: 0, tierFilter: "dual_only", referenceTime: NOW });
  assert.equal(dualOnly.filteredPoints.length, 1);
  assert.equal(dualOnly.filteredPoints[0][8], 1);
});

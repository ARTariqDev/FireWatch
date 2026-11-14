import assert from "node:assert/strict";
import test from "node:test";
import { trackFires } from "../lib/tracker.js";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const HOUR = 3600000;

test("reconstructs fire events from harmonized observations", () => {
  // Event A: Terra at 10:30 (MODIS), then NOAA-20 at 13:30 (VIIRS) ~500m away
  // Event B: Separate fire 50km away (VIIRS solo)
  const points = [
    [
      74.3, 31.5, 15.0, 1, 1, NOW - 3 * HOUR, 0, 3, 1, "h", "N20",
      [[74.298, 31.502, 12.0, 0, NOW - 4 * HOUR, "80", "T"]],
    ],
    [
      74.8, 31.9, 8.5, 1, 1, NOW - 1 * HOUR, 0, 1, 2, "n", "N20", [],
    ],
  ];

  const { events, eventsGeoJson } = trackFires(points);

  assert.equal(events.length, 2);
  assert.equal(eventsGeoJson.features.length, 2);

  // Check Event A (dual-confirmed)
  const eventA = events.find((e) => e.observations.some((o) => o.latitude >= 31.5 && o.latitude <= 31.51));
  assert.ok(eventA);
  assert.equal(eventA.detection_confidence, "dual_confirmed");
  assert.equal(eventA.tracking_confidence, "high");
  assert.equal(eventA.observation_count, 2);
  assert.equal(eventA.observations[0].sensor, "VIIRS");
  assert.equal(eventA.observations[1].sensor, "MODIS");
  assert.equal(eventA.prediction, null); // Slot ready for ML prediction models
  assert.ok(eventA.event_id.startsWith("fire_"));
  assert.ok(eventA.footprint.type === "Polygon");

  // Check Event B (VIIRS only)
  const eventB = events.find((e) => e.observations.some((o) => o.latitude >= 31.8));
  assert.ok(eventB);
  assert.equal(eventB.detection_confidence, "viirs_only");
  assert.equal(eventB.observation_count, 1);
});

test("produces deterministic event IDs across runs", () => {
  const points = [
    [70.5, 30.2, 25.0, 1, 1, NOW, 0, 2, 2, "h", "N20", []],
  ];

  const res1 = trackFires(points);
  const res2 = trackFires(points);

  assert.equal(res1.events[0].event_id, res2.events[0].event_id);
});


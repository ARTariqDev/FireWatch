import { cacheLife, cacheTag } from "next/cache";
import { TRACKER_SOURCES, fetchDetections14Days, thinToGrid } from "./firms";
import { findCountry, isInsideCountry, queryBbox } from "./countries";
import { harmonizeHotspots } from "./harmonization";
import {
  attachViirsModelsToCombined,
  buildViirsModelBundle,
  detectionsToPoints,
  filterRecent12Hours,
  parseUtcMs,
  trackFiresWithBackend,
} from "./fire-models";

const INSIDE_LIMIT = 4000;
const DEFAULT_TRACKER_DAYS = 14;
const DISPLAY_WINDOW_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export const countryHotspotTag = (iso3, date = "") =>
  `country-hotspots-${iso3}${date ? `-${date}` : ""}`;

function detectionTimeMs(det, fallbackMs) {
  const fromIso = parseUtcMs(det?.acq_datetime_utc);
  if (Number.isFinite(fromIso)) return fromIso;
  if (det?._acquired && Number.isFinite(det._acquired)) return det._acquired;
  if (det?.acq_date && det?.acq_time !== undefined && det?.acq_time !== null) {
    const hhmm = String(det.acq_time).padStart(4, "0");
    const parsed = Date.parse(`${det.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

function findNearestFireId(lon, lat, detectionCoords, maxDeg = 0.02) {
  const maxDistSq = maxDeg * maxDeg;
  let bestId = null;
  let bestDistSq = maxDistSq;
  for (const item of detectionCoords) {
    const dLon = item.lon - lon;
    const dLat = item.lat - lat;
    if (Math.abs(dLon) > maxDeg || Math.abs(dLat) > maxDeg) continue;
    const distSq = dLon * dLon + dLat * dLat;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestId = item.fireId;
    }
  }
  return bestId;
}

function buildCombinedHarmonizedPoints(recentFireEvents, windowEnd) {
  const rawRows = [];
  const fireIdByKey = new Map();
  const detectionCoords = [];

  for (const event of recentFireEvents) {
    const fireId = event?.fire?.fire_final ?? null;
    for (const det of event?.detections || []) {
      const lon = Number(det.lon ?? det.longitude);
      const lat = Number(det.lat ?? det.latitude);
      const frp = Number(det.frp) || 0;
      const satId = String(det.satellite_id || det.sat || det.instrument || "").toUpperCase();
      const isModis =
        String(det.instrument || "").toUpperCase() === "MODIS" || satId.startsWith("MODIS");
      const sensor = isModis ? 0 : 1;
      const acquired = detectionTimeMs(det, windowEnd);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(acquired)) continue;
      const conf = det.confidence ?? null;
      const sat = det.satellite ?? det.satellite_id ?? det.sat ?? null;

      rawRows.push([lon, lat, frp, sensor, acquired, conf, sat]);
      fireIdByKey.set(`${sensor}:${sat}:${acquired}:${lon}:${lat}`, fireId);
      if (fireId !== null && fireId !== undefined) {
        detectionCoords.push({ lon, lat, fireId });
      }
    }
  }

  const harmonized = harmonizeHotspots(rawRows);
  return thinToGrid(harmonized, 0.0001, INSIDE_LIMIT).map(
    ([
      lon,
      lat,
      frp,
      sensor,
      ,
      acquired,
      extinguished = null,
      evidence = 0,
      tier = 2,
      confidence = null,
      satellite = null,
      matches = [],
    ]) => [
      lon,
      lat,
      frp,
      sensor,
      1,
      acquired ?? windowEnd,
      extinguished,
      evidence,
      tier,
      confidence,
      satellite,
      matches,
      fireIdByKey.get(`${sensor}:${satellite}:${acquired}:${lon}:${lat}`) ??
        findNearestFireId(lon, lat, detectionCoords, 0.02),
    ],
  );
}

function buildTabStats(points, fireEvents, metadata, generatedAt) {
  return {
    inside: points.length,
    eventsCount: fireEvents.length,
    fires14d: metadata?.n_fires_14d ?? fireEvents.length,
    detections14d: metadata?.n_detections_in_14d ?? points.length,
    trackedDetections14d: metadata?.n_detections_tracked_14d ?? points.length,
    modis: points.filter((row) => row[3] === 0).length,
    viirs: points.filter((row) => row[3] === 1).length,
    dual: points.filter((row) => row[8] === 1).length,
    maxFrp: Number(Math.max(0, ...points.map((row) => row[2])).toFixed(1)),
    generatedAt,
  };
}

// Only detections inside or on the selected country's boundaries are returned.
// Fetches the last 14 days of FIRMS detections, tracks Combined / VIIRS / MODIS separately
// via the Python backend, filters each tab to fires detected within 12 hours, and attaches
// VIIRS ML predictions and hazard ratings.
export async function getCountryHotspots(iso3, options = {}) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 1800 });
  cacheTag(countryHotspotTag(iso3, options?.date || ""));

  const country = findCountry(iso3);
  if (!country) return null;

  const box = queryBbox(country).join(",");
  const isHistorical = Boolean(options?.date);
  const dayRange = Number(options?.dayRange) || DEFAULT_TRACKER_DAYS;
  const windowStart = isHistorical
    ? Date.parse(`${options.date}T00:00:00Z`)
    : (options?.windowStart ?? Date.now() - dayRange * DAY_MS);
  const windowEnd = isHistorical
    ? windowStart + dayRange * DAY_MS
    : (options?.windowEnd ?? Date.now());

  const perSource = await Promise.all(
    TRACKER_SOURCES.map((source) => {
      const task = fetchDetections14Days(source, box, windowEnd, {
        date: options?.date,
        dayRange,
        windowStart,
      });
      return source.optional ? task.catch(() => []) : task;
    }),
  );

  const insideItems = perSource
    .flat()
    .filter((item) => isInsideCountry(country, item.row[0], item.row[1]));

  const combinedHotspots14d = insideItems.map((item) => item.trackerHotspot);
  const viirsHotspots14d = insideItems
    .filter((item) => item.trackerHotspot._sensor === 1)
    .map((item) => item.trackerHotspot);
  const modisHotspots14d = insideItems
    .filter((item) => item.trackerHotspot._sensor === 0)
    .map((item) => item.trackerHotspot);

  const [combinedTrack14d, viirsTrack14d, modisTrack14d] = await Promise.all([
    trackFiresWithBackend(combinedHotspots14d, "deployment"),
    trackFiresWithBackend(viirsHotspots14d, "deployment"),
    trackFiresWithBackend(modisHotspots14d, "deployment"),
  ]);

  const combinedRecent = filterRecent12Hours(combinedTrack14d, {
    windowEnd,
    windowHours: DISPLAY_WINDOW_HOURS,
  });
  const viirsRecent = filterRecent12Hours(viirsTrack14d, {
    windowEnd,
    windowHours: DISPLAY_WINDOW_HOURS,
  });
  const modisRecent = filterRecent12Hours(modisTrack14d, {
    windowEnd,
    windowHours: DISPLAY_WINDOW_HOURS,
  });

  const viirsEnriched = await buildViirsModelBundle(
    viirsRecent,
    viirsTrack14d.fire_events || [],
    { dataSource: isHistorical ? "SP" : "NRT" },
  );

  const combinedEnriched = attachViirsModelsToCombined(combinedRecent, viirsEnriched);

  const combinedPoints12h = buildCombinedHarmonizedPoints(
    combinedEnriched.recentFireEvents,
    windowEnd,
  );
  const viirsPoints12h = thinToGrid(
    detectionsToPoints(viirsEnriched.fire_events),
    0.0001,
    INSIDE_LIMIT,
  );
  const modisPoints12h = thinToGrid(
    detectionsToPoints(modisRecent.recentFireEvents),
    0.0001,
    INSIDE_LIMIT,
  );

  const generatedAt = new Date().toISOString();
  const combinedStats = buildTabStats(
    combinedPoints12h,
    combinedEnriched.recentFireEvents,
    combinedEnriched.metadata,
    generatedAt,
  );
  const viirsStats = buildTabStats(
    viirsPoints12h,
    viirsEnriched.fire_events,
    viirsRecent.metadata,
    generatedAt,
  );
  const modisStats = buildTabStats(
    modisPoints12h,
    modisRecent.recentFireEvents,
    modisRecent.metadata,
    generatedAt,
  );

  return {
    country: { iso2: country.iso2, iso3, name: country.name, bbox: country.focusBbox, geometry: country.geometry },
    stats: combinedStats,
    points: combinedPoints12h,
    events: combinedEnriched.recentFireEvents,
    eventsGeoJson: combinedEnriched.recentGeoJson,
    tabs: {
      combined: {
        id: "combined",
        label: "MODIS + VIIRS",
        stats: combinedStats,
        points: combinedPoints12h,
        geojson: combinedEnriched.recentGeoJson,
        fire_events: combinedEnriched.recentFireEvents,
        metadata: combinedEnriched.metadata,
      },
      viirs: {
        id: "viirs",
        label: "VIIRS",
        stats: viirsStats,
        points: viirsPoints12h,
        geojson: viirsEnriched.geojson,
        fire_events: viirsEnriched.fire_events,
        predictionsGeoJson: viirsEnriched.predictionsGeoJson,
        modelSummary: viirsEnriched.modelSummary,
        metadata: viirsRecent.metadata,
      },
      modis: {
        id: "modis",
        label: "MODIS",
        stats: modisStats,
        points: modisPoints12h,
        geojson: modisRecent.recentGeoJson,
        fire_events: modisRecent.recentFireEvents,
        metadata: modisRecent.metadata,
      },
    },
  };
}

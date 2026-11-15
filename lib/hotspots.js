import { cacheLife, cacheTag } from "next/cache";
import { TRACKER_SOURCES, fetchDetections14Days, thinToGrid } from "./firms";
import { findCountry, isInsideCountry, queryBbox } from "./countries";
import { harmonizeHotspotsWithDiagnostics, isCrossSensorConsistent } from "./harmonization";
import { buildHarmonizationReport } from "./statistical-harmonization";
import {
  attachViirsModelsToCombined,
  buildViirsModelBundle,
  detectionsToPoints,
  filterRecent12Hours,
  parseUtcMs,
  trackFiresWithBackend,
} from "./fire-models";

const INSIDE_LIMIT = 4000;
const POINTS_14D_LIMIT = 12000;
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

function mergePointWindows(recentPoints, fullPoints, limit) {
  const seen = new Set();
  const merged = [];
  for (const pt of recentPoints) {
    const key = `${pt[3]}:${pt[5]}:${Number(pt[0]).toFixed(4)}:${Number(pt[1]).toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(pt);
    }
  }
  for (const pt of fullPoints) {
    if (merged.length >= limit) break;
    const key = `${pt[3]}:${pt[5]}:${Number(pt[0]).toFixed(4)}:${Number(pt[1]).toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(pt);
    }
  }
  return merged;
}

function buildCombinedHarmonizedPoints(allFireEvents, insideItems, cutoffRecentMs, windowEnd) {
  const rawRows = [];
  const fireIdByKey = new Map();
  const fireIdByCoord = new Map();
  const detectionCoords = [];

  for (const event of allFireEvents) {
    const fireId = event?.fire?.fire_final ?? null;
    if (fireId === null || fireId === undefined) continue;
    for (const det of event?.detections || []) {
      const lon = Number(det.lon ?? det.longitude);
      const lat = Number(det.lat ?? det.latitude);
      const satId = String(det.satellite_id || det.sat || det.instrument || "").toUpperCase();
      const isModis =
        String(det.instrument || "").toUpperCase() === "MODIS" || satId.startsWith("MODIS");
      const sensor = isModis ? 0 : 1;
      const acquired = detectionTimeMs(det, windowEnd);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const coordKey = `${sensor}:${lon.toFixed(4)}:${lat.toFixed(4)}`;
      if (Number.isFinite(acquired)) {
        fireIdByKey.set(`${coordKey}:${acquired}`, fireId);
      }
      fireIdByCoord.set(coordKey, fireId);
      detectionCoords.push({ lon, lat, fireId });
    }
  }

  for (const item of insideItems) {
    const row = item?.row;
    if (!Array.isArray(row) || row.length < 5) continue;
    const [lon, lat, frp, sensor, acquired, conf = null, sat = null, , scan = null, track = null] = row;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(acquired)) continue;
    const scanKm = scan ?? item?.trackerHotspot?.scan ?? null;
    const trackKm = track ?? item?.trackerHotspot?.track ?? null;
    rawRows.push([lon, lat, frp, sensor, acquired, conf, sat, scanKm, trackKm]);
  }

  const { rows: harmonized, ssotSummary } = harmonizeHotspotsWithDiagnostics(rawRows, {
    adaptiveDrift: true,
  });
  const ssotByFireId = new Map();
  const linkedAll = harmonized.map(
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
      meta = null,
    ]) => {
      const finalTier =
        tier === 1 || tier === 4
          ? tier
          : !isCrossSensorConsistent(sensor, confidence)
            ? 4
            : tier;
      const coordKey = `${sensor}:${Number(lon).toFixed(4)}:${Number(lat).toFixed(4)}`;
      const fireId =
        fireIdByKey.get(`${coordKey}:${acquired}`) ??
        fireIdByCoord.get(coordKey) ??
        findNearestFireId(lon, lat, detectionCoords, 0.02);

      if (fireId !== null && fireId !== undefined) {
        const key = String(fireId);
        if (!ssotByFireId.has(key)) {
          ssotByFireId.set(key, {
            regimes: new Set(),
            modisCorroboratedCount: 0,
            frpRatios: [],
            scanMaxKm: 0,
          });
        }
        const entry = ssotByFireId.get(key);
        if (meta?.regime) entry.regimes.add(meta.regime);
        if (Array.isArray(matches) && matches.length > 0) {
          entry.modisCorroboratedCount += matches.length;
        }
        if (typeof meta?.frpRatio === "number" && Number.isFinite(meta.frpRatio)) {
          entry.frpRatios.push(meta.frpRatio);
        }
        if (typeof meta?.scan === "number" && meta.scan > entry.scanMaxKm) {
          entry.scanMaxKm = meta.scan;
        }
      }

      return [
        lon,
        lat,
        frp,
        sensor,
        1,
        acquired ?? windowEnd,
        extinguished,
        evidence,
        finalTier,
        confidence,
        satellite,
        matches,
        fireId,
        meta,
      ];
    },
  );

  const recent12h = thinToGrid(
    linkedAll.filter((pt) => pt[5] >= cutoffRecentMs),
    0.0001,
    INSIDE_LIMIT,
  );
  const full14d = thinToGrid(linkedAll, 0.0002, POINTS_14D_LIMIT);
  return {
    points12h: recent12h,
    points14d: mergePointWindows(recent12h, full14d, POINTS_14D_LIMIT),
    harmonizedRows: linkedAll,
    ssotSummary,
    ssotByFireId,
  };
}

function buildTabStats(points, fireEvents, metadata, generatedAt) {
  return {
    inside: points.length,
    eventsCount: fireEvents.length,
    fires14d: metadata?.n_fires_14d ?? fireEvents.length,
    pastFiresCount: metadata?.n_past_fires_14d ?? Math.max(0, (metadata?.n_fires_14d ?? fireEvents.length) - fireEvents.length),
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
// VIIRS ML predictions and hazard ratings + past-fire hindcasts.
export async function getCountryHotspots(iso3, options = {}) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 1800 });
  cacheTag(countryHotspotTag(iso3, options?.date || ""));

  const country = findCountry(iso3);
  if (!country) return null;

  const box = queryBbox(country).join(",");
  const isHistorical = Boolean(options?.date);
  const dayRange = Number(options?.dayRange) || DEFAULT_TRACKER_DAYS;
  const windowStart = isHistorical ? Date.parse(`${options.date}T00:00:00Z`) : undefined;
  const windowEnd = isHistorical
    ? windowStart + dayRange * DAY_MS
    : (options?.windowEnd ?? Date.now());

  const perSource = await Promise.all(
    TRACKER_SOURCES.map((source) => {
      const task = fetchDetections14Days(source, box, windowEnd, {
        date: options?.date,
        dayRange,
        ...(windowStart !== undefined ? { windowStart } : {}),
      });
      return source.optional ? task.catch(() => []) : task;
    }),
  );

  const insideItems = perSource
    .flat()
    .filter((item) => isInsideCountry(country, item.row[0], item.row[1]));

  let maxItemMs = 0;
  for (const item of insideItems) {
    const acq = Number(item?.trackerHotspot?._acquired ?? item?.row?.[4]);
    if (Number.isFinite(acq) && acq > maxItemMs) maxItemMs = acq;
  }
  const referenceEndMs = maxItemMs > 0 ? maxItemMs : windowEnd;
  const cutoffRecentMs = referenceEndMs - DISPLAY_WINDOW_HOURS * 60 * 60 * 1000;

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
    windowEnd: referenceEndMs,
    windowHours: DISPLAY_WINDOW_HOURS,
  });
  const viirsRecent = filterRecent12Hours(viirsTrack14d, {
    windowEnd: referenceEndMs,
    windowHours: DISPLAY_WINDOW_HOURS,
  });
  const modisRecent = filterRecent12Hours(modisTrack14d, {
    windowEnd: referenceEndMs,
    windowHours: DISPLAY_WINDOW_HOURS,
  });

  const viirsEnriched = await buildViirsModelBundle(
    viirsRecent,
    viirsTrack14d.fire_events || [],
    { dataSource: isHistorical ? "SP" : "NRT" },
  );

  const combinedEnriched = attachViirsModelsToCombined(combinedRecent, viirsEnriched);
  const combinedPoints = buildCombinedHarmonizedPoints(
    [...(combinedEnriched.recentFireEvents || []), ...(combinedEnriched.pastFireEvents || [])],
    insideItems,
    cutoffRecentMs,
    referenceEndMs,
  );
  const harmonizationReport = buildHarmonizationReport(
    insideItems,
    combinedTrack14d,
    combinedPoints.ssotSummary,
    combinedPoints.harmonizedRows,
    iso3,
  );

  const attachEventContext = (event) => {
    const info = combinedPoints.ssotByFireId.get(String(event?.fire?.fire_final));
    const regimes = info ? [...info.regimes] : [];
    const primaryRegime = regimes.includes("coincident_dual")
      ? "coincident_dual"
      : regimes.includes("diurnal_bridged")
        ? "diurnal_bridged"
        : regimes.includes("sub_resolution_viirs")
          ? "sub_resolution_viirs"
          : regimes.includes("modis_gap_fill")
            ? "modis_gap_fill"
            : regimes[0] || null;
    const meanFrpRatio = info?.frpRatios?.length
      ? Number(
          (info.frpRatios.reduce((s, v) => s + v, 0) / info.frpRatios.length).toFixed(2),
        )
      : null;
    return {
      ...event,
      context: harmonizationReport.context,
      ...(info
        ? {
            ssot: {
              primaryRegime,
              regimes,
              modisCorroboratedCount: info.modisCorroboratedCount,
              frpRatio: meanFrpRatio,
              scanMaxKm: info.scanMaxKm ? Number(info.scanMaxKm.toFixed(2)) : null,
            },
          }
        : {}),
    };
  };

  const combinedEventsWithContext = (combinedEnriched.recentFireEvents || []).map(attachEventContext);
  const combinedPastEventsWithContext = (combinedEnriched.pastFireEvents || []).map(attachEventContext);
  const viirsEventsWithContext = (viirsEnriched.fire_events || []).map((event) => ({
    ...event,
    context: harmonizationReport.context,
  }));
  const viirsPastEventsWithContext = (viirsEnriched.past_fire_events || []).map((event) => ({
    ...event,
    context: harmonizationReport.context,
  }));
  const viirsPoints12h = thinToGrid(
    detectionsToPoints(viirsEventsWithContext),
    0.0001,
    INSIDE_LIMIT,
  );
  const viirsPoints14d = mergePointWindows(
    viirsPoints12h,
    thinToGrid(detectionsToPoints([...viirsEventsWithContext, ...viirsPastEventsWithContext]), 0.0002, POINTS_14D_LIMIT),
    POINTS_14D_LIMIT,
  );
  const modisPoints12h = thinToGrid(
    detectionsToPoints(modisRecent.recentFireEvents),
    0.0001,
    INSIDE_LIMIT,
  );
  const modisPoints14d = mergePointWindows(
    modisPoints12h,
    thinToGrid(
      detectionsToPoints([...(modisRecent.recentFireEvents || []), ...(modisRecent.pastFireEvents || [])]),
      0.0002,
      POINTS_14D_LIMIT,
    ),
    POINTS_14D_LIMIT,
  );

  const generatedAt = new Date().toISOString();
  const combinedStats = buildTabStats(
    combinedPoints.points12h,
    combinedEventsWithContext,
    combinedEnriched.metadata,
    generatedAt,
  );
  const viirsStats = buildTabStats(
    viirsPoints12h,
    viirsEventsWithContext,
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
    country: { iso3, name: country.name, bbox: country.focusBbox, geometry: country.geometry },
    stats: combinedStats,
    points: combinedPoints.points12h,
    points14d: combinedPoints.points14d,
    events: combinedEventsWithContext,
    pastEvents: combinedPastEventsWithContext,
    eventsGeoJson: combinedEnriched.recentGeoJson,
    allEventsGeoJson: combinedEnriched.allGeoJson,
    harmonization: harmonizationReport,
    tabs: {
      combined: {
        id: "combined",
        label: "MODIS + VIIRS",
        stats: combinedStats,
        points: combinedPoints.points12h,
        points14d: combinedPoints.points14d,
        geojson: combinedEnriched.recentGeoJson,
        all_geojson: combinedEnriched.allGeoJson,
        fire_events: combinedEventsWithContext,
        past_fire_events: combinedPastEventsWithContext,
        harmonization: harmonizationReport,
        metadata: combinedEnriched.metadata,
      },
      viirs: {
        id: "viirs",
        label: "VIIRS",
        stats: viirsStats,
        points: viirsPoints12h,
        points14d: viirsPoints14d,
        geojson: viirsEnriched.geojson,
        all_geojson: viirsEnriched.allGeoJson,
        fire_events: viirsEventsWithContext,
        past_fire_events: viirsPastEventsWithContext,
        predictionsGeoJson: viirsEnriched.predictionsGeoJson,
        pastPredictionsGeoJson: viirsEnriched.pastPredictionsGeoJson,
        modelSummary: viirsEnriched.modelSummary,
        metadata: viirsRecent.metadata,
      },
      modis: {
        id: "modis",
        label: "MODIS",
        stats: modisStats,
        points: modisPoints12h,
        points14d: modisPoints14d,
        geojson: modisRecent.recentGeoJson,
        all_geojson: modisRecent.allGeoJson,
        fire_events: modisRecent.recentFireEvents,
        past_fire_events: modisRecent.pastFireEvents,
        metadata: modisRecent.metadata,
      },
    },
  };
}

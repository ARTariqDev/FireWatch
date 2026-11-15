import { viirsEvidence } from "./harmonization.js";
import { trackFires } from "./tracker.js";

const DEFAULT_FIRE_API_URL =
  "https://fire-watch-api.delightfulriver-be4a336e.centralindia.azurecontainerapps.io";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TRACKER_TIMEOUT_MS = 45000;
const MODEL_TIMEOUT_MS = 45000;

export function getFireApiUrl() {
  const configured = process.env.FIRE_API_URL || process.env.NEXT_PUBLIC_FIRE_API_URL;
  return (configured || DEFAULT_FIRE_API_URL).replace(/\/+$/, "");
}

export function parseUtcMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "string") return NaN;
  const trimmed = value.trim();
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function detectionAcquiredMs(det) {
  if (!det) return NaN;
  const fromIso = parseUtcMs(det.acq_datetime_utc);
  if (Number.isFinite(fromIso)) return fromIso;
  if (det._acquired && Number.isFinite(det._acquired)) return det._acquired;
  if (det.acq_date && det.acq_time !== undefined && det.acq_time !== null) {
    const hhmm = String(det.acq_time).padStart(4, "0");
    return Date.parse(`${det.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  }
  return NaN;
}

export function stripInternalFields(hotspot) {
  if (!hotspot || typeof hotspot !== "object") return hotspot;
  const clean = {};
  for (const [key, value] of Object.entries(hotspot)) {
    if (!key.startsWith("_") && value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

async function postJson(path, body, timeoutMs = MODEL_TIMEOUT_MS) {
  const url = `${getFireApiUrl()}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = json?.detail || json?.error || text || `HTTP ${response.status}`;
    throw new Error(`Fire Watch API ${path} failed (${response.status}): ${detail}`);
  }
  return json;
}

function normalizeSatelliteLabel(det) {
  const satId = det.satellite_id || det.sat;
  if (satId) return satId;
  const inst = String(det.instrument || "").toUpperCase();
  const sat = String(det.satellite || "").toUpperCase();
  if (inst === "MODIS") {
    if (sat === "A" || sat === "AQUA") return "MODIS_AQUA";
    return "MODIS_TERRA";
  }
  if (sat === "N21") return "VIIRS_NOAA21";
  if (sat === "N" || sat === "1" || sat.includes("SNPP")) return "VIIRS_SNPP";
  return "VIIRS_NOAA20";
}

function localTrackerFallback(hotspots = []) {
  if (!hotspots.length) {
    return {
      geojson: {
        type: "FeatureCollection",
        features: [],
        metadata: {
          n_fires: 0,
          n_detections_in: 0,
          n_detections_tracked: 0,
          note: "Local fallback tracker (no hotspots).",
          fallback: true,
        },
      },
      fire_events: [],
    };
  }

  // Match Python tracker's cleaning of low-confidence VIIRS hotspots
  const cleaned = hotspots.filter((h) => {
    const isViirs = String(h.instrument || "").toUpperCase() === "VIIRS" || h._sensor === 1;
    if (!isViirs) return true;
    return String(h.confidence || "").trim().toLowerCase() !== "l";
  });

  const compactPoints = cleaned.map((h) => {
    const sensor = String(h.instrument || "").toUpperCase() === "MODIS" ? 0 : 1;
    const acquired = detectionAcquiredMs(h) || Date.now();
    const evidence = sensor === 1 ? viirsEvidence(h.confidence) : 0;
    const tier = sensor === 1 ? 2 : 3;
    return [
      Number(h.longitude),
      Number(h.latitude),
      Number(h.frp) || 0,
      sensor,
      1,
      acquired,
      null,
      evidence,
      tier,
      h.confidence,
      h.satellite,
      [],
      h,
    ];
  });

  const { events } = trackFires(compactPoints);
  const features = [];
  const fireEvents = [];

  events.forEach((ev, idx) => {
    const fireId = idx + 1;
    const rawDetections = ev.points
      ? ev.points.map((pt) => pt[12])
      : ev.observations.map((obs) => ({
          latitude: obs.latitude,
          longitude: obs.longitude,
          frp: obs.frp,
          confidence: obs.confidence,
          satellite: obs.satellite,
          instrument: obs.sensor,
          acq_datetime_utc: obs.timestamp,
        }));

    const detections = rawDetections.map((det) => {
      const acqMs = detectionAcquiredMs(det) || Date.parse(ev.last_detected);
      const passId = Math.floor(acqMs / TWELVE_HOURS_MS);
      const satLabel = normalizeSatelliteLabel(det);
      return {
        ...stripInternalFields(det),
        lat: Number(det.latitude),
        lon: Number(det.longitude),
        pass_id: passId,
        fire_final: fireId,
        satellite_id: satLabel,
        sat: satLabel,
        acq_datetime_utc: new Date(acqMs).toISOString(),
        province: "unknown",
        fire_id_at_detection: fireId,
      };
    });

    const passes = detections.map((d) => d.pass_id);
    const firstPass = Math.min(...passes);
    const lastPass = Math.max(...passes);
    const satellites = [...new Set(detections.map((d) => d.satellite_id))];
    const meanLon =
      detections.reduce((sum, d) => sum + d.lon, 0) / Math.max(1, detections.length);
    const meanLat =
      detections.reduce((sum, d) => sum + d.lat, 0) / Math.max(1, detections.length);
    const areaKm2 = Number((Math.max(1, detections.length) * 0.140625).toFixed(4));
    const frpSum = Number(detections.reduce((sum, d) => sum + (Number(d.frp) || 0), 0).toFixed(2));

    const fire = {
      fire_final: fireId,
      lat: Number(meanLat.toFixed(6)),
      lon: Number(meanLon.toFixed(6)),
      n_det: detections.length,
      n_passes: new Set(passes).size,
      first_pass: firstPass,
      last_pass: lastPass,
      first_detection_utc: ev.first_detected,
      last_detection_utc: ev.last_detected,
      duration_h: Number(ev.duration_hours || 0),
      area_km2: areaKm2,
      frp_sum: frpSum,
      lc_forest: 0,
      lc_shrub_grass: 0,
      lc_crop: 0,
      lc_urban: 0,
      lc_bare_other: 0,
      lc_water: 0,
      fire_type: "other",
      province: "unknown",
      satellites,
      max_gap_passes: 0,
      merges_in: 0,
    };

    fireEvents.push({ fire, detections });
    features.push({
      type: "Feature",
      id: fireId,
      geometry: { type: "Point", coordinates: [fire.lon, fire.lat] },
      properties: {
        fire_final: fireId,
        n_det: fire.n_det,
        n_passes: fire.n_passes,
        first_detection_utc: fire.first_detection_utc,
        last_detection_utc: fire.last_detection_utc,
        duration_h: fire.duration_h,
        area_km2: fire.area_km2,
        frp_sum: fire.frp_sum,
        fire_type: fire.fire_type,
        province: fire.province,
        satellites: fire.satellites,
        merges_in: 0,
      },
    });
  });

  return {
    geojson: {
      type: "FeatureCollection",
      features,
      metadata: {
        n_fires: fireEvents.length,
        n_detections_in: hotspots.length,
        n_detections_tracked: fireEvents.reduce((sum, e) => sum + e.detections.length, 0),
        note: "Local fallback tracker used because remote Fire Watch API was unreachable.",
        fallback: true,
      },
    },
    fire_events: fireEvents,
  };
}

/**
 * Sends raw FIRMS hotspots (up to 14 days) to the Python backend POST /track_fires endpoint.
 */
export async function trackFiresWithBackend(hotspots = [], mask = "deployment") {
  if (!hotspots || !hotspots.length) {
    return {
      geojson: {
        type: "FeatureCollection",
        features: [],
        metadata: { n_fires: 0, n_detections_in: 0, n_detections_tracked: 0 },
      },
      fire_events: [],
    };
  }

  const cleanHotspots = hotspots.map(stripInternalFields);
  try {
    const result = await postJson(
      "/track_fires",
      { hotspots: cleanHotspots, mask },
      TRACKER_TIMEOUT_MS,
    );
    if (result && result.geojson && Array.isArray(result.fire_events)) {
      return result;
    }
    throw new Error("Unexpected /track_fires response shape");
  } catch (error) {
    console.warn("Python /track_fires failed, falling back to local tracker:", error?.message || error);
    return localTrackerFallback(hotspots);
  }
}

/**
 * Computes initial-pass (t0) hindcast snapshot for comparing initial prediction vs actual spread.
 */
export function buildHindcastSnapshot(fireEvent) {
  const fire = fireEvent?.fire;
  const detections = Array.isArray(fireEvent?.detections) ? fireEvent.detections : [];
  if (!fire || !detections.length) return null;

  const stamped = detections
    .map((det) => {
      const acqMs = detectionAcquiredMs(det);
      const passId = Number.isFinite(Number(det.pass_id))
        ? Number(det.pass_id)
        : Number.isFinite(acqMs)
          ? Math.floor(acqMs / TWELVE_HOURS_MS)
          : 0;
      return { det, acqMs, passId };
    })
    .sort((a, b) => a.passId - b.passId || (a.acqMs || 0) - (b.acqMs || 0));

  const uniquePasses = [...new Set(stamped.map((s) => s.passId))].sort((a, b) => a - b);
  const actualArea = Math.max(0.140625, Number(fire.area_km2) || 0.140625);

  if (uniquePasses.length < 2) {
    return {
      isMultiPass: false,
      initialAreaKm2: Number(actualArea.toFixed(4)),
      actualFinalAreaKm2: Number(actualArea.toFixed(4)),
      actualAddAreaKm2: 0,
      persisted: false,
      expandedActual: false,
      initialPass: uniquePasses[0] ?? fire.first_pass ?? 0,
      finalPass: uniquePasses[0] ?? fire.last_pass ?? 0,
      totalPasses: uniquePasses.length || Number(fire.n_passes) || 1,
      earlyDetections: detections,
      earlyFireEvent: fireEvent,
    };
  }

  const firstPass = uniquePasses[0];
  const earlyDetections = stamped.filter((s) => s.passId === firstPass).map((s) => s.det);

  const cells = new Set();
  let sumLat = 0;
  let sumLon = 0;
  let frpSum = 0;
  let minAcq = Infinity;
  let maxAcq = -Infinity;
  const earlySats = new Set();

  for (const det of earlyDetections) {
    const lat = Number(det.lat ?? det.latitude);
    const lon = Number(det.lon ?? det.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      sumLat += lat;
      sumLon += lon;
      cells.add(`${Math.round(lat / 0.003375)}:${Math.round(lon / 0.003375)}`);
    }
    frpSum += Number(det.frp) || 0;
    const acq = detectionAcquiredMs(det);
    if (Number.isFinite(acq)) {
      if (acq < minAcq) minAcq = acq;
      if (acq > maxAcq) maxAcq = acq;
    }
    const sat = det.satellite_id || det.sat || det.satellite;
    if (sat) earlySats.add(sat);
  }

  const count = Math.max(1, earlyDetections.length);
  const rawInitialArea = Math.max(0.140625, (cells.size || count) * 0.140625);
  const initialAreaKm2 = Number(Math.min(actualArea, rawInitialArea).toFixed(4));
  const actualAddAreaKm2 = Number(Math.max(0, actualArea - initialAreaKm2).toFixed(4));
  const expandedActual =
    actualAddAreaKm2 >= 1.0 && actualArea / Math.max(0.140625, initialAreaKm2) >= 1.25;

  const firstIso = Number.isFinite(minAcq)
    ? new Date(minAcq).toISOString()
    : fire.first_detection_utc;
  const initialLastIso = Number.isFinite(maxAcq)
    ? new Date(maxAcq).toISOString()
    : fire.first_detection_utc;

  const earlyFireEvent = {
    fire: {
      ...fire,
      lat: sumLat ? Number((sumLat / count).toFixed(6)) : fire.lat,
      lon: sumLon ? Number((sumLon / count).toFixed(6)) : fire.lon,
      n_det: earlyDetections.length,
      n_passes: 1,
      first_pass: firstPass,
      last_pass: firstPass,
      first_detection_utc: firstIso,
      last_detection_utc: initialLastIso,
      duration_h: 0,
      area_km2: initialAreaKm2,
      frp_sum: Number(frpSum.toFixed(2)),
      satellites: earlySats.size ? [...earlySats] : fire.satellites,
    },
    detections: earlyDetections,
  };

  return {
    isMultiPass: true,
    initialAreaKm2,
    actualFinalAreaKm2: Number(actualArea.toFixed(4)),
    actualAddAreaKm2,
    persisted: true,
    expandedActual,
    initialPass: firstPass,
    finalPass: uniquePasses[uniquePasses.length - 1],
    totalPasses: uniquePasses.length,
    earlyDetections,
    earlyFireEvent,
  };
}

/**
 * Filters a 14-day tracker run into recent (<=12h) and past (>12h) fire events.
 * Preserves all 14-day events for timeline scrubbing, hindcast comparison, and context_detections.
 */
export function filterRecent12Hours(trackerRun, options = {}) {
  const allFireEvents = Array.isArray(trackerRun?.fire_events) ? trackerRun.fire_events : [];
  const allFeatures = Array.isArray(trackerRun?.geojson?.features) ? trackerRun.geojson.features : [];
  const windowHours = Number(options.windowHours) || 12;
  const windowMs = windowHours * 60 * 60 * 1000;

  let latestDetectionMs = 0;
  for (const event of allFireEvents) {
    const fireMs = parseUtcMs(event?.fire?.last_detection_utc);
    if (Number.isFinite(fireMs) && fireMs > latestDetectionMs) {
      latestDetectionMs = fireMs;
    }
    for (const det of event?.detections || []) {
      const detMs = detectionAcquiredMs(det);
      if (Number.isFinite(detMs) && detMs > latestDetectionMs) {
        latestDetectionMs = detMs;
      }
    }
  }

  const referenceMs = latestDetectionMs > 0 ? latestDetectionMs : (options.windowEnd || Date.now());
  const cutoffMs = referenceMs - windowMs;

  const isRecentEvent = (event) => {
    let lastMs = parseUtcMs(event?.fire?.last_detection_utc);
    if (!Number.isFinite(lastMs)) {
      for (const det of event?.detections || []) {
        const dMs = detectionAcquiredMs(det);
        if (Number.isFinite(dMs) && (!Number.isFinite(lastMs) || dMs > lastMs)) {
          lastMs = dMs;
        }
      }
    }
    return Number.isFinite(lastMs) && lastMs >= cutoffMs;
  };

  const recentFireEvents = [];
  const pastFireEventsRaw = [];

  for (const event of allFireEvents) {
    const hindcast = buildHindcastSnapshot(event);
    if (isRecentEvent(event)) {
      recentFireEvents.push({ ...event, is_past: false, hindcast });
    } else {
      pastFireEventsRaw.push({ ...event, is_past: true, hindcast });
    }
  }

  const pastFireEvents = pastFireEventsRaw.sort((a, b) => {
    const multiA = a.hindcast?.isMultiPass ? 1 : 0;
    const multiB = b.hindcast?.isMultiPass ? 1 : 0;
    if (multiB !== multiA) return multiB - multiA;
    const frpDiff = Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0);
    if (frpDiff !== 0) return frpDiff;
    return Number(b.fire?.area_km2 || 0) - Number(a.fire?.area_km2 || 0);
  });

  const recentIds = new Set(recentFireEvents.map((e) => String(e.fire?.fire_final)));
  const recentFeatures = [];
  const taggedAllFeatures = [];

  for (const feature of allFeatures) {
    const id = feature?.properties?.fire_final ?? feature?.id;
    const isPast = !recentIds.has(String(id));
    const tagged = {
      ...feature,
      properties: {
        ...feature.properties,
        is_past: isPast,
      },
    };
    taggedAllFeatures.push(tagged);
    if (!isPast) recentFeatures.push(tagged);
  }

  const metadata = {
    ...(trackerRun?.geojson?.metadata || {}),
    n_fires_14d: allFireEvents.length,
    n_detections_in_14d: trackerRun?.geojson?.metadata?.n_detections_in ?? 0,
    n_detections_tracked_14d: trackerRun?.geojson?.metadata?.n_detections_tracked ?? 0,
    n_recent_fires_12h: recentFireEvents.length,
    n_past_fires_14d: pastFireEvents.length,
    reference_utc: new Date(referenceMs).toISOString(),
    cutoff_utc: new Date(cutoffMs).toISOString(),
    window_hours: windowHours,
  };

  return {
    recentFireEvents,
    pastFireEvents,
    recentGeoJson: {
      type: "FeatureCollection",
      features: recentFeatures,
      metadata,
    },
    allGeoJson: {
      type: "FeatureCollection",
      features: taggedAllFeatures,
      metadata,
    },
    allFireEvents: [...recentFireEvents, ...pastFireEvents],
    metadata,
  };
}

/**
 * Converts detections from recent fire_events into the compact Mapbox point tuple format.
 */
export function detectionsToPoints(fireEvents = []) {
  const points = [];
  for (const event of fireEvents) {
    const fireId = event?.fire?.fire_final ?? null;
    const sats = Array.isArray(event?.fire?.satellites) ? event.fire.satellites : [];
    const hasModis = sats.some((s) => String(s).toUpperCase().includes("MODIS"));
    const hasViirs = sats.some((s) => String(s).toUpperCase().includes("VIIRS"));
    const fireIsDual = hasModis && hasViirs;

    for (const det of event?.detections || []) {
      const lon = Number(det.lon ?? det.longitude);
      const lat = Number(det.lat ?? det.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const frp = Number(det.frp) || 0;
      const satId = String(det.satellite_id || det.sat || det.instrument || "").toUpperCase();
      const isModis =
        String(det.instrument || "").toUpperCase() === "MODIS" || satId.startsWith("MODIS");
      const sensor = isModis ? 0 : 1;
      const acquired = detectionAcquiredMs(det);
      if (!Number.isFinite(acquired)) continue;

      const evidence = fireIsDual ? 3 : sensor === 1 ? viirsEvidence(det.confidence) : 0;
      const tier = fireIsDual ? 1 : sensor === 1 ? 2 : 3;
      const confidence = det.confidence ?? null;
      const satellite = det.satellite || det.satellite_id || det.sat || null;

      points.push([
        lon,
        lat,
        Number(frp.toFixed(1)),
        sensor,
        1,
        acquired,
        null,
        evidence,
        tier,
        confidence,
        satellite,
        [],
        fireId,
      ]);
    }
  }
  return points;
}

/**
 * Calls POST /predict_all with recent VIIRS fire_events and full 14-day context_detections.
 */
export async function predictAllViirsFires(recentFireEvents = [], allFireEvents = [], options = {}) {
  if (!recentFireEvents.length) {
    return {
      type: "FeatureCollection",
      features: [],
      metadata: { status: "ok", n_events: 0, reason_code: null },
    };
  }

  const contextSource = allFireEvents.length ? allFireEvents : recentFireEvents;
  const context_detections = contextSource.flatMap((event) =>
    (event.detections || [])
      .map((det) => ({
        lat: Number(det.lat ?? det.latitude),
        lon: Number(det.lon ?? det.longitude),
        pass_id: Number(det.pass_id),
      }))
      .filter(
        (d) => Number.isFinite(d.lat) && Number.isFinite(d.lon) && Number.isFinite(d.pass_id),
      ),
  );

  try {
    const result = await postJson(
      "/predict_all",
      {
        fire_events: recentFireEvents,
        context_detections,
        data_source: options.dataSource || "NRT",
      },
      MODEL_TIMEOUT_MS,
    );
    return result;
  } catch (error) {
    console.warn("Python /predict_all failed:", error?.message || error);
    return {
      type: "FeatureCollection",
      features: [],
      metadata: {
        status: "error",
        reason_code: "API_ERROR",
        error: error?.message || "Prediction service unavailable",
        n_events: 0,
      },
    };
  }
}

/**
 * Calls POST /calculate_hazard for one VIIRS fire_event.
 */
export async function calculateHazardForFire(fireEvent) {
  if (!fireEvent?.fire) return null;
  return postJson("/calculate_hazard", { fire_event: fireEvent }, MODEL_TIMEOUT_MS);
}

/**
 * Calls POST /predict_event for one VIIRS fire_event.
 */
export async function predictSingleFireEvent(fireEvent, contextDetections = [], options = {}) {
  if (!fireEvent?.fire) return null;
  const payload = {
    fire_event: fireEvent,
    data_source: options.dataSource || "NRT",
  };
  if (Array.isArray(contextDetections) && contextDetections.length) {
    payload.context_detections = contextDetections;
  }
  return postJson("/predict_event", payload, MODEL_TIMEOUT_MS);
}

/**
 * Preloads hazard ratings for the top-FRP recent VIIRS fires in parallel batches.
 */
export async function calculateHazardForFires(
  recentFireEvents = [],
  { concurrency = 16, maxPreload = 16 } = {},
) {
  if (!recentFireEvents.length) return {};

  const sorted = [...recentFireEvents]
    .sort((a, b) => Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0))
    .slice(0, maxPreload);

  const hazardById = {};
  for (let i = 0; i < sorted.length; i += concurrency) {
    const batch = sorted.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((fireEvent) =>
        calculateHazardForFire(fireEvent).catch((error) => {
          console.warn(
            `Hazard failed for fire ${fireEvent?.fire?.fire_final}:`,
            error?.message || error,
          );
          return null;
        }),
      ),
    );
    batch.forEach((fireEvent, index) => {
      const res = results[index];
      const id = String(fireEvent?.fire?.fire_final);
      if (res && id) hazardById[id] = res;
    });
  }
  return hazardById;
}

/**
 * Runs both /predict_all and /calculate_hazard for recent VIIRS fires plus top past hindcast fires,
 * merging prediction + hazard metadata into each fire_event and GeoJSON feature.
 */
export async function buildViirsModelBundle(recentViirsRun, allViirsFireEvents, options = {}) {
  const recentFireEvents = recentViirsRun?.recentFireEvents || [];
  const pastFireEvents = recentViirsRun?.pastFireEvents || [];
  const recentGeoJson = recentViirsRun?.recentGeoJson || {
    type: "FeatureCollection",
    features: [],
    metadata: {},
  };
  const allGeoJson = recentViirsRun?.allGeoJson || recentGeoJson;

  const topPastEarlyEvents = pastFireEvents
    .slice(0, 25)
    .map((event) => event?.hindcast?.earlyFireEvent)
    .filter((early) => Boolean(early?.fire));

  const topRecentForHazard = [...recentFireEvents]
    .sort((a, b) => Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0))
    .slice(0, 16);
  const topPastForHazard = pastFireEvents.slice(0, 8);
  const hazardTargets = [...topRecentForHazard, ...topPastForHazard];

  const [predictionsGeoJson, pastPredictionsGeoJson, hazardById] = await Promise.all([
    predictAllViirsFires(recentFireEvents, allViirsFireEvents, options),
    topPastEarlyEvents.length
      ? predictAllViirsFires(topPastEarlyEvents, allViirsFireEvents, options)
      : Promise.resolve({ type: "FeatureCollection", features: [], metadata: {} }),
    calculateHazardForFires(hazardTargets, { ...options, maxPreload: 24 }),
  ]);

  const predictionById = new Map();
  for (const feature of predictionsGeoJson?.features || []) {
    const props = feature?.properties;
    if (!props) continue;
    if (props.role === "predicted_footprint" && props.event_id !== undefined) {
      predictionById.set(String(props.event_id), props);
    }
  }

  const pastPredictionById = new Map();
  for (const feature of pastPredictionsGeoJson?.features || []) {
    const props = feature?.properties;
    if (!props) continue;
    if (props.role === "predicted_footprint" && props.event_id !== undefined) {
      pastPredictionById.set(String(props.event_id), props);
    }
  }

  let expandingCount = 0;
  let highHazardCount = 0;
  let maxHazardScore = 0;
  let maxHazardRating = null;
  let persistenceSum = 0;
  let persistenceCount = 0;
  let maxPersistenceProb = 0;
  let totalProjectedAddAreaKm2 = 0;

  const enrichedEvents = recentFireEvents.map((event) => {
    const id = String(event?.fire?.fire_final);
    const prediction = predictionById.get(id) ?? null;
    const hazard = hazardById[id] ?? null;

    if (prediction) {
      if (prediction.prediction_status === "expansion_likely") expandingCount++;
      if (typeof prediction.persistence_probability === "number") {
        persistenceSum += prediction.persistence_probability;
        persistenceCount++;
        if (prediction.persistence_probability > maxPersistenceProb) {
          maxPersistenceProb = prediction.persistence_probability;
        }
      }
      if (typeof prediction.predicted_additional_area_km2 === "number") {
        totalProjectedAddAreaKm2 += prediction.predicted_additional_area_km2;
      }
    }

    if (hazard && typeof hazard.hazard_score === "number") {
      if (hazard.hazard_score >= 26) highHazardCount++;
      if (hazard.hazard_score >= maxHazardScore) {
        maxHazardScore = hazard.hazard_score;
        maxHazardRating = hazard.hazard_rating || maxHazardRating;
      }
    }

    return {
      ...event,
      prediction,
      hazard,
    };
  });

  const enrichedPastEvents = pastFireEvents.map((event) => {
    const id = String(event?.fire?.fire_final);
    return {
      ...event,
      prediction: pastPredictionById.get(id) ?? null,
      hazard: hazardById[id] ?? null,
    };
  });

  const enrichFeature = (feature) => {
    const id = String(feature?.properties?.fire_final ?? feature?.id);
    const prediction = predictionById.get(id) ?? pastPredictionById.get(id) ?? null;
    const hazard = hazardById[id] ?? null;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        hazard_score: hazard?.hazard_score ?? null,
        hazard_rating: hazard?.hazard_rating ?? null,
        persistence_probability: prediction?.persistence_probability ?? null,
        expansion_probability: prediction?.expansion_probability ?? null,
        prediction_status: prediction?.prediction_status ?? null,
        predicted_additional_area_km2: prediction?.predicted_additional_area_km2 ?? null,
        predicted_total_area_km2: prediction?.predicted_total_area_km2 ?? null,
        confidence: prediction?.confidence ?? null,
        data_quality: prediction?.data_quality ?? hazard?.data_quality ?? null,
      },
    };
  };

  const enrichedFeatures = (recentGeoJson.features || []).map(enrichFeature);
  const enrichedAllFeatures = (allGeoJson.features || []).map(enrichFeature);

  const modelSummary = {
    predictedCount: predictionById.size,
    hazardEvaluatedCount: Object.keys(hazardById).length,
    totalRecentFires: enrichedEvents.length,
    expandingCount,
    highHazardCount,
    maxHazardScore,
    maxHazardRating,
    avgPersistenceProb: persistenceCount
      ? Number((persistenceSum / persistenceCount).toFixed(4))
      : 0,
    maxPersistenceProb: Number(maxPersistenceProb.toFixed(4)),
    totalProjectedAddAreaKm2: Number(totalProjectedAddAreaKm2.toFixed(3)),
    predictionStatus: predictionsGeoJson?.metadata?.status || "ok",
    predictionReasonCode: predictionsGeoJson?.metadata?.reason_code || null,
    modelVersion: predictionsGeoJson?.metadata?.model_version || "2.0.0",
  };

  return {
    fire_events: enrichedEvents,
    past_fire_events: enrichedPastEvents,
    geojson: {
      ...recentGeoJson,
      features: enrichedFeatures,
    },
    allGeoJson: {
      ...allGeoJson,
      features: enrichedAllFeatures,
    },
    predictionsGeoJson,
    pastPredictionsGeoJson,
    modelSummary,
  };
}

function approxDistanceKm(lat1, lon1, lat2, lon2) {
  const avgLatRad = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(avgLatRad);
  return Math.hypot(dLat, dLon);
}

/**
 * Matches recent & past combined (MODIS + VIIRS) fire events to enriched VIIRS events
 * by shared detection coordinates or centroid proximity (<= 1.5 km), copying
 * VIIRS hazard ratings and ML prediction metadata onto the combined events and GeoJSON.
 */
export function attachViirsModelsToCombined(combinedRecent, viirsEnriched) {
  const combinedRecentEvents = combinedRecent?.recentFireEvents || [];
  const combinedPastEvents = combinedRecent?.pastFireEvents || [];
  const allViirsEvents = [
    ...(viirsEnriched?.fire_events || []),
    ...(viirsEnriched?.past_fire_events || []),
  ];
  if ((!combinedRecentEvents.length && !combinedPastEvents.length) || !allViirsEvents.length) {
    return combinedRecent;
  }

  const viirsByDetCoord = new Map();
  const viirsWithCoords = [];

  for (const vEvent of allViirsEvents) {
    for (const det of vEvent?.detections || []) {
      const lat = Number(det.lat ?? det.latitude);
      const lon = Number(det.lon ?? det.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        viirsByDetCoord.set(`${lat.toFixed(4)}:${lon.toFixed(4)}`, vEvent);
      }
    }
    const vLat = Number(vEvent?.fire?.lat);
    const vLon = Number(vEvent?.fire?.lon);
    if (Number.isFinite(vLat) && Number.isFinite(vLon)) {
      viirsWithCoords.push({ event: vEvent, lat: vLat, lon: vLon });
    }
  }

  const matchByCombinedId = new Map();

  const hasEventViirsEvidence = (event) => {
    const sats = event?.fire?.satellites || [];
    if (sats.some((s) => String(s).toUpperCase().includes("VIIRS"))) return true;
    return (event?.detections || []).some((d) => {
      if (d?._sensor === 1) return true;
      const inst = String(
        d?.instrument || d?.satellite_id || d?.sat || d?.satellite || "",
      ).toUpperCase();
      return (
        inst.includes("VIIRS") ||
        inst === "N" ||
        inst === "N20" ||
        inst === "N21" ||
        inst === "1"
      );
    });
  };

  const attachMatch = (cEvent) => {
    if (!hasEventViirsEvidence(cEvent)) return cEvent;
    let matchedViirs = null;

    for (const det of cEvent?.detections || []) {
      const lat = Number(det.lat ?? det.latitude);
      const lon = Number(det.lon ?? det.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const hit = viirsByDetCoord.get(`${lat.toFixed(4)}:${lon.toFixed(4)}`);
      if (hit) {
        matchedViirs = hit;
        break;
      }
    }

    if (!matchedViirs) {
      const cLat = Number(cEvent?.fire?.lat);
      const cLon = Number(cEvent?.fire?.lon);
      if (Number.isFinite(cLat) && Number.isFinite(cLon)) {
        let bestDist = 1.5;
        for (const candidate of viirsWithCoords) {
          if (Math.abs(candidate.lat - cLat) > 0.02 || Math.abs(candidate.lon - cLon) > 0.03) {
            continue;
          }
          const distKm = approxDistanceKm(cLat, cLon, candidate.lat, candidate.lon);
          if (distKm <= bestDist) {
            bestDist = distKm;
            matchedViirs = candidate.event;
          }
        }
      }
    }

    if (!matchedViirs) return cEvent;

    const cId = String(cEvent?.fire?.fire_final ?? "");
    if (cId) matchByCombinedId.set(cId, matchedViirs);

    return {
      ...cEvent,
      hazard: matchedViirs.hazard ?? cEvent.hazard ?? null,
      prediction: matchedViirs.prediction ?? cEvent.prediction ?? null,
      viirs_fire_final: matchedViirs.fire?.fire_final ?? null,
    };
  };

  const updatedRecentEvents = combinedRecentEvents.map(attachMatch);
  const updatedPastEvents = combinedPastEvents.map(attachMatch);

  const enrichFeatureList = (features = []) =>
    features.map((feature) => {
      const id = String(feature?.properties?.fire_final ?? feature?.id ?? "");
      const matched = matchByCombinedId.get(id);
      if (!matched) return feature;

      const hazard = matched.hazard ?? null;
      const prediction = matched.prediction ?? null;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          viirs_fire_final: matched.fire?.fire_final ?? null,
          hazard_score: hazard?.hazard_score ?? feature.properties?.hazard_score ?? null,
          hazard_rating: hazard?.hazard_rating ?? feature.properties?.hazard_rating ?? null,
          persistence_probability:
            prediction?.persistence_probability ?? feature.properties?.persistence_probability ?? null,
          expansion_probability:
            prediction?.expansion_probability ?? feature.properties?.expansion_probability ?? null,
          prediction_status:
            prediction?.prediction_status ?? feature.properties?.prediction_status ?? null,
          predicted_additional_area_km2:
            prediction?.predicted_additional_area_km2 ??
            feature.properties?.predicted_additional_area_km2 ??
            null,
          predicted_total_area_km2:
            prediction?.predicted_total_area_km2 ??
            feature.properties?.predicted_total_area_km2 ??
            null,
          confidence: prediction?.confidence ?? feature.properties?.confidence ?? null,
          data_quality:
            prediction?.data_quality ??
            hazard?.data_quality ??
            feature.properties?.data_quality ??
            null,
        },
      };
    });

  const existingGeo = combinedRecent?.recentGeoJson || {
    type: "FeatureCollection",
    features: [],
    metadata: {},
  };
  const existingAllGeo = combinedRecent?.allGeoJson || existingGeo;

  return {
    ...combinedRecent,
    recentFireEvents: updatedRecentEvents,
    pastFireEvents: updatedPastEvents,
    recentGeoJson: {
      ...existingGeo,
      features: enrichFeatureList(existingGeo.features),
    },
    allGeoJson: {
      ...existingAllGeo,
      features: enrichFeatureList(existingAllGeo.features),
    },
  };
}

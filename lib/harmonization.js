const EARTH_RADIUS_KM = 6371.0088;
const MATCH_RADIUS_KM = 1;
const HASH_CELL_KM = 4;
const COINCIDENT_WINDOW_MS = 90 * 60 * 1000;
const DRIFT_COINCIDENT_WINDOW_MS = 3 * 60 * 60 * 1000;
const BRIDGED_WINDOW_MS = 5.5 * 60 * 60 * 1000;
const SWATH_CHECK_WINDOW_MS = 60 * 60 * 1000;
const SWATH_CHECK_RADIUS_KM = 35;
const KINEMATIC_SPREAD_KMH = 0.5;

// These are ordinal evidence levels, not probabilities.
export function viirsEvidence(raw) {
  const confidence = String(raw ?? "").trim().toLowerCase();
  if (confidence === "h" || confidence === "high") return 2;
  if (confidence === "n" || confidence === "nominal") return 1;
  return 0;
}

/**
 * Estimates mean local solar hour in [0, 24) from a UTC epoch timestamp and longitude.
 */
export function localSolarHour(utcMs, lon) {
  if (!Number.isFinite(utcMs) || !Number.isFinite(lon)) return null;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return ((utcHours + lon / 15) % 24 + 24) % 24;
}

/**
 * Classifies an observation into the ~13:30 afternoon overpass family, Terra morning,
 * or nighttime/off-peak pass, and flags daytime Terra/Aqua orbital drift.
 */
export function classifyOverpassFamily(utcMs, lon, satellite) {
  const solarHour = localSolarHour(utcMs, lon);
  if (solarHour === null) {
    return {
      family: "unknown",
      localSolarHour: null,
      driftDetected: false,
      isAfternoonFamily: false,
    };
  }

  const sat = String(satellite ?? "").trim().toUpperCase();
  const isTerra = sat === "T" || sat.includes("TERRA");
  const isAqua = sat === "A" || sat.includes("AQUA");

  let family = "night_offpeak";
  let isAfternoonFamily = false;
  let driftDetected = false;

  if (isTerra && solarHour >= 6 && solarHour < 16) {
    family = "terra_morning";
    driftDetected = solarHour < 9.25 || solarHour > 11.75;
  } else if (solarHour >= 11 && solarHour <= 16 && !isTerra) {
    family = "afternoon_1330";
    isAfternoonFamily = true;
    driftDetected = isAqua && (solarHour < 12.25 || solarHour > 15.0);
  } else if (isAqua && solarHour >= 10 && solarHour < 18) {
    family = "afternoon_1330";
    isAfternoonFamily = true;
    driftDetected = solarHour < 12.25 || solarHour > 15.0;
  }

  return {
    family,
    localSolarHour: Number(solarHour.toFixed(2)),
    driftDetected,
    isAfternoonFamily,
  };
}

/**
 * Step 1 cross-sensor consistency filter: MODIS confidence >= 30% or VIIRS nominal/high.
 */
export function isCrossSensorConsistent(sensor, confidence) {
  if (sensor === 0) {
    if (confidence === null || confidence === undefined) return false;
    const trimmed = String(confidence).trim().toLowerCase();
    if (!trimmed) return false;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric >= 30;
    return trimmed === "n" || trimmed === "nominal" || trimmed === "h" || trimmed === "high";
  }
  if (sensor === 1) {
    if (confidence === null || confidence === undefined) return false;
    const trimmed = String(confidence).trim().toLowerCase();
    if (!trimmed) return false;
    if (trimmed === "n" || trimmed === "nominal" || trimmed === "h" || trimmed === "high") {
      return true;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric >= 30;
  }
  return false;
}

function coordinates(lon, lat) {
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180;
  const horizontal = EARTH_RADIUS_KM * Math.cos(latitude);
  return [
    horizontal * Math.cos(longitude),
    horizontal * Math.sin(longitude),
    EARTH_RADIUS_KM * Math.sin(latitude),
  ];
}

function cell(position) {
  return position.map((value) => Math.floor(value / HASH_CELL_KM));
}

function distanceKm(a, b) {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Pillar 2 — Elliptical GIFOV sub-footprint containment test using FIRMS scan/track geometry.
 */
export function isInsideGifovEllipse(modisObs, viirsObs, extraRadiusKm = 0) {
  if (!modisObs || !viirsObs) return false;
  const scanM = Number.isFinite(Number(modisObs.scan)) && Number(modisObs.scan) > 0 ? Number(modisObs.scan) : 1.0;
  const trackM = Number.isFinite(Number(modisObs.track)) && Number(modisObs.track) > 0 ? Number(modisObs.track) : 1.0;
  const scanV = Number.isFinite(Number(viirsObs.scan)) && Number(viirsObs.scan) > 0 ? Number(viirsObs.scan) : 0.375;
  const trackV = Number.isFinite(Number(viirsObs.track)) && Number(viirsObs.track) > 0 ? Number(viirsObs.track) : 0.375;

  const avgLatRad = (((modisObs.lat + viirsObs.lat) / 2) * Math.PI) / 180;
  const dxKm = (viirsObs.lon - modisObs.lon) * 111.32 * Math.cos(avgLatRad);
  const dyKm = (viirsObs.lat - modisObs.lat) * 111.32;
  const sigmaGeo = 0.25;
  const a = Math.max(MATCH_RADIUS_KM, 0.5 * scanM + 0.5 * scanV + sigmaGeo + extraRadiusKm);
  const b = Math.max(MATCH_RADIUS_KM, 0.5 * trackM + 0.5 * trackV + sigmaGeo + extraRadiusKm);
  return (dxKm * dxKm) / (a * a) + (dyKm * dyKm) / (b * b) <= 1;
}

function observation(row) {
  const [lon, lat, frp, sensor, acquired, confidence = null, satellite = null, scan = null, track = null] = row;
  if (
    !Number.isFinite(lon) || lon < -180 || lon > 180 ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(frp) || !Number.isFinite(acquired) ||
    (sensor !== 0 && sensor !== 1)
  ) {
    throw new TypeError("Invalid FIRMS observation");
  }
  const defaultRes = sensor === 0 ? 1.0 : 0.375;
  const scanKm = Number.isFinite(Number(scan)) && Number(scan) > 0 ? Number(scan) : defaultRes;
  const trackKm = Number.isFinite(Number(track)) && Number(track) > 0 ? Number(track) : defaultRes;
  return {
    lon,
    lat,
    frp,
    sensor,
    acquired,
    confidence,
    satellite,
    scan: scanKm,
    track: trackKm,
    matched: false,
    demoted: false,
    tier: sensor === 1 ? 2 : 3,
    regime: null,
    frpRatio: null,
    matches: [],
  };
}

function rawRow(record) {
  return [
    record.lon,
    record.lat,
    record.frp,
    record.sensor,
    record.acquired,
    record.confidence,
    record.satellite,
    Number(record.scan.toFixed(2)),
    Number(record.track.toFixed(2)),
  ];
}

function resultRow(record) {
  const evidence = record.matched ? 3 : record.sensor === 1 ? viirsEvidence(record.confidence) : 0;
  const tier = record.matched
    ? 1
    : record.demoted
      ? 4
      : record.sensor === 1
        ? (isCrossSensorConsistent(1, record.confidence) ? 2 : 4)
        : (isCrossSensorConsistent(0, record.confidence) ? 3 : 4);
  const overpass = classifyOverpassFamily(record.acquired, record.lon, record.satellite);
  const meta = {
    scan: Number(record.scan.toFixed(2)),
    track: Number(record.track.toFixed(2)),
    regime: record.regime,
    frpRatio: record.frpRatio,
    overpassFamily: overpass.family,
    localSolarHour: overpass.localSolarHour,
    driftDetected: overpass.driftDetected,
  };
  return [
    record.lon, record.lat, record.frp, record.sensor, 1, record.acquired,
    null, evidence, tier, record.confidence, record.satellite, record.matches, meta,
  ];
}

/**
 * 3-Pillar SSOT MODIS-VIIRS Harmonization:
 * - Lifecycle hierarchy: VIIRS 375 m is primary reference; MODIS acts as Bayesian corroborator / gap-filler.
 * - Optical lens physics: GIFOV (scan x track) elliptical sub-footprint matching + non-additive FRP reconciliation.
 * - Time-delay regimes: (1) Coincident dual <= 90m/3h, (2) Kinematic diurnal bridging <= 5.5h,
 *   (3) Overpass-aware MODIS false-alarm gating vs gap-fill uncertainty nodes.
 */
export function harmonizeHotspotsWithDiagnostics(rows = [], options = {}) {
  const {
    coincidenceWindowMs: customWindowMs,
    adaptiveDrift = true,
    filterInconsistent = false,
  } = options || {};

  const unique = new Map();
  let driftSeen = false;
  for (const row of rows) {
    const record = observation(row);
    if (filterInconsistent && !isCrossSensorConsistent(record.sensor, record.confidence)) {
      continue;
    }
    if (adaptiveDrift && !driftSeen) {
      driftSeen = classifyOverpassFamily(record.acquired, record.lon, record.satellite).driftDetected;
    }
    const key = JSON.stringify([record.sensor, record.satellite, record.acquired, record.lon, record.lat]);
    const existing = unique.get(key);
    if (!existing || record.frp > existing.frp) unique.set(key, record);
  }

  const hasCustom = Number.isFinite(Number(customWindowMs)) && Number(customWindowMs) > 0;
  const coincidentMs = hasCustom
    ? Math.min(Number(customWindowMs), DRIFT_COINCIDENT_WINDOW_MS)
    : adaptiveDrift && driftSeen
      ? DRIFT_COINCIDENT_WINDOW_MS
      : COINCIDENT_WINDOW_MS;
  const bridgedMs = hasCustom
    ? Math.max(BRIDGED_WINDOW_MS, Number(customWindowMs))
    : BRIDGED_WINDOW_MS;

  const viirs = [];
  const modis = [];
  const cells = new Map();
  for (const record of unique.values()) {
    if (record.sensor === 0) {
      modis.push(record);
      continue;
    }
    viirs.push(record);
    const key = cell(coordinates(record.lon, record.lat)).join(":");
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record);
  }

  const collectNeighbors = (coarse, maxDtMs) => {
    const [x, y, z] = cell(coordinates(coarse.lon, coarse.lat));
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (const fine of cells.get(`${x + dx}:${y + dy}:${z + dz}`) ?? []) {
            const dt = Math.abs(coarse.acquired - fine.acquired);
            if (dt <= maxDtMs) candidates.push({ fine, dt });
          }
        }
      }
    }
    return candidates;
  };

  // Regime 1: Coincident / near-simultaneous pass (<= 90m nominal, <= 3h drift)
  for (const coarse of modis) {
    const candidates = collectNeighbors(coarse, coincidentMs);
    const enclosed = [];
    let nearest = null;
    let nearestDist = Infinity;

    for (const { fine } of candidates) {
      if (!isInsideGifovEllipse(coarse, fine, 0)) continue;
      enclosed.push(fine);
      const d = distanceKm(coarse, fine);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fine;
      }
    }

    if (enclosed.length > 0 && nearest) {
      coarse.matched = true;
      coarse.regime = "coincident_dual";
      const sumViirsFrp = enclosed.reduce((s, f) => s + f.frp, 0);
      const frpRatio = sumViirsFrp > 0.1 ? Number((coarse.frp / sumViirsFrp).toFixed(2)) : null;
      for (const fine of enclosed) {
        fine.matched = true;
        fine.regime = "coincident_dual";
        if (fine.frpRatio === null && frpRatio !== null) fine.frpRatio = frpRatio;
      }
      nearest.matches.push(rawRow(coarse));
    }
  }

  // Regime 2: Diurnal sequential bridging (e.g. morning Terra -> afternoon VIIRS, up to 5.5h)
  for (const coarse of modis) {
    if (coarse.matched) continue;
    const candidates = collectNeighbors(coarse, bridgedMs);
    const enclosed = [];
    let nearest = null;
    let nearestDist = Infinity;

    for (const { fine, dt } of candidates) {
      const deltaHours = dt / 3600000;
      const extraRadiusKm = KINEMATIC_SPREAD_KMH * Math.max(0, deltaHours - 1.0);
      if (!isInsideGifovEllipse(coarse, fine, extraRadiusKm)) continue;
      enclosed.push(fine);
      const d = distanceKm(coarse, fine);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fine;
      }
    }

    if (enclosed.length > 0 && nearest) {
      coarse.matched = true;
      coarse.regime = "diurnal_bridged";
      const sumViirsFrp = enclosed.reduce((s, f) => s + f.frp, 0);
      const frpRatio = sumViirsFrp > 0.1 ? Number((coarse.frp / sumViirsFrp).toFixed(2)) : null;
      for (const fine of enclosed) {
        fine.matched = true;
        if (fine.regime !== "coincident_dual") fine.regime = "diurnal_bridged";
        if (fine.frpRatio === null && frpRatio !== null) fine.frpRatio = frpRatio;
      }
      nearest.matches.push(rawRow(coarse));
    }
  }

  // Regime 3: Remaining unmatched detections + VIIRS swath check for solo MODIS false-alarm gating
  for (const fine of viirs) {
    if (fine.matched) continue;
    fine.regime = isCrossSensorConsistent(1, fine.confidence)
      ? "sub_resolution_viirs"
      : "low_conf_viirs";
  }

  let swathCells = null;
  const ensureSwathIndex = () => {
    if (swathCells) return swathCells;
    swathCells = new Map();
    for (const fine of viirs) {
      const key = `${Math.floor(fine.lat / 0.35)}:${Math.floor(fine.lon / 0.35)}`;
      if (!swathCells.has(key)) swathCells.set(key, []);
      swathCells.get(key).push(fine);
    }
    return swathCells;
  };

  for (const coarse of modis) {
    if (coarse.matched) continue;
    if (!isCrossSensorConsistent(0, coarse.confidence)) {
      coarse.demoted = true;
      coarse.regime = "low_conf_modis";
      continue;
    }

    const idx = ensureSwathIndex();
    const gx = Math.floor(coarse.lat / 0.35);
    const gy = Math.floor(coarse.lon / 0.35);
    let viirsSwathPresent = false;
    for (let dx = -1; dx <= 1 && !viirsSwathPresent; dx++) {
      for (let dy = -1; dy <= 1 && !viirsSwathPresent; dy++) {
        for (const fine of idx.get(`${gx + dx}:${gy + dy}`) ?? []) {
          if (
            Math.abs(coarse.acquired - fine.acquired) <= SWATH_CHECK_WINDOW_MS &&
            distanceKm(coarse, fine) <= SWATH_CHECK_RADIUS_KM
          ) {
            viirsSwathPresent = true;
            break;
          }
        }
      }
    }

    const numConf = Number(coarse.confidence);
    if (viirsSwathPresent && ((Number.isFinite(numConf) && numConf < 50) || coarse.scan > 2.5)) {
      coarse.demoted = true;
      coarse.regime = "demoted_modis_anomaly";
    } else {
      coarse.regime = "modis_gap_fill";
    }
  }

  const output = [
    ...viirs.map(resultRow),
    ...modis.filter((record) => !record.matched).map(resultRow),
  ];

  const ssotSummary = {
    coincidentDual: 0,
    diurnalBridged: 0,
    subResolutionViirs: 0,
    modisGapFill: 0,
    demotedAnomalies: 0,
    lowConfFiltered: 0,
    suppressedModisDuplicates: modis.filter((r) => r.matched).length,
    meanFrpRatio: null,
    coincidentWindowMin: Math.round(coincidentMs / 60000),
    bridgedWindowHours: Number((bridgedMs / 3600000).toFixed(1)),
    driftDetected: driftSeen,
  };

  let frpRatioSum = 0;
  let frpRatioCount = 0;
  for (const row of output) {
    const meta = row[12];
    const regime = meta?.regime;
    if (regime === "coincident_dual") ssotSummary.coincidentDual++;
    else if (regime === "diurnal_bridged") ssotSummary.diurnalBridged++;
    else if (regime === "sub_resolution_viirs") ssotSummary.subResolutionViirs++;
    else if (regime === "modis_gap_fill") ssotSummary.modisGapFill++;
    else if (regime === "demoted_modis_anomaly") ssotSummary.demotedAnomalies++;
    else if (regime === "low_conf_viirs" || regime === "low_conf_modis") ssotSummary.lowConfFiltered++;

    if (typeof meta?.frpRatio === "number" && Number.isFinite(meta.frpRatio)) {
      frpRatioSum += meta.frpRatio;
      frpRatioCount++;
    }
  }
  if (frpRatioCount > 0) {
    ssotSummary.meanFrpRatio = Number((frpRatioSum / frpRatioCount).toFixed(2));
  }

  return { rows: output, ssotSummary };
}

export function harmonizeHotspots(rows = [], options = {}) {
  return harmonizeHotspotsWithDiagnostics(rows, options).rows;
}

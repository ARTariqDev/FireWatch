import {
  classifyOverpassFamily,
  isCrossSensorConsistent,
} from "./harmonization.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CELL_1KM_DEG = 0.009;
const CELL_025_DEG = 0.25;
const PRIOR_VIIRS_TO_MODIS_RATIO = 0.34;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const current = sortedValues[base];
  const next = sortedValues[base + 1] ?? current;
  return current + rest * (next - current);
}

function wilsonCi95(successes, total) {
  if (!total || total <= 0) return null;
  const z = 1.96;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return [
    Number(Math.max(0, center - half).toFixed(3)),
    Number(Math.min(1, center + half).toFixed(3)),
  ];
}

function extractRecord(item) {
  const h = item?.trackerHotspot || item;
  if (!h) return null;

  const lon = Number(h.longitude ?? h.lon ?? item?.row?.[0]);
  const lat = Number(h.latitude ?? h.lat ?? item?.row?.[1]);
  const frp = Number(h.frp ?? item?.row?.[2]) || 0;
  const sensor =
    h._sensor !== undefined
      ? Number(h._sensor)
      : String(h.instrument || "").toUpperCase() === "MODIS"
        ? 0
        : Number(item?.row?.[3] ?? 1);

  let acquired = Number(h._acquired ?? item?.row?.[4]);
  if (!Number.isFinite(acquired) && typeof h.acq_datetime_utc === "string") {
    acquired = Date.parse(h.acq_datetime_utc);
  }
  if (!Number.isFinite(acquired) && h.acq_date && h.acq_time !== undefined) {
    const hhmm = String(h.acq_time).padStart(4, "0");
    acquired = Date.parse(`${h.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  }

  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(acquired)) {
    return null;
  }

  return {
    lon,
    lat,
    frp,
    sensor,
    acquired,
    confidence: h.confidence ?? item?.row?.[5] ?? null,
    satellite: h.satellite ?? h.satellite_id ?? item?.row?.[6] ?? null,
  };
}

/**
 * Step 1 & 2 (Layer A): Applies comparable confidence filtering (MODIS >= 30%,
 * VIIRS nominal+high), classifies local overpass times/drift, and aggregates
 * detections into 1 km (~0.009 deg) and 0.25 deg hotspot-cell-days across 14 days.
 */
export function aggregateCellDays(items14d = []) {
  const byDay = new Map();
  let rawCount = 0;
  let consistentCount = 0;
  let afternoonCount = 0;
  let terraMorningCount = 0;
  let nightOffpeakCount = 0;
  let driftDetections = 0;
  let latestMs = -Infinity;

  for (const rawItem of items14d) {
    const rec = extractRecord(rawItem);
    if (!rec) continue;
    rawCount++;
    if (rec.acquired > latestMs) latestMs = rec.acquired;

    if (!isCrossSensorConsistent(rec.sensor, rec.confidence)) continue;
    consistentCount++;

    const overpass = classifyOverpassFamily(rec.acquired, rec.lon, rec.satellite);
    if (overpass.isAfternoonFamily) afternoonCount++;
    else if (overpass.family === "terra_morning") terraMorningCount++;
    else nightOffpeakCount++;
    if (overpass.driftDetected) driftDetections++;

    const dateKey = new Date(rec.acquired).toISOString().slice(0, 10);
    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, {
        date: dateKey,
        modisCells1km: new Set(),
        viirsCells1km: new Set(),
        combinedCells1km: new Set(),
        modisCells025: new Set(),
        viirsCells025: new Set(),
        combinedCells025: new Set(),
        modisFrpSum: 0,
        viirsFrpSum: 0,
        modisDetections: 0,
        viirsDetections: 0,
        afternoonDetections: 0,
        driftDetected: false,
      });
    }

    const bucket = byDay.get(dateKey);
    const cell1km = `${Math.floor(rec.lat / CELL_1KM_DEG)}:${Math.floor(rec.lon / CELL_1KM_DEG)}`;
    const cell025 = `${Math.floor(rec.lat / CELL_025_DEG)}:${Math.floor(rec.lon / CELL_025_DEG)}`;

    bucket.combinedCells1km.add(cell1km);
    bucket.combinedCells025.add(cell025);
    if (overpass.isAfternoonFamily) bucket.afternoonDetections++;
    if (overpass.driftDetected) bucket.driftDetected = true;

    if (rec.sensor === 0) {
      bucket.modisCells1km.add(cell1km);
      bucket.modisCells025.add(cell025);
      bucket.modisFrpSum += rec.frp;
      bucket.modisDetections++;
    } else {
      bucket.viirsCells1km.add(cell1km);
      bucket.viirsCells025.add(cell025);
      bucket.viirsFrpSum += rec.frp;
      bucket.viirsDetections++;
    }
  }

  const endMs = Number.isFinite(latestMs)
    ? Date.parse(`${new Date(latestMs).toISOString().slice(0, 10)}T00:00:00Z`)
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  const days = [];
  for (let offset = 13; offset >= 0; offset--) {
    const dateKey = new Date(endMs - offset * DAY_MS).toISOString().slice(0, 10);
    const b = byDay.get(dateKey);
    if (!b) {
      days.push({
        date: dateKey,
        modisCellDays: 0,
        viirsCellDays: 0,
        combinedCellDays: 0,
        modisRegionalCells: 0,
        viirsRegionalCells: 0,
        combinedRegionalCells: 0,
        modisFrpSum: 0,
        viirsFrpSum: 0,
        totalFrpSum: 0,
        modisDetections: 0,
        viirsDetections: 0,
        afternoonShare: null,
        driftDetected: false,
      });
      continue;
    }

    const totalDayDet = b.modisDetections + b.viirsDetections;
    days.push({
      date: dateKey,
      modisCellDays: b.modisCells1km.size,
      viirsCellDays: b.viirsCells1km.size,
      combinedCellDays: b.combinedCells1km.size,
      modisRegionalCells: b.modisCells025.size,
      viirsRegionalCells: b.viirsCells025.size,
      combinedRegionalCells: b.combinedCells025.size,
      modisFrpSum: Number(b.modisFrpSum.toFixed(1)),
      viirsFrpSum: Number(b.viirsFrpSum.toFixed(1)),
      totalFrpSum: Number((b.modisFrpSum + b.viirsFrpSum).toFixed(1)),
      modisDetections: b.modisDetections,
      viirsDetections: b.viirsDetections,
      afternoonShare: totalDayDet > 0 ? Number((b.afternoonDetections / totalDayDet).toFixed(3)) : null,
      driftDetected: b.driftDetected,
    });
  }

  return {
    days,
    totals: {
      rawDetections: rawCount,
      consistentDetections: consistentCount,
      filteredOutDetections: Math.max(0, rawCount - consistentCount),
      afternoonDetections: afternoonCount,
      terraMorningDetections: terraMorningCount,
      nightOffpeakDetections: nightOffpeakCount,
      afternoonShare:
        consistentCount > 0 ? Number((afternoonCount / consistentCount).toFixed(3)) : 0,
      driftDetections,
      driftDetected: driftDetections > 0,
    },
  };
}

function fitPredictor(activePairs) {
  const modisActiveDays = activePairs.filter((p) => p.modisCellDays > 0).length;
  const sumModis = activePairs.reduce((s, p) => s + p.modisCellDays, 0);
  const sumViirs = activePairs.reduce((s, p) => s + p.viirsCellDays, 0);

  if (activePairs.length >= 4 && modisActiveDays >= 3) {
    const xs = activePairs.map((p) => Math.log1p(p.viirsCellDays));
    const ys = activePairs.map((p) => Math.log1p(p.modisCellDays));
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;

    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - meanX;
      sxx += dx * dx;
      sxy += dx * (ys[i] - meanY);
    }

    if (sxx > 1e-6) {
      const slope = clamp(sxy / sxx, 0.15, 1.35);
      const intercept = clamp(meanY - slope * meanX, -0.5, 1.2);
      return {
        method: "log_linear_overlap",
        transferRatio: Number(
          (sumViirs > 0 ? sumModis / sumViirs : PRIOR_VIIRS_TO_MODIS_RATIO).toFixed(3),
        ),
        slope: Number(slope.toFixed(3)),
        intercept: Number(intercept.toFixed(3)),
        predict: (viirsCount) =>
          viirsCount <= 0 ? 0 : Math.max(0, Math.expm1(Math.max(0, intercept + slope * Math.log1p(viirsCount)))),
      };
    }
  }

  if (sumViirs > 0 && sumModis > 0) {
    const observedRatio = sumModis / sumViirs;
    const weight = activePairs.length / (activePairs.length + 4);
    const shrunkRatio = clamp(
      weight * observedRatio + (1 - weight) * PRIOR_VIIRS_TO_MODIS_RATIO,
      0.1,
      1.2,
    );
    return {
      method: "shrunk_ratio_overlap",
      transferRatio: Number(shrunkRatio.toFixed(3)),
      slope: 1,
      intercept: 0,
      predict: (viirsCount) => Math.max(0, viirsCount * shrunkRatio),
    };
  }

  return {
    method: "prior_fallback",
    transferRatio: PRIOR_VIIRS_TO_MODIS_RATIO,
    slope: 1,
    intercept: 0,
    predict: (viirsCount) => Math.max(0, viirsCount * PRIOR_VIIRS_TO_MODIS_RATIO),
  };
}

/**
 * Step 3 & 4 (Layer A): Fits the VIIRS -> MODIS-equivalent transfer function on the
 * 14-day overlap window, runs leave-one-day-out cross-validation, and emits uncertainty intervals.
 */
export function fitOverlapTransferFunction(dailySeries = []) {
  const activePairs = dailySeries.filter(
    (d) => d.viirsCellDays > 0 || d.modisCellDays > 0,
  );
  const modisActiveDays = activePairs.filter((d) => d.modisCellDays > 0).length;
  const model = fitPredictor(activePairs);

  const looErrors = [];
  if (activePairs.length >= 3) {
    for (let i = 0; i < activePairs.length; i++) {
      const heldOut = activePairs[i];
      const foldTrain = activePairs.filter((_, idx) => idx !== i);
      const foldModel = fitPredictor(foldTrain);
      const pred = foldModel.predict(heldOut.viirsCellDays);
      looErrors.push(pred - heldOut.modisCellDays);
    }
  }

  const mae = looErrors.length
    ? looErrors.reduce((s, e) => s + Math.abs(e), 0) / looErrors.length
    : null;
  const rmse = looErrors.length
    ? Math.sqrt(looErrors.reduce((s, e) => s + e * e, 0) / looErrors.length)
    : null;
  const bias = looErrors.length
    ? looErrors.reduce((s, e) => s + e, 0) / looErrors.length
    : null;

  const baseHalfWidth = rmse !== null ? Math.max(0.6, rmse * 1.645) : 1.0;

  let qualityFlag = "low_sparse";
  if (activePairs.length >= 7 && modisActiveDays >= 4) qualityFlag = "high";
  else if (activePairs.length >= 3 && modisActiveDays >= 2) qualityFlag = "moderate";

  const calibratedSeries = dailySeries.map((day) => {
    const calibratedViirs = Number(model.predict(day.viirsCellDays).toFixed(2));
    const hasViirs = day.viirsCellDays > 0;
    const hasModis = day.modisCellDays > 0;

    let modisEquivalent = 0;
    let source = "no_detections";
    if (hasViirs && hasModis) {
      modisEquivalent = calibratedViirs;
      source = "observed_overlap";
    } else if (hasViirs) {
      modisEquivalent = calibratedViirs;
      source = "calibrated_viirs";
    } else if (hasModis) {
      modisEquivalent = day.modisCellDays;
      source = "observed_modis";
    }

    const halfWidth =
      modisEquivalent === 0 && day.viirsCellDays === 0
        ? 0
        : Math.max(0.5, Math.min(modisEquivalent * 0.45 + baseHalfWidth * 0.65, baseHalfWidth));
    const lower = Number(Math.max(0, modisEquivalent - halfWidth).toFixed(2));
    const upper = Number((modisEquivalent + halfWidth).toFixed(2));

    return {
      ...day,
      calibratedViirs,
      modisEquivalent: Number(modisEquivalent.toFixed(2)),
      interval: [lower, upper],
      source,
      sensorMix: {
        modisCellDays: day.modisCellDays,
        viirsCellDays: day.viirsCellDays,
        ratio:
          day.viirsCellDays > 0
            ? Number((modisEquivalent / day.viirsCellDays).toFixed(2))
            : null,
      },
    };
  });

  return {
    calibratedSeries,
    validation: {
      method: model.method,
      transferRatio: model.transferRatio,
      slope: model.slope,
      intercept: model.intercept,
      overlapDays: activePairs.length,
      modisActiveDays,
      mae: mae !== null ? Number(mae.toFixed(2)) : null,
      rmse: rmse !== null ? Number(rmse.toFixed(2)) : null,
      bias: bias !== null ? Number(bias.toFixed(2)) : null,
      intervalHalfWidth: Number(baseHalfWidth.toFixed(2)),
      qualityFlag,
    },
  };
}

/**
 * Section 4.2 (Layer B): Computes empirical multi-pass confirmation rates and 95%
 * Wilson CIs from tracked fire events, replacing hardcoded tier confidence percentages.
 */
export function computeEmpiricalTierRates(combinedTrack14d = {}) {
  const events = Array.isArray(combinedTrack14d?.fire_events)
    ? combinedTrack14d.fire_events
    : [];

  const stats = {
    1: { total: 0, confirmed: 0 },
    2: { total: 0, confirmed: 0 },
    3: { total: 0, confirmed: 0 },
  };

  for (const event of events) {
    const fire = event?.fire;
    if (!fire) continue;
    const sats = Array.isArray(fire.satellites) ? fire.satellites : [];
    const hasModis = sats.some((s) => String(s).toUpperCase().includes("MODIS"));
    const hasViirs = sats.some((s) => String(s).toUpperCase().includes("VIIRS"));
    const tier = hasModis && hasViirs ? 1 : hasViirs ? 2 : 3;
    const persistedAcrossPasses = Number(fire.n_passes || 1) >= 2;

    stats[tier].total += 1;
    if (persistedAcrossPasses) stats[tier].confirmed += 1;
  }

  const formatTier = (tier, label) => {
    const { total, confirmed } = stats[tier];
    return {
      tier,
      label,
      ordinalRank: tier,
      sampleSize: total,
      confirmedCount: confirmed,
      confirmedRate: total > 0 ? Number((confirmed / total).toFixed(3)) : null,
      ci95: wilsonCi95(confirmed, total),
    };
  };

  return {
    tier1: formatTier(1, "Dual-Confirmed"),
    tier2: formatTier(2, "VIIRS Solo"),
    tier3: formatTier(3, "MODIS Solo"),
    tier4: {
      tier: 4,
      label: "Inactive / Unconfirmed",
      ordinalRank: 4,
      sampleSize: 0,
      confirmedCount: 0,
      confirmedRate: null,
      ci95: null,
    },
  };
}

/**
 * Builds the full Layer A statistical harmonization summary, 14-day series,
 * cross-validation report, empirical tier confirmation metrics, and Layer B context.
 */
export function buildHarmonizationReport(insideItems14d = [], combinedTrack14d = {}) {
  const { days, totals } = aggregateCellDays(insideItems14d);
  const { calibratedSeries, validation } = fitOverlapTransferFunction(days);
  const empiricalTiers = computeEmpiricalTierRates(combinedTrack14d);

  const latestDay = calibratedSeries[calibratedSeries.length - 1] || {
    date: new Date().toISOString().slice(0, 10),
    modisCellDays: 0,
    viirsCellDays: 0,
    combinedCellDays: 0,
    modisEquivalent: 0,
    calibratedViirs: 0,
    interval: [0, 0],
    source: "no_detections",
    totalFrpSum: 0,
  };

  // Baseline uses prior 13 days when non-empty (excluding the evaluated day per Section 3.2)
  const priorDays = calibratedSeries.slice(0, -1);
  const baselinePool =
    priorDays.some((d) => d.modisEquivalent > 0) ? priorDays : calibratedSeries;
  const sortedBaseline = baselinePool
    .map((d) => d.modisEquivalent)
    .sort((a, b) => a - b);

  const median = Number(quantile(sortedBaseline, 0.5).toFixed(2));
  const q25 = quantile(sortedBaseline, 0.25);
  const q75 = quantile(sortedBaseline, 0.75);
  const iqr = Number(Math.max(0, q75 - q25).toFixed(2));
  const total14dModisEq = Number(
    calibratedSeries.reduce((s, d) => s + d.modisEquivalent, 0).toFixed(2),
  );
  const total14dRawModis = calibratedSeries.reduce((s, d) => s + d.modisCellDays, 0);
  const total14dRawViirs = calibratedSeries.reduce((s, d) => s + d.viirsCellDays, 0);

  const latestVal = latestDay.modisEquivalent;
  const anomalyRatio =
    median > 0 ? Number((latestVal / median).toFixed(2)) : latestVal > 0 ? null : 1;
  const anomalyDelta = Number((latestVal - median).toFixed(2));
  const leCount = sortedBaseline.filter((v) => v <= latestVal).length;
  const percentile = sortedBaseline.length
    ? Math.round((leCount / sortedBaseline.length) * 100)
    : 50;

  const context = {
    monthCount: latestVal,
    modisEquivalent: latestVal,
    interval: latestDay.interval,
    median,
    median14d: median,
    iqr,
    anomalyRatio,
    anomalyDelta,
    percentile,
    unit: "MODIS-equivalent",
    baselineWindow: "14d cell-days",
    qualityFlag: validation.qualityFlag,
  };

  return {
    summary: {
      unit: "MODIS-equivalent cell-days (1 km)",
      latestDate: latestDay.date,
      latestModisEquivalent: latestVal,
      latestInterval: latestDay.interval,
      latestSource: latestDay.source,
      latestObservedModis: latestDay.modisCellDays,
      latestRawViirs: latestDay.viirsCellDays,
      total14dModisEquivalent: total14dModisEq,
      total14dRawModis,
      total14dRawViirs,
      median14d: median,
      iqr14d: iqr,
      anomalyRatio,
      anomalyDelta,
      percentile,
      filterStats: totals,
    },
    dailySeries: calibratedSeries,
    validation,
    empiricalTiers,
    context,
  };
}

// Spatial clustering tolerance: ~0.05 degrees (~5 km).
const CLUSTER_DEGREE = 0.05;
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const PASS_SLICE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6-hour orbital pass slice
const WIDE_PASS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12-hour fallback when orbital gap has no detections

export function formatUtcDateTime(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const d = new Date(timestamp);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function formatUtcTime(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const d = new Date(timestamp);
  return d.toISOString().slice(11, 16) + " UTC";
}

export function pointMatchesTierFilter(point, tierFilter = "all") {
  if (!point || !tierFilter || tierFilter === "all") return true;
  const sensor = point[3];
  const evidence = Number(point[7]) || 0;
  const tier = Number(point[8]) || 2;
  const confidence = point[9];
  const strConf = String(confidence ?? "").trim().toLowerCase();
  const numConf = Number(confidence);

  if (tierFilter === "dual_only") {
    return tier === 1 || evidence === 3;
  }
  if (tierFilter === "high_and_dual") {
    if (tier === 1 || evidence === 3) return true;
    if (sensor === 1) return strConf.startsWith("h");
    if (sensor === 0) return Number.isFinite(numConf) && numConf >= 80;
    return false;
  }
  if (tierFilter === "viirs_and_dual") {
    if (sensor === 1) return tier !== 4 && !strConf.startsWith("l");
    return tier === 1 || (sensor === 0 && Number.isFinite(numConf) && numConf >= 65);
  }
  if (tierFilter === "moderate_plus") {
    if (tier === 4) return false;
    if (sensor === 1) return strConf !== "" && !strConf.startsWith("l");
    if (sensor === 0) {
      return Number.isFinite(numConf)
        ? numConf >= 30
        : strConf === "n" || strConf === "nominal" || strConf === "h" || strConf === "high";
    }
    return true;
  }
  return true;
}

/**
 * Builds a fast lookup set of coordinates for fires that are active in the latest pass.
 */
export function buildActiveCells(points, latestTime, activeWindowMs = ACTIVE_WINDOW_MS) {
  const activeCells = new Set();
  const threshold = latestTime - activeWindowMs;
  const scale = 1 / CLUSTER_DEGREE;

  for (const point of points) {
    const acquired = point[5] ?? latestTime;
    if (acquired >= threshold) {
      const gx = Math.round(point[0] * scale);
      const gy = Math.round(point[1] * scale);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          activeCells.add(`${gx + dx}:${gy + dy}`);
        }
      }
    }
  }
  return activeCells;
}

/**
 * Classifies fires as active (0) or extinguished/put out (1) based on whether they
 * persist in the latest satellite observations, slicing by 24h `hoursBack`, custom `interval`,
 * and `tierFilter`.
 */
export function classifyHotspots(points = [], options = {}) {
  const {
    hoursBack,
    interval,
    tierFilter = "all",
    minEvidence = 0,
    minConfidence = 0,
    windowHours = 12,
  } = options;
  const isHistorical =
    Boolean(interval && Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs)) ||
    (typeof hoursBack === "number" && hoursBack > 0);

  if (!points.length) {
    const refTime = options.referenceTime || Date.now();
    return {
      filteredPoints: [],
      stats: {
        total: 0,
        active: 0,
        extinguished: 0,
        dual: 0,
        eventsCount: 0,
        maxFrp: 0,
        modis: 0,
        viirs: 0,
        highConf: 0,
        lowConf: 0,
        timeLabel: `RECENT (≤${windowHours}H)`,
      },
      filterWindow: {
        minTime: refTime - windowHours * 3600 * 1000,
        maxTime: refTime,
        referenceTime: refTime,
        tierFilter,
        isHistorical,
      },
    };
  }

  let latestTime = 0;
  for (const p of points) {
    const acq = p[5];
    if (typeof acq === "number" && acq > latestTime) latestTime = acq;
  }
  const referenceTime = options.referenceTime || latestTime || Date.now();
  if (!latestTime) latestTime = referenceTime;

  const activeCells = buildActiveCells(points, referenceTime);
  const scale = 1 / CLUSTER_DEGREE;

  let minTime;
  let maxTime;
  let timeLabel = `RECENT (≤${windowHours}H)`;

  if (interval && Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs)) {
    minTime = interval.startMs;
    maxTime = interval.endMs;
    timeLabel = `${formatUtcDateTime(minTime)} → ${formatUtcDateTime(maxTime)}`;
  } else if (typeof hoursBack === "number" && hoursBack > 0) {
    maxTime = referenceTime - hoursBack * 3600 * 1000;
    minTime = maxTime - PASS_SLICE_WINDOW_MS;
    const hasTightSlice = points.some((pt) => {
      const acq = pt[5] ?? latestTime;
      return (pt[4] ?? 1) === 1 && acq >= minTime && acq <= maxTime;
    });
    if (!hasTightSlice) {
      minTime = maxTime - WIDE_PASS_WINDOW_MS;
    }
    timeLabel = `-${hoursBack.toFixed(1)}h AGO (${formatUtcTime(maxTime)})`;
  } else {
    maxTime = referenceTime;
    minTime = referenceTime - windowHours * 3600 * 1000;
    timeLabel = `RECENT (≤${windowHours}H)`;
  }

  const filteredPoints = [];
  const fireIds = new Set();
  let maxFrp = 0;
  let modis = 0;
  let viirs = 0;
  let activeCount = 0;
  let extinguishedCount = 0;
  let dualCount = 0;
  let highConfCount = 0;
  let lowConfCount = 0;

  for (const point of points) {
    const [
      lon,
      lat,
      frp,
      sensor,
      inside = 1,
      acquired = latestTime,
      pointExtinguished = null,
      evidence = 0,
      tier = 2,
      confidence = null,
      satellite = null,
      matches = [],
      fireId = null,
    ] = point;
    if (inside !== 1) continue;
    if (acquired < minTime || acquired > maxTime) continue;
    if (!pointMatchesTierFilter(point, tierFilter)) continue;
    if (minEvidence > 0 && evidence < minEvidence) continue;
    if (minConfidence > 0 && typeof confidence === "number" && confidence < minConfidence) continue;

    const gx = Math.round(lon * scale);
    const gy = Math.round(lat * scale);
    const isCurrentlyActive = activeCells.has(`${gx}:${gy}`);
    const extinguished = pointExtinguished !== null ? pointExtinguished : (isCurrentlyActive ? 0 : 1);

    if (extinguished === 1) extinguishedCount++;
    else activeCount++;

    if (tier === 1 || evidence === 3) dualCount++;
    if (
      (typeof confidence === "number" && confidence >= 70) ||
      String(confidence ?? "").trim().toLowerCase().startsWith("h")
    ) {
      highConfCount++;
    } else {
      lowConfCount++;
    }

    if (sensor === 0) modis++;
    else if (sensor === 1) viirs++;
    if (frp > maxFrp) maxFrp = frp;
    if (fireId !== null && fireId !== undefined) fireIds.add(String(fireId));

    filteredPoints.push([
      lon,
      lat,
      frp,
      sensor,
      inside,
      acquired,
      extinguished,
      evidence,
      tier,
      confidence,
      satellite,
      matches,
      ...point.slice(12),
    ]);
  }

  return {
    filteredPoints,
    stats: {
      total: filteredPoints.length,
      active: activeCount,
      extinguished: extinguishedCount,
      dual: dualCount,
      eventsCount: fireIds.size,
      maxFrp: Number(maxFrp.toFixed(1)),
      modis,
      viirs,
      highConf: highConfCount,
      lowConf: lowConfCount,
      timeLabel,
    },
    filterWindow: {
      minTime,
      maxTime,
      referenceTime,
      tierFilter,
      isHistorical,
    },
  };
}

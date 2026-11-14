// Spatial clustering tolerance: ~0.05 degrees (~5 km).
const CLUSTER_DEGREE = 0.05;
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const PERSISTENCE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

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
 * persist in the latest satellite observations.
 *
 * Slices the points by either:
 * - `hoursBack` (0 <= N <= 24): shows fires present at that historical hour.
 * - `interval`: { startMs, endMs }: shows fires detected within that exact time range.
 */
export function classifyHotspots(points = [], options = {}) {
  if (!points.length) {
    return {
      filteredPoints: [],
      stats: {
        total: 0,
        active: 0,
        extinguished: 0,
        maxFrp: 0,
        modis: 0,
        viirs: 0,
        timeLabel: "LIVE (NOW)",
      },
    };
  }

  // Find latest acquisition timestamp
  let latestTime = 0;
  for (const p of points) {
    const acq = p[5];
    if (typeof acq === "number" && acq > latestTime) latestTime = acq;
  }
  const referenceTime = options.referenceTime || latestTime || Date.now();
  if (!latestTime) latestTime = referenceTime;

  const activeCells = buildActiveCells(points, referenceTime);
  const scale = 1 / CLUSTER_DEGREE;

  const { hoursBack, interval, tierFilter = "all", minEvidence = 0, minConfidence = 0 } = options;
  let minTime;
  let maxTime;
  let timeLabel = "LIVE (NOW)";

  if (interval && Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs)) {
    minTime = interval.startMs;
    maxTime = interval.endMs;
    timeLabel = `${formatUtcDateTime(minTime)} → ${formatUtcDateTime(maxTime)}`;
  } else if (typeof hoursBack === "number" && hoursBack > 0) {
    maxTime = referenceTime - hoursBack * 3600 * 1000;
    // Window of fires active at or around that hour (within persistence window)
    minTime = maxTime - PERSISTENCE_WINDOW_MS;
    timeLabel = `-${hoursBack.toFixed(1)}h AGO (${formatUtcTime(maxTime)})`;
  } else {
    // Live / Current view: all detections in rolling window
    maxTime = referenceTime;
    minTime = referenceTime - 24 * 3600 * 1000;
    timeLabel = "LIVE (NOW)";
  }

  const filteredPoints = [];
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
    ] = point;
    if (inside !== 1) continue;

    // Filter to time window
    if (acquired < minTime || acquired > maxTime) continue;

    // Filter by confidence / tier
    if (tierFilter === "dual_only" && tier !== 1) continue;
    if (tierFilter === "high_and_dual") {
      const isDual = tier === 1;
      const isHighViirs = sensor === 1 && String(confidence ?? "").trim().toLowerCase().startsWith("h");
      const isHighModis = sensor === 0 && Number(confidence) >= 80;
      if (!isDual && !isHighViirs && !isHighModis) continue;
    }
    if (tierFilter === "viirs_and_dual" && tier !== 1 && tier !== 2) continue;
    if (tierFilter === "moderate_plus") {
      const isLowModis = sensor === 0 && Number(confidence) < 50;
      const isLowViirs = sensor === 1 && String(confidence ?? "").trim().toLowerCase().startsWith("l");
      if (isLowModis || isLowViirs) continue;
    }
    if (minEvidence > 0 && evidence < minEvidence) continue;

    // Filter by minimum confidence
    if (minConfidence > 0 && typeof confidence === "number" && confidence < minConfidence) continue;

    const gx = Math.round(lon * scale);
    const gy = Math.round(lat * scale);
    const isCurrentlyActive = activeCells.has(`${gx}:${gy}`);
    const extinguished = pointExtinguished !== null ? pointExtinguished : (isCurrentlyActive ? 0 : 1);

    if (extinguished === 1) extinguishedCount++;
    else activeCount++;

    if (tier === 1 || evidence === 3) dualCount++;
    if (confidence >= 70) highConfCount++;
    else lowConfCount++;

    if (sensor === 0) modis++;
    else if (sensor === 1) viirs++;
    if (frp > maxFrp) maxFrp = frp;

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
    ]);
  }

  return {
    filteredPoints,
    stats: {
      total: filteredPoints.length,
      active: activeCount,
      extinguished: extinguishedCount,
      dual: dualCount,
      maxFrp: Number(maxFrp.toFixed(1)),
      modis,
      viirs,
      dual: dualCount,
      highConf: highConfCount,
      lowConf: lowConfCount,
      timeLabel,
    },
  };
}

import { animate } from "animejs";

export const HOTSPOT_SOURCE = "hotspots";
export const PREDICTION_SOURCE = "fire-predictions";
export const TRACKED_FIRES_SOURCE = "tracked-fires";
export const SELECTED_FIRE_SOURCE = "selected-fire-spread";
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const COUNTRY_SOURCE = "country-boundaries";
const COUNTRY_LAYER = "country_boundaries";
const PULSE_LAYER = "hotspots-pulse";
const PULSE_SHARE = 0.1;
const EARTH_RADIUS_KM = 6371;
const NO_COUNTRY = ["==", ["get", "iso_3166_1_alpha_3"], ""];
const WORLDVIEW = ["any", ["==", ["get", "worldview"], "all"], ["in", "US", ["get", "worldview"]]];

const HAZARD_RATING_COLOR = [
  "match",
  ["get", "hazard_rating"],
  "Extreme",
  "#ef4444",
  "Very High",
  "#f97316",
  "High",
  "#f59e0b",
  "Moderate",
  "#eab308",
  "Low",
  "#22c55e",
  "#ff8150",
];

// Heat ramp for Dual-Confirmed (Highest Confidence, Tier 1)
const DUAL_CORE_COLOR = [
  "interpolate", ["linear"], ["get", "frp"],
  0, "#ffe082", 20, "#fff59d", 80, "#fffde7", 200, "#ffffff",
];

// Heat ramp for VIIRS Solo (Tier 2, High/Nominal Confidence)
const FRP_COLOR = [
  "interpolate", ["linear"], ["get", "frp"],
  0, "#d3321d", 15, "#ff6a32", 60, "#ffb347", 200, "#fff1c9",
];

// Heat ramp for MODIS Solo (Tier 3, Lower Confidence / Unverified)
const MODIS_LOW_CORE_COLOR = [
  "interpolate", ["linear"], ["get", "frp"],
  0, "#b45309", 20, "#d97706", 80, "#f59e0b", 200, "#fde68a",
];

// Lighter, muted shade for extinguished / put-out fires
const EXTINGUISHED_CORE_COLOR = [
  "interpolate", ["linear"], ["get", "frp"],
  0, "#e8baa3", 15, "#f3cbba", 60, "#fce4d4", 200, "#ffffff",
];

const CORE_COLOR = [
  "case",
  ["==", ["get", "extinguished"], 1],
  EXTINGUISHED_CORE_COLOR,
  ["==", ["get", "tier"], 1],
  DUAL_CORE_COLOR,
  ["==", ["get", "tier"], 3],
  MODIS_LOW_CORE_COLOR,
  FRP_COLOR,
];

const GLOW_COLOR = [
  "case",
  ["==", ["get", "extinguished"], 1],
  "#cfa08c",
  ["==", ["get", "tier"], 1],
  "#ff9100",
  ["==", ["get", "tier"], 3],
  "#b45309",
  FRP_COLOR,
];

const byFrp = (low, high) => ["interpolate", ["linear"], ["get", "frp"], 0, low, 100, high];

function areaToRadiusKm(areaKm2) {
  return Math.sqrt(Math.max(0.05, Number(areaKm2) || 0.18) / Math.PI);
}

function geodesicDestination(lon, lat, distanceKm, bearingRad) {
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const angDist = distanceKm / EARTH_RADIUS_KM;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angDist) +
    Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearingRad);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function geodesicCirclePolygon(lon, lat, radiusKm, steps = 48) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    coords.push(geodesicDestination(lon, lat, radiusKm, bearing));
  }
  return {
    type: "Polygon",
    coordinates: [coords],
  };
}

/**
 * Builds a star-shaped geodesic perimeter around actual fire detections so
 * directional spread can be visually compared against isotropic model predictions.
 */
function buildActualSpreadGeometry(detections = [], centerLon, centerLat, actualAreaKm2) {
  const pts = detections
    .map((d) => ({
      lon: Number(d.lon ?? d.longitude),
      lat: Number(d.lat ?? d.latitude),
    }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));

  const minRadiusKm = Math.max(0.28, areaToRadiusKm(actualAreaKm2));
  if (pts.length <= 1) {
    return geodesicCirclePolygon(centerLon, centerLat, minRadiusKm);
  }

  const cLon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));

  const offsets = pts.map((p) => ({
    dx: (p.lon - cLon) * 111.32 * cosLat,
    dy: (p.lat - cLat) * 111.32,
  }));

  const maxSpread = Math.max(0, ...offsets.map((o) => Math.hypot(o.dx, o.dy)));
  if (maxSpread < 0.08) {
    return geodesicCirclePolygon(cLon, cLat, minRadiusKm);
  }

  const steps = 36;
  const pixelPadKm = 0.26;
  let radii = [];

  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const ux = Math.sin(theta);
    const uy = Math.cos(theta);
    let maxProj = 0;
    for (const o of offsets) {
      const dist = Math.hypot(o.dx, o.dy);
      if (dist < 1e-6) continue;
      const cosAng = (o.dx * ux + o.dy * uy) / dist;
      if (cosAng > 0) {
        const proj = dist * Math.pow(cosAng, 1.5);
        if (proj > maxProj) maxProj = proj;
      }
    }
    radii.push(Math.max(minRadiusKm * 0.72, maxProj + pixelPadKm));
  }

  for (let pass = 0; pass < 2; pass++) {
    radii = radii.map((_, idx) => {
      const prev = radii[(idx - 1 + steps) % steps];
      const curr = radii[idx];
      const next = radii[(idx + 1) % steps];
      return 0.25 * prev + 0.5 * curr + 0.25 * next;
    });
  }

  const coords = radii.map((rKm, i) => {
    const bearing = (i / steps) * Math.PI * 2;
    return geodesicDestination(cLon, cLat, rKm, bearing);
  });
  coords.push(coords[0]);

  return {
    type: "Polygon",
    coordinates: [coords],
  };
}

function detectionTimestampMs(det) {
  if (!det) return NaN;
  if (typeof det._acquired === "number" && Number.isFinite(det._acquired)) return det._acquired;
  if (typeof det.acq_datetime_utc === "string") {
    const norm = /Z$|[+-]\d{2}:?\d{2}$/i.test(det.acq_datetime_utc.trim())
      ? det.acq_datetime_utc.trim()
      : `${det.acq_datetime_utc.trim().replace(" ", "T")}Z`;
    const parsed = Date.parse(norm);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (det.acq_date && det.acq_time !== undefined && det.acq_time !== null) {
    const hhmm = String(det.acq_time).padStart(4, "0");
    return Date.parse(`${det.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
  }
  return NaN;
}

export function buildSelectedFireSpreadGeoJson(
  selectedFireEvent,
  selectedPredictionFeatures = [],
  activeTab = "combined",
) {
  const fire = selectedFireEvent?.fire;
  if (!fire || !Number.isFinite(Number(fire.lon)) || !Number.isFinite(Number(fire.lat))) {
    return EMPTY_COLLECTION;
  }

  const hazard = selectedFireEvent?.hazard || null;
  const prediction = selectedFireEvent?.prediction || null;
  const hindcast = selectedFireEvent?.hindcast || null;
  const detections = Array.isArray(selectedFireEvent?.detections) ? selectedFireEvent.detections : [];
  const hasViirsSat = (fire.satellites || []).some((s) =>
    String(s).toUpperCase().includes("VIIRS"),
  );
  const hasViirsDet = detections.some((d) => {
    const inst = String(
      d?.instrument || d?.satellite_id || d?.sat || d?.satellite || "",
    ).toUpperCase();
    return (
      inst.includes("VIIRS") ||
      inst === "N" ||
      inst === "N20" ||
      inst === "N21" ||
      d?._sensor === 1
    );
  });
  const hasViirsModelSupport =
    activeTab !== "modis" &&
    Boolean(
      prediction ||
        selectedPredictionFeatures.length > 0 ||
        hasViirsSat ||
        hasViirsDet,
    );
  const isPastFire = Boolean(selectedFireEvent?.is_past);
  const showActualVsPredicted =
    isPastFire || (Boolean(hindcast?.isMultiPass) && hindcast.actualFinalAreaKm2 > hindcast.initialAreaKm2);

  const earlyFire = showActualVsPredicted ? hindcast?.earlyFireEvent?.fire : null;
  const initialLon = Number(earlyFire?.lon ?? prediction?.center_lon ?? fire.lon);
  const initialLat = Number(earlyFire?.lat ?? prediction?.center_lat ?? fire.lat);
  const actualLon = Number(fire.lon);
  const actualLat = Number(fire.lat);
  const centerLon = showActualVsPredicted ? initialLon : Number(prediction?.center_lon ?? fire.lon);
  const centerLat = showActualVsPredicted ? initialLat : Number(prediction?.center_lat ?? fire.lat);

  const initialArea =
    Number(
      showActualVsPredicted
        ? (hindcast?.initialAreaKm2 ?? prediction?.current_area_km2 ?? fire.area_km2)
        : (prediction?.current_area_km2 ?? fire.area_km2),
    ) || 0.14;
  const actualArea = Number(hindcast?.actualFinalAreaKm2 ?? fire.area_km2) || initialArea;
  const currentRadiusKm = areaToRadiusKm(initialArea);

  const backendCurrent = selectedPredictionFeatures.find(
    (f) => f?.properties?.role === "current_footprint" && f?.geometry,
  );
  const backendPredicted = selectedPredictionFeatures.find(
    (f) => f?.properties?.role === "predicted_footprint" && f?.geometry,
  );
  const backendOuter = selectedPredictionFeatures.find(
    (f) => f?.properties?.role === "uncertainty_outer" && f?.geometry,
  );

  const hasActualPrediction =
    hasViirsModelSupport &&
    (Boolean(backendPredicted?.geometry) || prediction?.predicted_total_area_km2 != null);
  const predictedArea = hasActualPrediction
    ? Number(
        prediction?.predicted_total_area_km2 ??
          backendPredicted?.properties?.predicted_total_area_km2 ??
          initialArea,
      )
    : null;
  const predictedGeometry = hasActualPrediction
    ? backendPredicted?.geometry ||
      geodesicCirclePolygon(
        Number(prediction?.center_lon ?? centerLon),
        Number(prediction?.center_lat ?? centerLat),
        areaToRadiusKm(predictedArea),
      )
    : null;
  const predictedRadiusKm =
    hasActualPrediction && predictedArea != null ? areaToRadiusKm(predictedArea) : null;

  const hasActualOuterBound =
    hasViirsModelSupport &&
    (Boolean(backendOuter?.geometry) ||
      (prediction?.additional_area_p90_km2 !== null &&
        prediction?.additional_area_p90_km2 !== undefined &&
        Number.isFinite(Number(prediction.additional_area_p90_km2))));
  const outerArea = hasActualOuterBound
    ? backendOuter?.properties?.area_km2 != null
      ? Number(backendOuter.properties.area_km2)
      : Number((initialArea + Number(prediction.additional_area_p90_km2)).toFixed(4))
    : null;
  const outerRadiusKm = hasActualOuterBound && outerArea != null ? areaToRadiusKm(outerArea) : null;

  const currentGeometry =
    backendCurrent?.geometry || geodesicCirclePolygon(centerLon, centerLat, currentRadiusKm);
  const outerGeometry = hasActualOuterBound
    ? backendOuter?.geometry || geodesicCirclePolygon(centerLon, centerLat, outerRadiusKm)
    : null;

  const persistStr =
    typeof prediction?.persistence_probability === "number"
      ? `Persist ${Math.round(prediction.persistence_probability * 100)}%`
      : null;

  const predictedLabelText =
    hasActualPrediction && predictedArea != null
      ? showActualVsPredicted && prediction
        ? `MODEL PREDICTED · ${predictedArea.toFixed(2)} km² (${
            prediction.prediction_status === "expansion_likely" ? "EXPAND" : persistStr || "STABLE"
          })`
        : `12–24H PREDICTED · ${predictedArea.toFixed(2)} km² (${
            prediction?.prediction_status === "expansion_likely"
              ? "EXPANDING"
              : persistStr || "ACTIVE"
          })`
      : "";

  const centerBadgeText = hazard?.hazard_rating
    ? `FIRE #${fire.fire_final} · ${String(hazard.hazard_rating).toUpperCase()} (${hazard.hazard_score}/100)`
    : `FIRE #${fire.fire_final} · ${Number(fire.frp_sum || 0).toFixed(1)} MW`;

  const features = [];

  if (hasActualOuterBound && outerGeometry) {
    features.push({
      type: "Feature",
      geometry: outerGeometry,
      properties: {
        role: "selected_uncertainty_outer",
        fire_final: fire.fire_final,
        area_km2: outerArea,
      },
    });
  }

  if (hasActualPrediction && predictedGeometry) {
    features.push({
      type: "Feature",
      geometry: predictedGeometry,
      properties: {
        role: "selected_predicted_footprint",
        fire_final: fire.fire_final,
        area_km2: predictedArea,
        prediction_status: prediction?.prediction_status ?? null,
      },
    });
  }

  if (showActualVsPredicted) {
    features.push({
      type: "Feature",
      geometry: buildActualSpreadGeometry(detections, actualLon, actualLat, actualArea),
      properties: {
        role: "selected_actual_footprint",
        fire_final: fire.fire_final,
        area_km2: actualArea,
      },
    });
  }

  features.push({
    type: "Feature",
    geometry: currentGeometry,
    properties: {
      role: "selected_current_footprint",
      fire_final: fire.fire_final,
      area_km2: initialArea,
    },
  });

  // Build chronological detection trajectory across 12h/6h passes
  const passBuckets = new Map();
  const stampedDetections = detections
    .map((det) => {
      const lon = Number(det.lon ?? det.longitude);
      const lat = Number(det.lat ?? det.latitude);
      const acqMs = detectionTimestampMs(det);
      return { det, lon, lat, acqMs };
    })
    .filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const item of stampedDetections) {
    if (Number.isFinite(item.acqMs)) {
      if (item.acqMs < minMs) minMs = item.acqMs;
      if (item.acqMs > maxMs) maxMs = item.acqMs;
    }
    const bucketKey = Number.isFinite(item.det.pass_id)
      ? Number(item.det.pass_id)
      : Number.isFinite(item.acqMs)
        ? Math.floor(item.acqMs / (6 * 3600 * 1000))
        : 0;
    if (!passBuckets.has(bucketKey)) passBuckets.set(bucketKey, []);
    passBuckets.get(bucketKey).push(item);
  }

  const orderedBuckets = [...passBuckets.entries()].sort((a, b) => a[0] - b[0]);
  const trajectoryCoords = orderedBuckets.map(([, items]) => {
    const avgLon = items.reduce((s, d) => s + d.lon, 0) / items.length;
    const avgLat = items.reduce((s, d) => s + d.lat, 0) / items.length;
    return [avgLon, avgLat];
  });

  if (trajectoryCoords.length >= 2) {
    const distinct = trajectoryCoords.some(
      (c) => Math.hypot(c[0] - trajectoryCoords[0][0], c[1] - trajectoryCoords[0][1]) > 1e-5,
    );
    if (distinct) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: trajectoryCoords },
        properties: { role: "selected_spread_trajectory", fire_final: fire.fire_final },
      });
    }
  }

  const timeSpan = maxMs > minMs ? maxMs - minMs : 1;
  for (const item of stampedDetections) {
    const age = Number.isFinite(item.acqMs) && maxMs > minMs ? (item.acqMs - minMs) / timeSpan : 1;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.lon, item.lat] },
      properties: {
        role: "selected_detection_point",
        fire_final: fire.fire_final,
        frp: Number(item.det.frp) || 0,
        sat: item.det.satellite_id || item.det.sat || item.det.satellite || "",
        acq_datetime_utc: item.det.acq_datetime_utc || "",
        age: Number(age.toFixed(3)),
      },
    });
  }

  // Ring labels placed at non-overlapping compass angles around the fire
  features.push(
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [actualLon, actualLat] },
      properties: {
        role: "selected_ring_label",
        label_kind: "center_badge",
        label_text: centerBadgeText,
        hazard_rating: hazard?.hazard_rating ?? null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geodesicDestination(centerLon, centerLat, currentRadiusKm, (225 * Math.PI) / 180),
      },
      properties: {
        role: "selected_ring_label",
        label_kind: "current_label",
        label_text: showActualVsPredicted
          ? `INITIAL PASS (T0) · ${initialArea.toFixed(2)} km²`
          : `CURRENT SPREAD · ${initialArea.toFixed(2)} km² (${fire.n_det ?? detections.length} det)`,
        hazard_rating: hazard?.hazard_rating ?? null,
      },
    },
  );

  if (hasActualPrediction && predictedRadiusKm != null && predictedLabelText) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geodesicDestination(centerLon, centerLat, predictedRadiusKm, (35 * Math.PI) / 180),
      },
      properties: {
        role: "selected_ring_label",
        label_kind: "predicted_label",
        label_text: predictedLabelText,
        hazard_rating: hazard?.hazard_rating ?? null,
      },
    });
  }

  if (hasActualOuterBound && outerRadiusKm != null && outerArea != null) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geodesicDestination(centerLon, centerLat, outerRadiusKm, (170 * Math.PI) / 180),
      },
      properties: {
        role: "selected_ring_label",
        label_kind: "outer_label",
        label_text: `90% SPREAD BOUND · ${outerArea.toFixed(2)} km²`,
        hazard_rating: hazard?.hazard_rating ?? null,
      },
    });
  }

  if (showActualVsPredicted) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geodesicDestination(
          actualLon,
          actualLat,
          Math.max(areaToRadiusKm(actualArea), 0.32),
          (135 * Math.PI) / 180,
        ),
      },
      properties: {
        role: "selected_ring_label",
        label_kind: "actual_label",
        label_text: `ACTUAL SPREAD · ${actualArea.toFixed(2)} km² (${fire.n_det ?? detections.length} det · ${fire.n_passes ?? 1}p)`,
        hazard_rating: hazard?.hazard_rating ?? null,
      },
    });
  }

  return { type: "FeatureCollection", features };
}
export function toFeatureCollection(points) {
  return {
    type: "FeatureCollection",
    features: points
      .filter((point) => (point[4] ?? 1) === 1)
      .map(
        ([
          lng,
          lat,
          frp,
          sensor,
          inside = 1,
          acquired,
          extinguished = 0,
          evidence = 0,
          tier = 2,
          confidence = null,
          satellite = null,
          matches = [],
          fireId = null,
          meta = null,
        ]) => {
          const defaultFootprint = sensor === 0 ? 1.0 : 0.375;
          const scan = Number.isFinite(Number(meta?.scan)) ? Number(meta.scan) : defaultFootprint;
          const track = Number.isFinite(Number(meta?.track)) ? Number(meta.track) : defaultFootprint;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              frp,
              sensor,
              in: inside,
              acquired,
              extinguished: Number(extinguished) || 0,
              evidence: Number(evidence) || 0,
              tier: Number(tier) || 2,
              confidence,
              satellite,
              matchesCount: Array.isArray(matches) ? matches.length : 0,
              fire_final: fireId ?? null,
              scan,
              track,
              footprintKm: Number(Math.max(scan, track).toFixed(2)),
              regime: meta?.regime || null,
              frpRatio: meta?.frpRatio ?? null,
            },
          };
        },
      ),
  };
}

// Pulse only the brightest slice of whatever is on screen, so quiet countries still get rings.
// Extinguished fires, coarse gap-fill MODIS nodes, and demoted/low-confidence anomalies never pulse.
function pulseFilter(points) {
  const brightness = points
    .filter((point) => {
      const tier = point[8] ?? 2;
      return (point[4] ?? 1) === 1 && (point[6] ?? 0) !== 1 && tier !== 3 && tier !== 4;
    })
    .map((point) => point[2])
    .sort((a, b) => a - b);
  const cutoff = brightness.length ? brightness[Math.floor(brightness.length * (1 - PULSE_SHARE))] : 0;
  return [
    "all",
    [">=", ["get", "frp"], cutoff],
    ["==", ["get", "in"], 1],
    ["!=", ["get", "extinguished"], 1],
    ["!=", ["get", "tier"], 3],
    ["!=", ["get", "tier"], 4],
  ];
}

export function setHotspots(map, points) {
  map.getSource(HOTSPOT_SOURCE)?.setData(toFeatureCollection(points));
  map.setFilter(PULSE_LAYER, pulseFilter(points));
}

export function setTrackerOverlay(
  map,
  {
    trackedGeoJson,
    predictionsGeoJson,
    selectedFireId,
    selectedFireEvent,
    selectedPredictionFeatures,
    activeTab,
  } = {},
) {
  map.getSource?.(TRACKED_FIRES_SOURCE)?.setData(trackedGeoJson || EMPTY_COLLECTION);
  const showPredictions =
    (activeTab === "viirs" || Boolean(predictionsGeoJson?.features?.length)) &&
    predictionsGeoJson?.features?.length;
  map.getSource?.(PREDICTION_SOURCE)?.setData(showPredictions ? predictionsGeoJson : EMPTY_COLLECTION);

  map.getSource?.(SELECTED_FIRE_SOURCE)?.setData(
    selectedFireEvent
      ? buildSelectedFireSpreadGeoJson(selectedFireEvent, selectedPredictionFeatures || [], activeTab)
      : EMPTY_COLLECTION,
  );

  const selectedKey = selectedFireId !== undefined && selectedFireId !== null ? String(selectedFireId) : "";
  const hazardRingRadius = [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "hazard_score"], 15],
    0, 7.5,
    30, 10,
    60, 13,
    100, 16,
  ];
  const hazardCenterRadius = [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "hazard_score"], 15],
    0, 4.5,
    30, 6,
    60, 7.5,
    100, 9.5,
  ];

  if (map.getLayer?.("tracked-fires-ring")) {
    map.setPaintProperty(
      "tracked-fires-ring",
      "circle-radius",
      selectedKey
        ? ["case", ["==", ["to-string", ["get", "fire_final"]], selectedKey], 18, hazardRingRadius]
        : hazardRingRadius,
    );
    map.setPaintProperty(
      "tracked-fires-ring",
      "circle-stroke-width",
      selectedKey
        ? ["case", ["==", ["to-string", ["get", "fire_final"]], selectedKey], 2.8, 1.4]
        : 1.4,
    );
    map.setPaintProperty(
      "tracked-fires-ring",
      "circle-stroke-color",
      selectedKey
        ? ["case", ["==", ["to-string", ["get", "fire_final"]], selectedKey], "#ffffff", HAZARD_RATING_COLOR]
        : HAZARD_RATING_COLOR,
    );
  }
  if (map.getLayer?.("tracked-fires-center")) {
    map.setPaintProperty(
      "tracked-fires-center",
      "circle-radius",
      selectedKey
        ? ["case", ["==", ["to-string", ["get", "fire_final"]], selectedKey], 9.5, hazardCenterRadius]
        : hazardCenterRadius,
    );
  }
  if (map.getLayer?.("tracked-fires-hazard-label")) {
    map.setFilter(
      "tracked-fires-hazard-label",
      selectedKey
        ? [
          "all",
          ["!=", ["get", "hazard_score"], null],
          [">=", ["get", "hazard_score"], 0],
          ["!=", ["to-string", ["get", "fire_final"]], selectedKey],
        ]
        : ["all", ["!=", ["get", "hazard_score"], null], [">=", ["get", "hazard_score"], 0]],
    );
  }
}

// Use the filtering geometry for the outline; fall back to Mapbox when the feed is unavailable.
export function ensureCountryLayers(map, country) {
  const geometry = country?.geometry;
  const sourceType = geometry ? "geojson" : "vector";
  const existing = map.getSource(COUNTRY_SOURCE);
  const data = geometry && {
    type: "Feature",
    geometry,
    properties: { iso_3166_1_alpha_3: country.iso3, worldview: "all" },
  };
  if (existing?.type === sourceType) {
    if (data) existing.setData(data);
    return false;
  }
  if (existing) {
    map.removeLayer("country-fill");
    map.removeLayer("country-line");
    map.removeSource(COUNTRY_SOURCE);
  }
  const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource(COUNTRY_SOURCE, geometry
    ? { type: "geojson", data }
    : { type: "vector", url: "mapbox://mapbox.country-boundaries-v1" });
  const sourceLayer = geometry ? {} : { "source-layer": COUNTRY_LAYER };
  map.addLayer(
    {
      id: "country-fill",
      type: "fill",
      source: COUNTRY_SOURCE,
      ...sourceLayer,
      filter: NO_COUNTRY,
      paint: { "fill-color": "#ff6a32", "fill-opacity": 0 },
    },
    labelLayer,
  );
  map.addLayer(
    {
      id: "country-line",
      type: "line",
      source: COUNTRY_SOURCE,
      ...sourceLayer,
      filter: NO_COUNTRY,
      paint: { "line-color": "#ffb27a", "line-width": 1.6, "line-opacity": 0 },
    },
    labelLayer,
  );
  return true;
}

export function addHotspotLayers(map) {
  map.addSource(PREDICTION_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "fire-uncertainty-outer-fill",
    type: "fill",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "uncertainty_outer"],
    paint: {
      "fill-color": "#ffab40",
      "fill-opacity": 0.08,
    },
  });
  map.addLayer({
    id: "fire-uncertainty-outer-line",
    type: "line",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "uncertainty_outer"],
    paint: {
      "line-color": "#ffb74d",
      "line-width": 1.2,
      "line-dasharray": [3, 3],
      "line-opacity": 0.65,
    },
  });
  map.addLayer({
    id: "fire-growth-zone-fill",
    type: "fill",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "growth_zone"],
    paint: {
      "fill-color": "#ff5252",
      "fill-opacity": 0.22,
    },
  });
  map.addLayer({
    id: "fire-predicted-footprint-line",
    type: "line",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "predicted_footprint"],
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "prediction_status"], "expansion_likely"],
        "#ff4d4d",
        "#ffa726",
      ],
      "line-width": 2,
      "line-dasharray": [4, 2],
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: "fire-current-footprint-fill",
    type: "fill",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "current_footprint"],
    paint: {
      "fill-color": "#ff7043",
      "fill-opacity": 0.22,
    },
  });
  map.addLayer({
    id: "fire-current-footprint-line",
    type: "line",
    source: PREDICTION_SOURCE,
    filter: ["==", ["get", "role"], "current_footprint"],
    paint: {
      "line-color": "#ff8a65",
      "line-width": 1.5,
      "line-opacity": 0.85,
    },
  });

  map.addSource(SELECTED_FIRE_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "selected-fire-uncertainty-fill",
    type: "fill",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_uncertainty_outer"],
    paint: {
      "fill-color": "#fbbf24",
      "fill-opacity": 0.09,
    },
  });
  map.addLayer({
    id: "selected-fire-uncertainty-line",
    type: "line",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_uncertainty_outer"],
    paint: {
      "line-color": "#fbbf24",
      "line-width": 1.8,
      "line-dasharray": [3, 3],
      "line-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "selected-fire-predicted-fill",
    type: "fill",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_predicted_footprint"],
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "prediction_status"], "expansion_likely"],
        "#ff5252",
        "#fb923c",
      ],
      "fill-opacity": 0.14,
    },
  });
  map.addLayer({
    id: "selected-fire-predicted-line",
    type: "line",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_predicted_footprint"],
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "prediction_status"], "expansion_likely"],
        "#ff4d4d",
        "#fb923c",
      ],
      "line-width": 2.4,
      "line-dasharray": [4, 2],
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "selected-fire-actual-fill",
    type: "fill",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_actual_footprint"],
    paint: {
      "fill-color": "#10b981",
      "fill-opacity": 0.25,
    },
  });
  map.addLayer({
    id: "selected-fire-actual-line",
    type: "line",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_actual_footprint"],
    paint: {
      "line-color": "#34d399",
      "line-width": 2.8,
      "line-opacity": 0.98,
    },
  });
  map.addLayer({
    id: "selected-fire-current-fill",
    type: "fill",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_current_footprint"],
    paint: {
      "fill-color": "#ff6a32",
      "fill-opacity": 0.28,
    },
  });
  map.addLayer({
    id: "selected-fire-current-line",
    type: "line",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_current_footprint"],
    paint: {
      "line-color": "#ffd2b3",
      "line-width": 2.4,
      "line-opacity": 0.98,
    },
  });

  map.addSource(HOTSPOT_SOURCE, { type: "geojson", data: toFeatureCollection([]) });
  map.addLayer({
    id: "hotspots-glow",
    type: "circle",
    source: HOTSPOT_SOURCE,
    paint: {
      "circle-color": GLOW_COLOR,
      "circle-blur": 1,
      "circle-opacity": [
        "case",
        ["==", ["get", "extinguished"], 1],
        0.16,
        0.3,
      ],
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        1, byFrp(4, 11), 5, byFrp(9, 26), 9, byFrp(16, 42),
      ],
    },
  });
  map.addLayer({
    id: PULSE_LAYER,
    type: "circle",
    source: HOTSPOT_SOURCE,
    filter: ["all", ["==", ["get", "in"], 1], ["!=", ["get", "extinguished"], 1]],
    paint: {
      "circle-radius": 0,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#ff7a45",
      "circle-stroke-width": 1.2,
      "circle-stroke-opacity": 0,
    },
  });
  map.addLayer({
    id: "hotspots-modis-footprint",
    type: "circle",
    source: HOTSPOT_SOURCE,
    filter: ["all", ["==", ["get", "tier"], 3], ["!=", ["get", "extinguished"], 1]],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        ["*", ["coalesce", ["get", "footprintKm"], 1], 2.2],
        7,
        ["*", ["coalesce", ["get", "footprintKm"], 1], 5.5],
        11,
        ["*", ["coalesce", ["get", "footprintKm"], 1], 14],
      ],
      "circle-color": "rgba(217, 119, 6, 0.08)",
      "circle-stroke-color": "#fbbf24",
      "circle-stroke-width": 1.3,
      "circle-stroke-opacity": 0.72,
    },
  });
  map.addLayer({
    id: "hotspots-core",
    type: "circle",
    source: HOTSPOT_SOURCE,
    paint: {
      "circle-color": CORE_COLOR,
      "circle-opacity": [
        "case",
        ["==", ["get", "extinguished"], 1],
        0.55,
        ["==", ["get", "tier"], 4],
        0.42,
        ["==", ["get", "tier"], 3],
        0.78,
        1,
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 5, 2.8, 9, 5],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "extinguished"], 1],
        "rgba(80, 65, 55, 0.4)",
        "#0b0b0a",
      ],
      "circle-stroke-width": 0.5,
    },
  });

  map.addSource(TRACKED_FIRES_SOURCE, { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "tracked-fires-ring",
    type: "circle",
    source: TRACKED_FIRES_SOURCE,
    paint: {
      "circle-radius": 9,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": HAZARD_RATING_COLOR,
      "circle-stroke-width": 1.4,
      "circle-stroke-opacity": 0.88,
    },
  });
  map.addLayer({
    id: "tracked-fires-center",
    type: "circle",
    source: TRACKED_FIRES_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": HAZARD_RATING_COLOR,
      "circle-stroke-color": "#0b0b0a",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.94,
    },
  });

  map.addLayer({
    id: "selected-fire-trajectory-line",
    type: "line",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_spread_trajectory"],
    paint: {
      "line-color": "#fde047",
      "line-width": 2.4,
      "line-dasharray": [2, 1.5],
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "selected-fire-detections-point",
    type: "circle",
    source: SELECTED_FIRE_SOURCE,
    filter: ["==", ["get", "role"], "selected_detection_point"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 4, 60, 7.5],
      "circle-color": ["interpolate", ["linear"], ["get", "age"], 0, "#fb923c", 1, "#ffffff"],
      "circle-stroke-color": "#0b0b0a",
      "circle-stroke-width": 1.1,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "tracked-fires-hazard-label",
    type: "symbol",
    source: TRACKED_FIRES_SOURCE,
    filter: ["all", ["!=", ["get", "hazard_score"], null], [">=", ["get", "hazard_score"], 0]],
    layout: {
      "text-field": [
        "concat",
        ["upcase", ["coalesce", ["get", "hazard_rating"], ""]],
        " ",
        ["to-string", ["get", "hazard_score"]],
      ],
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9.5, 8, 11, 12, 12],
      "text-offset": [0, -1.4],
      "text-anchor": "bottom",
      "text-allow-overlap": false,
      "text-padding": 3,
    },
    paint: {
      "text-color": HAZARD_RATING_COLOR,
      "text-halo-color": "rgba(11, 11, 10, 0.94)",
      "text-halo-width": 1.6,
    },
  });
  map.addLayer({
    id: "selected-fire-center-label",
    type: "symbol",
    source: SELECTED_FIRE_SOURCE,
    filter: [
      "all",
      ["==", ["get", "role"], "selected_ring_label"],
      ["==", ["get", "label_kind"], "center_badge"],
    ],
    layout: {
      "text-field": ["get", "label_text"],
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      "text-size": 12.5,
      "text-offset": [0, -1.65],
      "text-anchor": "bottom",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": HAZARD_RATING_COLOR,
      "text-halo-color": "rgba(10, 9, 8, 0.96)",
      "text-halo-width": 2,
    },
  });
  map.addLayer({
    id: "selected-fire-ring-labels",
    type: "symbol",
    source: SELECTED_FIRE_SOURCE,
    filter: [
      "all",
      ["==", ["get", "role"], "selected_ring_label"],
      ["!=", ["get", "label_kind"], "center_badge"],
    ],
    layout: {
      "text-field": ["get", "label_text"],
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      "text-size": 10.5,
      "text-anchor": "center",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": [
        "match",
        ["get", "label_kind"],
        "actual_label",
        "#6ee7b7",
        "current_label",
        "#ffd5b8",
        "predicted_label",
        "#ff9e80",
        "#fde047",
      ],
      "text-halo-color": "rgba(10, 9, 8, 0.95)",
      "text-halo-width": 1.8,
    },
  });
}

// Anime.js drives a looping sonar ring on the brightest in-country detections.
// Paint updates are capped to `minFrameMs` because every one of them re-renders the map.
export function startPulse(map, minFrameMs = 0) {
  const ring = { t: 0 };
  let lastPaint = 0;
  return animate(ring, {
    t: 1,
    duration: 2400,
    ease: "outQuad",
    loop: true,
    onUpdate: () => {
      const now = performance.now();
      if (now - lastPaint < minFrameMs || !map.getLayer(PULSE_LAYER)) return;
      lastPaint = now;
      map.setPaintProperty(PULSE_LAYER, "circle-radius", 3 + ring.t * 17);
      map.setPaintProperty(PULSE_LAYER, "circle-stroke-opacity", 0.85 * (1 - ring.t));
    },
  });
}

function tweenCountry(map, from, to, duration) {
  const glow = { v: from };
  return animate(glow, {
    v: to,
    duration,
    ease: "outCubic",
    onUpdate: () => {
      map.setPaintProperty("country-fill", "fill-opacity", glow.v * 0.18);
      map.setPaintProperty("country-line", "line-opacity", glow.v * 0.95);
    },
  });
}

export function showCountry(map, iso3) {
  const filter = ["all", WORLDVIEW, ["==", ["get", "iso_3166_1_alpha_3"], iso3]];
  map.setFilter("country-fill", filter);
  map.setFilter("country-line", filter);
  return tweenCountry(map, 0, 1, 1800);
}

export function hideCountry(map) {
  const animation = tweenCountry(map, 1, 0, 700);
  animation.then(() => {
    if (!map.getLayer("country-fill")) return;
    map.setFilter("country-fill", NO_COUNTRY);
    map.setFilter("country-line", NO_COUNTRY);
  });
  return animation;
}

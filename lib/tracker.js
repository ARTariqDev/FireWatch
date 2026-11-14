const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_ASSOCIATION_KM = 1.5;
const MAX_TIME_GAP_MS = 36 * 60 * 60 * 1000; // 36 hours between consecutive detections

function distanceKm(lon1, lat1, lon2, lat2) {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = p2 - p1;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Creates a circular bounding polygon around a centroid (km radius)
 */
function createFootprintPolygon(centerLon, centerLat, radiusKm = 0.5, steps = 12) {
  const coords = [];
  const latR = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const lonR = latR / Math.cos((centerLat * Math.PI) / 180);

  for (let i = 0; i <= steps; i++) {
    const theta = (i * 2 * Math.PI) / steps;
    coords.push([
      Number((centerLon + lonR * Math.cos(theta)).toFixed(5)),
      Number((centerLat + latR * Math.sin(theta)).toFixed(5)),
    ]);
  }
  return {
    type: "Polygon",
    coordinates: [coords],
  };
}

/**
 * Reconstructs fire events from harmonized observations.
 * Associates related observations across MODIS and VIIRS into distinct fire events
 * with deterministic IDs, observation history, and ready slots for ML prediction models.
 */
export function trackFires(harmonizedPoints = [], options = {}) {
  if (!harmonizedPoints || !harmonizedPoints.length) {
    return {
      events: [],
      eventsGeoJson: { type: "FeatureCollection", features: [] },
    };
  }

  const associationRadius = options.associationKm || DEFAULT_ASSOCIATION_KM;

  // Sort chronologically
  const sorted = [...harmonizedPoints].sort((a, b) => (a[5] ?? 0) - (b[5] ?? 0));

  // Cluster observations into events
  const clusters = [];

  for (const point of sorted) {
    const lon = point[0];
    const lat = point[1];
    const frp = point[2] ?? 0;
    const sensor = point[3] ?? 1;
    const acquired = point[5] ?? Date.now();
    const evidence = point[7] ?? 0;
    const tier = point[8] ?? 2;
    const confidence = point[9] ?? null;
    const satellite = point[10] ?? null;
    const matches = point[11] ?? [];

    // Footprint-aware threshold: 1km for MODIS, 375m for VIIRS
    const sensorRadius = sensor === 0 ? 1.0 : 0.375;

    let targetCluster = null;
    let minDistance = Infinity;

    for (const cluster of clusters) {
      // Check temporal continuity
      if (Math.abs(acquired - cluster.lastAcquired) > MAX_TIME_GAP_MS) continue;

      // Check distance to cluster centroid or any observation in cluster
      const dist = distanceKm(lon, lat, cluster.centroidLon, cluster.centroidLat);
      const threshold = Math.max(associationRadius, sensorRadius + cluster.maxSensorRadius);

      if (dist <= threshold && dist < minDistance) {
        minDistance = dist;
        targetCluster = cluster;
      }
    }

    const obsItem = {
      sensor: sensor === 0 ? "MODIS" : "VIIRS",
      latitude: lat,
      longitude: lon,
      frp,
      confidence,
      timestamp: new Date(acquired).toISOString(),
      satellite: satellite || (sensor === 0 ? "Terra" : "NOAA-20"),
    };

    if (targetCluster) {
      targetCluster.points.push(point);
      targetCluster.observations.push(obsItem);
      // Include any matching MODIS observations
      if (Array.isArray(matches) && matches.length) {
        for (const m of matches) {
          targetCluster.observations.push({
            sensor: "MODIS",
            latitude: m[1],
            longitude: m[0],
            frp: m[2],
            confidence: m[5],
            timestamp: new Date(m[4]).toISOString(),
            satellite: m[6] || "Terra",
          });
        }
      }
      targetCluster.lastAcquired = Math.max(targetCluster.lastAcquired, acquired);
      targetCluster.totalFrp += frp;
      targetCluster.maxFrp = Math.max(targetCluster.maxFrp, frp);
      targetCluster.maxSensorRadius = Math.max(targetCluster.maxSensorRadius, sensorRadius);
      if (tier === 1 || evidence === 3) targetCluster.hasDual = true;
      if (sensor === 0) targetCluster.modisCount++;
      else targetCluster.viirsCount++;
    } else {
      const allObs = [obsItem];
      if (Array.isArray(matches) && matches.length) {
        for (const m of matches) {
          allObs.push({
            sensor: "MODIS",
            latitude: m[1],
            longitude: m[0],
            frp: m[2],
            confidence: m[5],
            timestamp: new Date(m[4]).toISOString(),
            satellite: m[6] || "Terra",
          });
        }
      }

      clusters.push({
        points: [point],
        observations: allObs,
        firstAcquired: acquired,
        lastAcquired: acquired,
        centroidLon: lon,
        centroidLat: lat,
        totalFrp: frp,
        maxFrp: frp,
        maxSensorRadius: sensorRadius,
        hasDual: tier === 1 || evidence === 3,
        modisCount: sensor === 0 ? 1 : 0,
        viirsCount: sensor === 1 ? 1 : 0,
      });
    }
  }

  // Construct structured fire events
  const events = [];
  const features = [];

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const count = c.observations.length;

    // Recalculate FRP-weighted centroid and bounding box
    let sumWeight = 0;
    let wLon = 0;
    let wLat = 0;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const obs of c.observations) {
      const weight = Math.max(0.1, obs.frp);
      wLon += obs.longitude * weight;
      wLat += obs.latitude * weight;
      sumWeight += weight;

      if (obs.longitude < minLon) minLon = obs.longitude;
      if (obs.longitude > maxLon) maxLon = obs.longitude;
      if (obs.latitude < minLat) minLat = obs.latitude;
      if (obs.latitude > maxLat) maxLat = obs.latitude;
    }

    const centroid = [
      Number((wLon / sumWeight).toFixed(5)),
      Number((wLat / sumWeight).toFixed(5)),
    ];

    // Deterministic, reproducible event ID based on origin coordinate + first detection
    const latTag = Math.round(centroid[1] * 100);
    const lonTag = Math.round(centroid[0] * 100);
    const eventId = `fire_${Math.abs(latTag)}_${Math.abs(lonTag)}_${Math.floor(c.firstAcquired / 1000)}`;

    const detectionConfidence = c.hasDual
      ? "dual_confirmed"
      : c.viirsCount > 0
        ? "viirs_only"
        : "modis_only";

    const trackingConfidence =
      c.hasDual || count >= 3 ? "high" : count >= 2 ? "nominal" : "low";

    const durationHours = Number(
      ((c.lastAcquired - c.firstAcquired) / (3600 * 1000)).toFixed(2),
    );

    // Dynamic radius for footprint based on spread distance
    const spanKm = distanceKm(minLon, minLat, maxLon, maxLat);
    const footprintRadiusKm = Math.max(0.5, spanKm / 2 + 0.375);
    const footprint = createFootprintPolygon(centroid[0], centroid[1], footprintRadiusKm);

    const event = {
      event_id: eventId,
      centroid,
      bbox: [minLon, minLat, maxLon, maxLat],
      detection_confidence: detectionConfidence,
      tracking_confidence: trackingConfidence,
      first_detected: new Date(c.firstAcquired).toISOString(),
      last_detected: new Date(c.lastAcquired).toISOString(),
      duration_hours: durationHours,
      peak_frp: Number(c.maxFrp.toFixed(1)),
      mean_frp: Number((c.totalFrp / Math.max(1, c.points.length)).toFixed(1)),
      total_frp: Number(c.totalFrp.toFixed(1)),
      observation_count: count,
      modis_count: c.modisCount,
      viirs_count: c.viirsCount,
      observations: c.observations,
      footprint,
      // Ready slot for ML models: Model 1 (persistence), Model 2 (expansion), Model 3 (additional area)
      prediction: null,
    };

    events.push(event);

    features.push({
      type: "Feature",
      id: eventId,
      geometry: footprint,
      properties: {
        event_id: eventId,
        detection_confidence: detectionConfidence,
        tracking_confidence: trackingConfidence,
        peak_frp: event.peak_frp,
        total_frp: event.total_frp,
        observation_count: count,
        first_detected: event.first_detected,
        last_detected: event.last_detected,
        duration_hours: durationHours,
      },
    });
  }

  return {
    events,
    eventsGeoJson: {
      type: "FeatureCollection",
      features,
    },
  };
}


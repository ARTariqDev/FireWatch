const EARTH_RADIUS_KM = 6371.0088;
const MATCH_RADIUS_KM = 1;
const COINCIDENCE_WINDOW_MS = 4 * 60 * 60 * 1000;

// These are ordinal evidence levels, not probabilities.
export function viirsEvidence(raw) {
  const confidence = String(raw ?? "").trim().toLowerCase();
  if (confidence === "h" || confidence === "high") return 2;
  if (confidence === "n" || confidence === "nominal") return 1;
  return 0;
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
  return position.map((value) => Math.floor(value / MATCH_RADIUS_KM));
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

function observation(row) {
  const [lon, lat, frp, sensor, acquired, confidence = null, satellite = null] = row;
  if (
    !Number.isFinite(lon) || lon < -180 || lon > 180 ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(frp) || !Number.isFinite(acquired) ||
    (sensor !== 0 && sensor !== 1)
  ) {
    throw new TypeError("Invalid FIRMS observation");
  }
  return { lon, lat, frp, sensor, acquired, confidence, satellite, matched: false, matches: [] };
}

function rawRow(record) {
  return [
    record.lon, record.lat, record.frp, record.sensor, record.acquired,
    record.confidence, record.satellite,
  ];
}

function resultRow(record) {
  const evidence = record.matched ? 3 : record.sensor === 1 ? viirsEvidence(record.confidence) : 0;
  const tier = record.matched ? 1 : record.sensor === 1 ? 2 : 3;
  return [
    record.lon, record.lat, record.frp, record.sensor, 1, record.acquired,
    null, evidence, tier, record.confidence, record.satellite, record.matches,
  ];
}

/**
 * Match nearby observations, not confirmed individual fires. A MODIS observation
 * can correspond to several real VIIRS pixels; no synthetic pixels are created.
 * The matching MODIS rows are retained so time filtering can reconstruct both passes.
 */
export function harmonizeHotspots(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const record = observation(row);
    const key = JSON.stringify([record.sensor, record.satellite, record.acquired, record.lon, record.lat]);
    const existing = unique.get(key);
    if (!existing || record.frp > existing.frp) unique.set(key, record);
  }

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

  for (const coarse of modis) {
    const [x, y, z] = cell(coordinates(coarse.lon, coarse.lat));
    let nearest = null;
    let nearestDistance = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const fine of cells.get(`${x + dx}:${y + dy}:${z + dz}`) ?? []) {
            if (Math.abs(coarse.acquired - fine.acquired) > COINCIDENCE_WINDOW_MS) continue;
            const distance = distanceKm(coarse, fine);
            if (distance > MATCH_RADIUS_KM) continue;
            coarse.matched = true;
            fine.matched = true;
            if (distance < nearestDistance) {
              nearest = fine;
              nearestDistance = distance;
            }
          }
        }
      }
    }
    if (nearest) nearest.matches.push(rawRow(coarse));
  }

  return [
    ...viirs.map(resultRow),
    ...modis.filter((record) => !record.matched).map(resultRow),
  ];
}

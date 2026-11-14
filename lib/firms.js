const FIRMS_AREA_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FETCH_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 500;
const WINDOW_MS = 24 * 60 * 60 * 1000;

// VIIRS uses NOAA-20 because the SNPP near-real-time feed currently lags by days.
export const SOURCES = [
  { id: "MODIS_NRT", sensor: 0 },
  { id: "VIIRS_NOAA20_NRT", sensor: 1 },
];

export class FirmsError extends Error {}

function getMapKey() {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new FirmsError("FIRMS_MAP_KEY is not configured");
  return key;
}

// Rows are [lon, lat, frp, sensor, acquired?, confidence?, satellite?]; FIRMS CSV has no quoted fields.
function parseCsv(text, sensor, windowEnd, options = {}) {
  const { withAcquired = false, windowStart = windowEnd - WINDOW_MS } = options;
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const lat = header.indexOf("latitude");
  const lon = header.indexOf("longitude");
  const frp = header.indexOf("frp");
  const date = header.indexOf("acq_date");
  const time = header.indexOf("acq_time");
  const confidence = header.indexOf("confidence");
  const satellite = header.indexOf("satellite");
  if ([lat, lon, frp, date, time].some((index) => index < 0)) throw new FirmsError("Unexpected FIRMS CSV format");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawTime = cols[time];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[date]) || !/^\d{1,4}$/.test(rawTime)) {
      throw new FirmsError("Unexpected FIRMS acquisition time");
    }
    const hhmm = rawTime.padStart(4, "0");
    const hours = Number(hhmm.slice(0, 2));
    const minutes = Number(hhmm.slice(2));
    const acquired = Date.parse(`${cols[date]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (hours > 23 || minutes > 59 || !Number.isFinite(acquired)) {
      throw new FirmsError("Unexpected FIRMS acquisition time");
    }
    if (acquired < windowStart || acquired > windowEnd) continue;
    const latitude = Number(cols[lat]);
    const longitude = Number(cols[lon]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const conf = confidence >= 0 ? (cols[confidence] ?? null) : null;
      const sat = satellite >= 0 ? (cols[satellite] ?? null) : null;
      rows.push(
        withAcquired
          ? [longitude, latitude, Number(cols[frp]) || 0, sensor, acquired, conf, sat]
          : [longitude, latitude, Number(cols[frp]) || 0, sensor],
      );
    }
  }
  return rows;
}

// FIRMS day ranges are UTC calendar days, so two days are needed for a rolling 24-hour window.
export async function fetchDetections(source, area, windowEnd = Date.now(), options = {}) {
  const { date, dayRange = 2, withAcquired = false, windowStart } = options;
  const rangePart = date ? `${dayRange}/${date}` : `${dayRange}`;
  const url = `${FIRMS_AREA_API}/${getMapKey()}/${source.id}/${area}/${rangePart}`;
  for (let attempt = 0; ; attempt++) {
    let response;
    let text;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      text = await response.text();
    } catch (error) {
      if (!(error instanceof TypeError) && error?.name !== "TimeoutError") throw error;
      if (attempt === 1) throw new FirmsError(`FIRMS ${source.id} is unreachable`);
      console.warn(`FIRMS ${source.id} connection failed; retrying once.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    if ([500, 502, 503, 504].includes(response.status) && attempt === 0) {
      console.warn(`FIRMS ${source.id} returned ${response.status}; retrying once.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    if (!response.ok || !text.startsWith("latitude")) {
      throw new FirmsError(`FIRMS ${source.id} request failed (${response.status})`);
    }
    return parseCsv(text, source.sensor, windowEnd, { withAcquired, windowStart });
  }
}

function acquiredAt(row) {
  // Harmonized: [lon, lat, frp, sensor, inside, acquired, ...]
  // Compact FIRMS: [lon, lat, frp, sensor, acquired?, ...]
  if (row.length >= 6 && Number.isFinite(row[5]) && row[5] > 1e11) return row[5];
  if (Number.isFinite(row[4]) && row[4] > 1e11) return row[4];
  return undefined;
}

// Keeps the brightest detection in each grid cell so payloads stay small.
// Preserves any trailing fields (inside, acquired, evidence, tier, matches, …).
export function thinToGrid(rows, cellDegrees, limit) {
  const cells = new Map();
  for (const row of rows) {
    const acquired = acquiredAt(row);
    const timeBucket = acquired !== undefined ? `:${Math.floor(acquired / 3600000)}` : "";
    const key = `${Math.floor(row[0] / cellDegrees)}:${Math.floor(row[1] / cellDegrees)}${timeBucket}`;
    const current = cells.get(key);
    if (!current || row[2] > current[2]) cells.set(key, row);
  }
  return [...cells.values()]
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
    .map((row) => {
      const next = row.slice();
      next[2] = Number(Number(next[2]).toFixed(1));
      return next;
    });
}

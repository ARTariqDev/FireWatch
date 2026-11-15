const FIRMS_AREA_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FETCH_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 500;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FIRMS_DAYS = 5;

// VIIRS uses NOAA-20 because the SNPP near-real-time feed currently lags by days.
export const SOURCES = [
  { id: "MODIS_NRT", sensor: 0 },
  { id: "VIIRS_NOAA20_NRT", sensor: 1 },
];

// Full sensor feeds for the 14-day tracker pipeline (MODIS + VIIRS NOAA-20 + Suomi-NPP).
export const TRACKER_SOURCES = [
  { id: "MODIS_NRT", sensor: 0, instrument: "MODIS", defaultSatellite: "Terra" },
  { id: "VIIRS_NOAA20_NRT", sensor: 1, instrument: "VIIRS", defaultSatellite: "N20" },
  { id: "VIIRS_SNPP_NRT", sensor: 1, instrument: "VIIRS", defaultSatellite: "N", optional: true },
];

export class FirmsError extends Error {}

function getMapKey() {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new FirmsError("FIRMS_MAP_KEY is not configured");
  return key;
}

function normalizeViirsConfidence(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "h" || value === "high") return "h";
  if (value === "l" || value === "low") return "l";
  if (value === "n" || value === "nominal") return "n";
  return value || "n";
}

function normalizeDayNight(raw, longitude, utcHours) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "D" || value === "N") return value;
  const localHour = ((utcHours + longitude / 15) % 24 + 24) % 24;
  return localHour >= 6 && localHour < 18 ? "D" : "N";
}

function normalizeSatellite(raw, sensor, defaultSatellite) {
  const value = String(raw ?? "").trim();
  if (value) return value;
  if (defaultSatellite) return defaultSatellite;
  return sensor === 0 ? "Terra" : "N20";
}

function optionalNumber(cols, index) {
  if (index < 0) return undefined;
  const value = Number(cols[index]);
  return Number.isFinite(value) ? value : undefined;
}

// Rows are [lon, lat, frp, sensor, acquired?, confidence?, satellite?]; FIRMS CSV has no quoted fields.
function parseCsv(text, sensor, windowEnd, options = {}) {
  const {
    withAcquired = false,
    withTrackerRecord = false,
    windowStart = windowEnd - WINDOW_MS,
    instrument: defaultInstrument,
    defaultSatellite,
  } = options;
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const lat = header.indexOf("latitude");
  const lon = header.indexOf("longitude");
  const frp = header.indexOf("frp");
  const date = header.indexOf("acq_date");
  const time = header.indexOf("acq_time");
  const confidence = header.indexOf("confidence");
  const satellite = header.indexOf("satellite");
  const daynight = header.indexOf("daynight");
  const instrument = header.indexOf("instrument");
  const brightTi4Idx = header.indexOf("bright_ti4");
  const brightTi5Idx = header.indexOf("bright_ti5");
  const brightnessIdx = header.indexOf("brightness");
  const brightT31Idx = header.indexOf("bright_t31");
  const scanIdx = header.indexOf("scan");
  const trackIdx = header.indexOf("track");
  const versionIdx = header.indexOf("version");
  if ([lat, lon, frp, date, time].some((index) => index < 0)) throw new FirmsError("Unexpected FIRMS CSV format");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
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
      const numericFrp = Number(cols[frp]) || 0;

      if (withTrackerRecord) {
        const dn = normalizeDayNight(daynight >= 0 ? cols[daynight] : null, longitude, hours);
        const satName = normalizeSatellite(sat, sensor, defaultSatellite);
        const instName =
          (instrument >= 0 ? cols[instrument]?.trim() : "") ||
          defaultInstrument ||
          (sensor === 0 ? "MODIS" : "VIIRS");
        const bright_ti4 = optionalNumber(cols, brightTi4Idx);
        const bright_ti5 = optionalNumber(cols, brightTi5Idx);
        const brightness = optionalNumber(cols, brightnessIdx);
        const bright_t31 = optionalNumber(cols, brightT31Idx);
        const scan = optionalNumber(cols, scanIdx);
        const track = optionalNumber(cols, trackIdx);
        const version = versionIdx >= 0 && cols[versionIdx]?.trim() ? cols[versionIdx].trim() : undefined;

        const trackerHotspot = {
          latitude,
          longitude,
          acq_date: cols[date],
          acq_time: Number(rawTime),
          frp: numericFrp,
          confidence:
            sensor === 0
              ? (conf !== null && conf !== "" && Number.isFinite(Number(conf)) ? Number(conf) : 50)
              : normalizeViirsConfidence(conf),
          daynight: dn,
          satellite: satName,
          instrument: instName,
          ...(bright_ti4 !== undefined ? { bright_ti4 } : {}),
          ...(bright_ti5 !== undefined ? { bright_ti5 } : {}),
          ...(brightness !== undefined ? { brightness } : {}),
          ...(bright_t31 !== undefined ? { bright_t31 } : {}),
          ...(scan !== undefined ? { scan } : {}),
          ...(track !== undefined ? { track } : {}),
          ...(version !== undefined ? { version } : {}),
          _acquired: acquired,
          _sensor: sensor,
        };
        rows.push({
          row: [longitude, latitude, numericFrp, sensor, acquired, conf, satName, dn],
          trackerHotspot,
        });
      } else {
        rows.push(
          withAcquired
            ? [longitude, latitude, numericFrp, sensor, acquired, conf, sat]
            : [longitude, latitude, numericFrp, sensor],
        );
      }
    }
  }
  return rows;
}

// FIRMS day ranges are UTC calendar days, so two days are needed for a rolling 24-hour window.
export async function fetchDetections(source, area, windowEnd = Date.now(), options = {}) {
  const {
    date,
    dayRange = 2,
    withAcquired = false,
    withTrackerRecord = false,
    windowStart,
    instrument = source.instrument,
    defaultSatellite = source.defaultSatellite,
  } = options;
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
    return parseCsv(text, source.sensor, windowEnd, {
      withAcquired,
      withTrackerRecord,
      windowStart,
      instrument,
      defaultSatellite,
    });
  }
}

function dedupeTrackerDetections(items) {
  const deduped = new Map();
  for (const item of items) {
    const h = item.trackerHotspot;
    const key = `${h._sensor}:${h.satellite}:${h._acquired}:${h.longitude}:${h.latitude}`;
    const existing = deduped.get(key);
    if (!existing || h.frp > existing.trackerHotspot.frp) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()];
}

// Fetches up to 14 days of FIRMS detections in <=5-day API chunks and deduplicates rows.
export async function fetchDetections14Days(source, area, windowEnd = Date.now(), options = {}) {
  const totalDays = Math.max(1, Number(options.dayRange) || 14);
  const baseOptions = {
    ...options,
    withAcquired: true,
    withTrackerRecord: true,
  };

  if (options.date) {
    const startMs = Date.parse(`${options.date}T00:00:00Z`);
    const windowStart = options.windowStart ?? startMs;
    const chunkPromises = [];

    for (let offset = 0; offset < totalDays; offset += MAX_FIRMS_DAYS) {
      const chunkDate = new Date(startMs + offset * DAY_MS).toISOString().slice(0, 10);
      const chunkDays = Math.min(MAX_FIRMS_DAYS, totalDays - offset);
      const promise = fetchDetections(source, area, windowEnd, {
        ...baseOptions,
        date: chunkDate,
        dayRange: chunkDays,
        windowStart,
      });
      chunkPromises.push(offset === 0 ? promise : promise.catch(() => []));
    }

    const chunks = await Promise.all(chunkPromises);
    return dedupeTrackerDetections(chunks.flat());
  }

  // Live mode: disable local clock-skew filtering on the latest chunk so FIRMS
  // timestamps define the detection window ceiling even if host clock differs.
  const latestChunkDays = Math.min(MAX_FIRMS_DAYS, totalDays);
  const latestChunk = await fetchDetections(source, area, Infinity, {
    ...baseOptions,
    date: undefined,
    dayRange: latestChunkDays,
    windowStart: -Infinity,
  });

  if (totalDays <= MAX_FIRMS_DAYS && latestChunk.length === 0) {
    return [];
  }

  let latestAcqMs = -Infinity;
  for (const item of latestChunk) {
    const acq = Number.isFinite(item.acquired)
      ? item.acquired
      : Date.parse(item.trackerHotspot?._acquired ?? "");
    if (Number.isFinite(acq) && acq > latestAcqMs) {
      latestAcqMs = acq;
    }
  }
  if (!Number.isFinite(latestAcqMs)) {
    latestAcqMs = Number.isFinite(windowEnd) ? windowEnd : Date.now();
  }

  const cutoffMs = options.windowStart ?? (latestAcqMs - totalDays * DAY_MS);
  const lookbackChunks = [];

  if (totalDays > MAX_FIRMS_DAYS) {
    const midDate = new Date(latestAcqMs - 9 * DAY_MS).toISOString().slice(0, 10);
    lookbackChunks.push(
      fetchDetections(source, area, latestAcqMs, {
        ...baseOptions,
        date: midDate,
        dayRange: MAX_FIRMS_DAYS,
        windowStart: cutoffMs,
      }).catch(() => []),
    );
  }

  if (totalDays > MAX_FIRMS_DAYS * 2) {
    const oldestDate = new Date(latestAcqMs - 14 * DAY_MS).toISOString().slice(0, 10);
    lookbackChunks.push(
      fetchDetections(source, area, latestAcqMs, {
        ...baseOptions,
        date: oldestDate,
        dayRange: MAX_FIRMS_DAYS,
        windowStart: cutoffMs,
      }).catch(() => []),
    );
  }

  const earlierChunks = lookbackChunks.length > 0 ? await Promise.all(lookbackChunks) : [];
  const merged = dedupeTrackerDetections([...earlierChunks.flat(), ...latestChunk]);

  return merged.filter((item) => {
    const acq = Number.isFinite(item.acquired)
      ? item.acquired
      : Date.parse(item.trackerHotspot?._acquired ?? "");
    return !Number.isFinite(acq) || (acq >= cutoffMs && acq <= latestAcqMs);
  });
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

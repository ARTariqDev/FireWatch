const FIRMS_AREA_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

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

// Rows are [lon, lat, frp, sensor]; FIRMS CSV has no quoted fields.
function parseCsv(text, sensor) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const lat = header.indexOf("latitude");
  const lon = header.indexOf("longitude");
  const frp = header.indexOf("frp");
  if (lat < 0 || lon < 0 || frp < 0) throw new FirmsError("Unexpected FIRMS CSV format");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const latitude = Number(cols[lat]);
    const longitude = Number(cols[lon]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      rows.push([longitude, latitude, Number(cols[frp]) || 0, sensor]);
    }
  }
  return rows;
}

// `area` is "world" or a "west,south,east,north" box covering the last day.
export async function fetchDetections(source, area) {
  const url = `${FIRMS_AREA_API}/${getMapKey()}/${source.id}/${area}/1`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok || !text.startsWith("latitude")) {
    throw new FirmsError(`FIRMS ${source.id} request failed (${response.status})`);
  }
  return parseCsv(text, source.sensor);
}

// Keeps the brightest detection in each grid cell so global payloads stay small.
export function thinToGrid(rows, cellDegrees, limit) {
  const cells = new Map();
  for (const row of rows) {
    const key = `${Math.floor(row[0] / cellDegrees)}:${Math.floor(row[1] / cellDegrees)}`;
    const current = cells.get(key);
    if (!current || row[2] > current[2]) cells.set(key, row);
  }
  return [...cells.values()]
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
    .map(([lon, lat, frp, sensor]) => [
      Number(lon.toFixed(3)),
      Number(lat.toFixed(3)),
      Number(frp.toFixed(1)),
      sensor,
    ]);
}

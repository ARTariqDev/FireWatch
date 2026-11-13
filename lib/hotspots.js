import { cacheLife } from "next/cache";
import { SOURCES, fetchDetections, thinToGrid } from "./firms";
import { findCountry, isInsideCountry, queryBbox } from "./countries";

const GLOBAL_CELL_DEGREES = 2;
const GLOBAL_LIMIT = 1400;
const CONTEXT_CELL_DEGREES = 0.2;
const CONTEXT_LIMIT = 1200;
const INSIDE_LIMIT = 4000;

// Brightest detections worldwide for the last day, thinned for the globe view.
export async function getWorldHotspots() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });

  const rows = (await Promise.all(SOURCES.map((source) => fetchDetections(source, "world")))).flat();
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    points: thinToGrid(rows, GLOBAL_CELL_DEGREES, GLOBAL_LIMIT),
  };
}

// Detections around one country. Points carry an `inside` flag (index 4) from a polygon test.
export async function getCountryHotspots(iso3) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });

  const country = findCountry(iso3);
  if (!country) return null;

  const box = queryBbox(country).join(",");
  const rows = (await Promise.all(SOURCES.map((source) => fetchDetections(source, box)))).flat();

  const inside = [];
  const outside = [];
  for (const row of rows) {
    (isInsideCountry(country, row[0], row[1]) ? inside : outside).push(row);
  }

  const stats = {
    inside: inside.length,
    context: outside.length,
    modis: inside.filter((row) => row[3] === 0).length,
    viirs: inside.filter((row) => row[3] === 1).length,
    maxFrp: Number(Math.max(0, ...inside.map((row) => row[2])).toFixed(1)),
    generatedAt: new Date().toISOString(),
  };

  const flag = (value) => (points) => points.map((point) => [...point, value]);
  const points = [
    ...flag(1)(thinToGrid(inside, 0.0001, INSIDE_LIMIT)),
    ...flag(0)(thinToGrid(outside, CONTEXT_CELL_DEGREES, CONTEXT_LIMIT)),
  ];

  return {
    country: { iso3, name: country.name, bbox: country.focusBbox },
    stats,
    points,
  };
}

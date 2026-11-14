import { cacheLife, cacheTag } from "next/cache";
import { SOURCES, fetchDetections, thinToGrid } from "./firms";
import { findCountry, isInsideCountry, queryBbox } from "./countries";

const INSIDE_LIMIT = 4000;
export const countryHotspotTag = (iso3, date = "") => `country-hotspots-${iso3}${date ? `-${date}` : ""}`;

// Only detections inside or on the selected country's boundaries are returned.
// Clients re-check every 30 minutes, so entries older than that are never served (expire) and
// anything older than 15 minutes is refreshed in the background (revalidate).
export async function getCountryHotspots(iso3, options = {}) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 1800 });
  cacheTag(countryHotspotTag(iso3, options?.date || ""));

  const country = findCountry(iso3);
  if (!country) return null;

  const box = queryBbox(country).join(",");
  const isHistorical = Boolean(options?.date);
  const dayRange = Number(options?.dayRange) || (isHistorical ? 1 : 2);
  const windowStart = isHistorical
    ? Date.parse(`${options.date}T00:00:00Z`)
    : (options?.windowStart ?? Date.now() - 24 * 60 * 60 * 1000);
  const windowEnd = isHistorical
    ? windowStart + dayRange * 24 * 60 * 60 * 1000
    : (options?.windowEnd ?? Date.now());

  const rows = (
    await Promise.all(
      SOURCES.map((source) =>
        fetchDetections(source, box, windowEnd, {
          withAcquired: true,
          date: options?.date,
          dayRange,
          windowStart,
        }),
      ),
    )
  ).flat();

  const inside = rows.filter((row) => isInsideCountry(country, row[0], row[1]));

  const stats = {
    inside: inside.length,
    modis: inside.filter((row) => row[3] === 0).length,
    viirs: inside.filter((row) => row[3] === 1).length,
    maxFrp: Number(Math.max(0, ...inside.map((row) => row[2])).toFixed(1)),
    generatedAt: new Date().toISOString(),
  };

  const points = thinToGrid(inside, 0.0001, INSIDE_LIMIT).map(([lon, lat, frp, sensor, acquired]) => [
    lon,
    lat,
    frp,
    sensor,
    1,
    acquired ?? windowEnd,
  ]);

  return {
    country: { iso3, name: country.name, bbox: country.focusBbox, geometry: country.geometry },
    stats,
    points,
  };
}

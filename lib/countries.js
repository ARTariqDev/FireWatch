import { feature } from "topojson-client";
import isoCountries from "i18n-iso-countries";
import atlas from "world-atlas/countries-50m.json" with { type: "json" };

const countryCache = new Map();

function bboxOf(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

const area = ([w, s, e, n]) => (e - w) * (n - s);

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const epsilon = 1e-12;
    const cross = (lon - xi) * dy - (lat - yi) * dx;
    if (
      Math.abs(cross) <= epsilon * Math.max(1, Math.abs(dx), Math.abs(dy)) &&
      lon >= Math.min(xi, xj) - epsilon && lon <= Math.max(xi, xj) + epsilon &&
      lat >= Math.min(yi, yj) - epsilon && lat <= Math.max(yi, yj) + epsilon
    ) return 0;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

// Resolves an ISO 3166-1 alpha-3 code to its polygons and useful bounding boxes.
export function findCountry(iso3) {
  if (countryCache.has(iso3)) return countryCache.get(iso3);
  const numeric = isoCountries.alpha3ToNumeric(iso3);
  if (!numeric) return null;

  const geometry = atlas.objects.countries.geometries.find(
    (item) => String(item.id).padStart(3, "0") === numeric,
  );
  if (!geometry) return null;
  const match = feature(atlas, geometry);

  const parts =
    match.geometry.type === "Polygon" ? [match.geometry.coordinates] : match.geometry.coordinates;
  const polygons = parts.map((rings) => ({ rings, bbox: bboxOf(rings[0]) }));
  const mainland = polygons.reduce((best, item) => (area(item.bbox) > area(best.bbox) ? item : best));

  const country = { name: match.properties.name, geometry: match.geometry, polygons, focusBbox: mainland.bbox };
  countryCache.set(iso3, country);
  return country;
}

// Box to request from FIRMS: every polygon for compact countries, mainland only for sprawling ones.
export function queryBbox(country) {
  const boxes = country.polygons.map((item) => item.bbox);
  const union = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
  const box = union[2] - union[0] <= 90 && union[3] - union[1] <= 60 ? union : country.focusBbox;
  return [
    Math.max(-180, box[0] - 0.01),
    Math.max(-90, box[1] - 0.01),
    Math.min(180, box[2] + 0.01),
    Math.min(90, box[3] + 0.01),
  ];
}

export function isInsideCountry(country, lon, lat) {
  for (const { rings, bbox } of country.polygons) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    const outer = insideRing(lon, lat, rings[0]);
    if (outer === 0) return true;
    if (outer < 0) continue;
    let inHole = false;
    for (const hole of rings.slice(1)) {
      const location = insideRing(lon, lat, hole);
      if (location === 0) return true;
      if (location > 0) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

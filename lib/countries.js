import { feature } from "topojson-client";
import isoCountries from "i18n-iso-countries";
import atlas from "world-atlas/countries-50m.json";

let cachedFeatures;

function allFeatures() {
  cachedFeatures ??= feature(atlas, atlas.objects.countries).features;
  return cachedFeatures;
}

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
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Resolves an ISO 3166-1 alpha-3 code to its polygons and useful bounding boxes.
export function findCountry(iso3) {
  const numeric = isoCountries.alpha3ToNumeric(iso3);
  if (!numeric) return null;

  const match = allFeatures().find((item) => String(item.id).padStart(3, "0") === numeric);
  if (!match) return null;

  const parts =
    match.geometry.type === "Polygon" ? [match.geometry.coordinates] : match.geometry.coordinates;
  const polygons = parts.map((rings) => ({ rings, bbox: bboxOf(rings[0]) }));
  const mainland = polygons.reduce((best, item) => (area(item.bbox) > area(best.bbox) ? item : best));

  return { name: match.properties.name, polygons, focusBbox: mainland.bbox };
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
    Math.max(-180, box[0] - 0.5),
    Math.max(-90, box[1] - 0.5),
    Math.min(180, box[2] + 0.5),
    Math.min(90, box[3] + 0.5),
  ];
}

export function isInsideCountry(country, lon, lat) {
  for (const { rings, bbox } of country.polygons) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (!insideRing(lon, lat, rings[0])) continue;
    if (!rings.slice(1).some((hole) => insideRing(lon, lat, hole))) return true;
  }
  return false;
}

import { animate } from "animejs";

export const HOTSPOT_SOURCE = "hotspots";
const COUNTRY_SOURCE = "country-boundaries";
const COUNTRY_LAYER = "country_boundaries";
const PULSE_LAYER = "hotspots-pulse";
const PULSE_SHARE = 0.1;
const NO_COUNTRY = ["==", ["get", "iso_3166_1_alpha_3"], ""];
const WORLDVIEW = ["any", ["==", ["get", "worldview"], "all"], ["in", "US", ["get", "worldview"]]];

// Heat ramp: red embers -> orange -> pale-hot cores, driven by fire radiative power (MW).
const FRP_COLOR = [
  "interpolate", ["linear"], ["get", "frp"],
  0, "#d3321d", 15, "#ff6a32", 60, "#ffb347", 200, "#fff1c9",
];
const byFrp = (low, high) => ["interpolate", ["linear"], ["get", "frp"], 0, low, 100, high];
export function toFeatureCollection(points) {
  return {
    type: "FeatureCollection",
    features: points
      .filter((point) => (point[4] ?? 1) === 1)
      .map(([lng, lat, frp, sensor, inside = 1]) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { frp, sensor, in: inside },
      })),
  };
}

// Pulse only the brightest slice of whatever is on screen, so quiet countries still get rings.
function pulseFilter(points) {
  const brightness = points
    .filter((point) => (point[4] ?? 1) === 1)
    .map((point) => point[2])
    .sort((a, b) => a - b);
  const cutoff = brightness.length ? brightness[Math.floor(brightness.length * (1 - PULSE_SHARE))] : 0;
  return ["all", [">=", ["get", "frp"], cutoff], ["==", ["get", "in"], 1]];
}

export function setHotspots(map, points) {
  map.getSource(HOTSPOT_SOURCE)?.setData(toFeatureCollection(points));
  map.setFilter(PULSE_LAYER, pulseFilter(points));
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
  map.addSource(HOTSPOT_SOURCE, { type: "geojson", data: toFeatureCollection([]) });
  map.addLayer({
    id: "hotspots-glow",
    type: "circle",
    source: HOTSPOT_SOURCE,
    paint: {
      "circle-color": FRP_COLOR,
      "circle-blur": 1,
      "circle-opacity": 0.3,
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
    filter: ["==", ["get", "in"], 1],
    paint: {
      "circle-radius": 0,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#ff7a45",
      "circle-stroke-width": 1.2,
      "circle-stroke-opacity": 0,
    },
  });
  map.addLayer({
    id: "hotspots-core",
    type: "circle",
    source: HOTSPOT_SOURCE,
    paint: {
      "circle-color": FRP_COLOR,
      "circle-opacity": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 5, 2.8, 9, 5],
      "circle-stroke-color": "#0b0b0a",
      "circle-stroke-width": 0.5,
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

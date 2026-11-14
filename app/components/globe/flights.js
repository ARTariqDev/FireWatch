import gsap from "gsap";
import {
  NO_PADDING,
  ORBIT_LAT,
  fitPadding,
  orbitLayout,
  paddingToward,
  setInteractive,
  slotCenter,
  syncCamera,
} from "./camera.js";
import { prefersReducedMotion, shortestLng } from "./geo.js";
import { ensureCountryLayers, hideCountry, setHotspots, showCountry } from "./layers.js";
import { PREVIEW_POINTS } from "./previewPoints.js";
import { ensureTerrainSource, TERRAIN_EXAGGERATION } from "./terrain.js";

const PAGE_LOCK_CLASS = "globe-locked";
// Countries wider than this (e.g. ones spanning the antimeridian) are framed around a point instead.
const MAX_FRAMED_SPAN = { lng: 80, lat: 55 };

export const VIEWS = {
  "2d": { pitch: 0, bearing: 0, terrain: 0 },
  "3d": { pitch: 58, bearing: -14, terrain: TERRAIN_EXAGGERATION },
  topo: { pitch: 62, bearing: -20, terrain: 3.5 },
};

const seconds = (value) => (prefersReducedMotion() ? 0.01 : value);

function tween(state, vars, apply) {
  return new Promise((resolve) => {
    gsap.to(state, { ...vars, onUpdate: apply, onComplete: resolve });
  });
}

// Keeps the country clear of the sidebar or bottom drawer.
export function framePadding() {
  const sidebar = document.querySelector(".country-sidebar");
  const open = sidebar?.dataset.open !== "false";
  if (window.innerWidth > 1000) {
    return { top: 100, bottom: 100, left: open ? (sidebar?.offsetWidth ?? 360) + 100 : 80, right: 100 };
  }
  const side = Math.round(window.innerWidth * 0.06);
  return { top: 110, bottom: open ? (sidebar?.offsetHeight ?? 300) + 24 : 70, left: side, right: side };
}

// Zoom is fitted on the flat map, then nudged in for the tilted view, where distance shrinks the country.
const TILT_ZOOM_BOOST = 0.3;

function countryFocus(map, bbox, fallback, view) {
  if (bbox) {
    const [west, south, east, north] = bbox;
    if (east - west <= MAX_FRAMED_SPAN.lng && north - south <= MAX_FRAMED_SPAN.lat) {
      const { width, height } = map.getContainer().getBoundingClientRect();
      const padding = fitPadding(framePadding(), width, height);
      if (!padding) return { lng: fallback.lng, lat: fallback.lat, zoom: 3.4 + (view.pitch ? TILT_ZOOM_BOOST : 0) };
      const framed = map.cameraForBounds(
        [[west, south], [east, north]],
        { padding, maxZoom: 7 },
      );
      if (framed) {
        const center = Array.isArray(framed.center)
          ? framed.center
          : [framed.center.lng, framed.center.lat];
        return { lng: center[0], lat: center[1], zoom: framed.zoom + (view.pitch ? TILT_ZOOM_BOOST : 0) };
      }
    }
  }
  return { lng: fallback.lng, lat: fallback.lat, zoom: 3.4 + (view.pitch ? TILT_ZOOM_BOOST : 0) };
}

// Orbit -> country: swing the country to face us, then plunge in until it fills the screen.
export async function flyToCountry(stage, { iso3, focus, request, bounds }) {
  if (!(await stage.ready) || !["intro", "orbit", "country"].includes(stage.mode)) return false;
  if (stage.mode === "intro") gsap.killTweensOf(stage.camera.state);

  const { map, camera, container, slot } = stage;
  const flight = Symbol("country flight");
  stage.activeFlight = flight;
  const fromCountry = stage.mode === "country";
  stage.mode = "flight";
  stage.viewMode = stage.viewMode || "2d";
  setInteractive(map, false);
  if (fromCountry) {
    syncCamera(map, camera.state);
    stage.highlight?.pause();
    hideCountry(map);
  }
  setHotspots(map, []);
  document.documentElement.classList.add(PAGE_LOCK_CLASS);

  // Terrain is only fetched once the visitor asks for it.
  ensureTerrainSource(map);

  if (!fromCountry) {
    // Promote the canvas to a viewport-sized layer without moving the globe on screen.
    const restingCenter = slotCenter(slot);
    container.classList.add("is-fixed");
    map.resize();
    Object.assign(camera.state, paddingToward(container.getBoundingClientRect(), restingCenter));
    camera.apply();
  }

  const [bbox] = await Promise.all([
    bounds,
    tween(
      camera.state,
      {
        lng: shortestLng(camera.state.lng, focus.lng),
        lat: focus.lat,
        zoom: fromCountry ? Math.min(camera.state.zoom, 3.2) : camera.state.zoom + 0.55,
        ...NO_PADDING,
        duration: seconds(fromCountry ? 0.8 : 0.9),
        ease: "power3.inOut",
      },
      camera.apply,
    ),
  ]);
  if (stage.activeFlight !== flight) return false;

  ensureCountryLayers(map);
  stage.highlight = showCountry(map, iso3);
  request.then((data) => {
    if (stage.activeFlight !== flight || !data) return;
    stage.highlight?.pause();
    ensureCountryLayers(map, data.country);
    stage.highlight = showCountry(map, iso3);
    setHotspots(map, data.points);
  });

  const view = VIEWS[stage.viewMode];
  const target = countryFocus(map, bbox, focus, view);
  await tween(
    camera.state,
    {
      lng: shortestLng(camera.state.lng, target.lng),
      lat: target.lat,
      zoom: target.zoom,
      ...view,
      duration: seconds(1.4),
      ease: "power2.inOut",
    },
    camera.apply,
  );

  if (stage.activeFlight !== flight) return false;
  setInteractive(map, true, true);
  stage.mode = "country";
  return true;
}

// 3D <-> 2D inside the country view: the camera levels out (or tilts back) and the terrain flattens (or rises).
export async function setViewMode(stage, mode) {
  if (stage.mode !== "country" || !VIEWS[mode] || stage.viewMode === mode) return false;

  const { map, camera } = stage;
  stage.mode = "flight";
  stage.viewMode = mode;
  setInteractive(map, false);
  syncCamera(map, camera.state);

  await tween(
    camera.state,
    {
      ...VIEWS[mode],
      bearing: shortestLng(camera.state.bearing, VIEWS[mode].bearing),
      duration: seconds(0.7),
      ease: "power2.inOut",
    },
    camera.apply,
  );

  setInteractive(map, true, mode !== "2d");
  stage.mode = "country";
  return true;
}

// Country -> orbit: level the camera, pull back to the resting globe, then hand the canvas back to the layout.
export async function returnToOrbit(stage) {
  if (stage.mode !== "country") return false;

  const { map, camera, container, slot } = stage;
  stage.mode = "flight";
  stage.activeFlight = null;
  setInteractive(map, false);

  // The visitor may have panned, zoomed or tilted, so start from the live camera.
  syncCamera(map, camera.state);

  stage.highlight?.pause();
  hideCountry(map);
  setHotspots(map, []);

  const layout = orbitLayout(container, slot);
  await tween(
    camera.state,
    {
      ...layout,
      lat: ORBIT_LAT,
      pitch: 0,
      bearing: shortestLng(camera.state.bearing, 0),
      terrain: 0,
      duration: seconds(1.2),
      ease: "power3.inOut",
    },
    camera.apply,
  );

  container.classList.remove("is-fixed");
  map.resize();
  setHotspots(map, PREVIEW_POINTS);
  Object.assign(camera.state, orbitLayout(container, slot));
  camera.apply();

  document.documentElement.classList.remove(PAGE_LOCK_CLASS);
  stage.viewMode = "3d";
  stage.mode = "orbit";
  return true;
}

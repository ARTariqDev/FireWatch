import gsap from "gsap";
import {
  NO_PADDING,
  ORBIT_LAT,
  orbitLayout,
  paddingToward,
  setInteractive,
  slotCenter,
  syncCamera,
} from "./camera";
import { prefersReducedMotion, shortestLng } from "./geo";
import { ensureCountryLayers, hideCountry, setHotspots, showCountry } from "./layers";
import { PREVIEW_POINTS } from "./previewPoints";
import { ensureTerrainSource, TERRAIN_EXAGGERATION } from "./terrain";

const PAGE_LOCK_CLASS = "globe-locked";
// Countries wider than this (e.g. ones spanning the antimeridian) are framed around a point instead.
const MAX_FRAMED_SPAN = { lng: 80, lat: 55 };

export const VIEWS = {
  "3d": { pitch: 58, bearing: -14, terrain: TERRAIN_EXAGGERATION },
  "2d": { pitch: 0, bearing: 0, terrain: 0 },
};

const seconds = (value) => (prefersReducedMotion() ? 0.01 : value);

function tween(state, vars, apply) {
  return new Promise((resolve) => {
    gsap.to(state, { ...vars, onUpdate: apply, onComplete: resolve });
  });
}

// Keeps the country clear of the HUD card: docked left on desktop, above the card on small screens.
function framePadding() {
  if (window.innerWidth > 1000) return { top: 100, bottom: 100, left: 460, right: 100 };

  const side = Math.round(window.innerWidth * 0.06);
  const hud = document.querySelector(".country-hud");
  return { top: 140, bottom: (hud?.offsetHeight ?? 260) + 80, left: side, right: side };
}

// Zoom is fitted on the flat map, then nudged in for the tilted view, where distance shrinks the country.
const TILT_ZOOM_BOOST = 0.3;

function countryFocus(map, bbox, fallback, view) {
  if (bbox) {
    const [west, south, east, north] = bbox;
    if (east - west <= MAX_FRAMED_SPAN.lng && north - south <= MAX_FRAMED_SPAN.lat) {
      const framed = map.cameraForBounds(
        [[west, south], [east, north]],
        { padding: framePadding(), maxZoom: 7 },
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
export async function flyToCountry(stage, { iso3, focus, request }) {
  if (!(await stage.ready) || stage.mode !== "orbit") return false;

  const { map, camera, container, slot } = stage;
  stage.mode = "flight";
  stage.viewMode = "3d";
  document.documentElement.classList.add(PAGE_LOCK_CLASS);

  // Country boundaries and terrain are only fetched once the visitor asks for them.
  ensureCountryLayers(map);
  ensureTerrainSource(map);

  // Promote the canvas to a viewport-sized layer without moving the globe on screen.
  const restingCenter = slotCenter(slot);
  container.classList.add("is-fixed");
  map.resize();
  Object.assign(camera.state, paddingToward(container.getBoundingClientRect(), restingCenter));
  camera.apply();

  await tween(
    camera.state,
    {
      lng: shortestLng(camera.state.lng, focus.lng),
      lat: focus.lat,
      zoom: camera.state.zoom + 0.55,
      ...NO_PADDING,
      duration: seconds(2.4),
      ease: "power3.inOut",
    },
    camera.apply,
  );

  // The illustrative preview is always replaced; if the live feed failed the country is shown empty, never fake.
  const data = await request;
  stage.highlight = showCountry(map, iso3);
  setHotspots(map, data?.points ?? []);

  const view = VIEWS[stage.viewMode];
  const target = countryFocus(map, data?.country?.bbox, focus, view);
  await tween(
    camera.state,
    {
      lng: shortestLng(camera.state.lng, target.lng),
      lat: target.lat,
      zoom: target.zoom,
      ...view,
      duration: seconds(3.4),
      ease: "power2.inOut",
    },
    camera.apply,
  );

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
      duration: seconds(1.4),
      ease: "power2.inOut",
    },
    camera.apply,
  );

  setInteractive(map, true, mode === "3d");
  stage.mode = "country";
  return true;
}

// Country -> orbit: level the camera, pull back to the resting globe, then hand the canvas back to the layout.
export async function returnToOrbit(stage) {
  if (stage.mode !== "country") return false;

  const { map, camera, container, slot } = stage;
  stage.mode = "flight";
  setInteractive(map, false);

  // The visitor may have panned, zoomed or tilted, so start from the live camera.
  syncCamera(map, camera.state);

  stage.highlight?.pause();
  hideCountry(map);
  setHotspots(map, PREVIEW_POINTS);

  const layout = orbitLayout(container, slot);
  await tween(
    camera.state,
    {
      ...layout,
      lat: ORBIT_LAT,
      pitch: 0,
      bearing: shortestLng(camera.state.bearing, 0),
      terrain: 0,
      duration: seconds(2.8),
      ease: "power3.inOut",
    },
    camera.apply,
  );

  container.classList.remove("is-fixed");
  map.resize();
  Object.assign(camera.state, orbitLayout(container, slot));
  camera.apply();

  document.documentElement.classList.remove(PAGE_LOCK_CLASS);
  stage.viewMode = "3d";
  stage.mode = "orbit";
  return true;
}

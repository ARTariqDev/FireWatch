import gsap from "gsap";
import { NO_PADDING, ORBIT_LAT, orbitLayout, paddingToward, setInteractive, slotCenter } from "./camera";
import { prefersReducedMotion, shortestLng } from "./geo";
import { hideCountry, setHotspots, showCountry } from "./layers";

const PAGE_LOCK_CLASS = "globe-locked";
// Countries wider than this (e.g. ones spanning the antimeridian) are framed around a point instead.
const MAX_FRAMED_SPAN = { lng: 80, lat: 55 };

// Keeps the country clear of the HUD card: docked left on desktop, along the bottom on small screens.
function framePadding() {
  const base = { top: 100, bottom: 100, left: 100, right: 100 };
  return window.innerWidth > 1000 ? { ...base, left: 460 } : { ...base, bottom: 330 };
}

const seconds = (value) => (prefersReducedMotion() ? 0.01 : value);

function tween(state, vars, apply) {
  return new Promise((resolve) => {
    gsap.to(state, { ...vars, onUpdate: apply, onComplete: resolve });
  });
}

function countryFocus(map, bbox, fallback) {
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
        return { lng: center[0], lat: center[1], zoom: framed.zoom };
      }
    }
  }
  return { lng: fallback.lng, lat: fallback.lat, zoom: 3.4 };
}

// Orbit -> country: swing the country to face us, then plunge in until it fills the screen.
export async function flyToCountry(stage, { iso3, focus, request }) {
  if (!(await stage.ready) || stage.mode !== "orbit") return false;

  const { map, camera, container, slot } = stage;
  stage.mode = "flight";
  document.documentElement.classList.add(PAGE_LOCK_CLASS);

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

  const data = await request;
  stage.highlight = showCountry(map, iso3);
  if (data?.points) setHotspots(map, data.points);

  const target = countryFocus(map, data?.country?.bbox, focus);
  await tween(
    camera.state,
    {
      lng: shortestLng(camera.state.lng, target.lng),
      lat: target.lat,
      zoom: target.zoom,
      duration: seconds(3.4),
      ease: "power2.inOut",
    },
    camera.apply,
  );

  setInteractive(map, true);
  stage.mode = "country";
  return true;
}

// Country -> orbit: pull back to the resting globe, then hand the canvas back to the layout.
export async function returnToOrbit(stage) {
  if (stage.mode !== "country") return false;

  const { map, camera, container, slot } = stage;
  stage.mode = "flight";
  setInteractive(map, false);

  // The visitor may have panned or zoomed, so start from the live camera.
  const center = map.getCenter();
  Object.assign(camera.state, { lng: center.lng, lat: center.lat, zoom: map.getZoom(), ...NO_PADDING });

  stage.highlight?.pause();
  hideCountry(map);
  setHotspots(map, stage.worldPoints);

  const layout = orbitLayout(container, slot);
  await tween(
    camera.state,
    { ...layout, lat: ORBIT_LAT, duration: seconds(2.8), ease: "power3.inOut" },
    camera.apply,
  );

  container.classList.remove("is-fixed");
  map.resize();
  Object.assign(camera.state, orbitLayout(container, slot));
  camera.apply();

  document.documentElement.classList.remove(PAGE_LOCK_CLASS);
  stage.mode = "orbit";
  return true;
}

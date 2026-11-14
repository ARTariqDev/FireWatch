import "mapbox-gl/dist/mapbox-gl.css";
import gsap from "gsap";
import { ORBIT_LAT, createCamera, orbitLayout, setInteractive } from "./camera";
import { MAPBOX_TOKEN, prefersReducedMotion } from "./geo";
import { addHotspotLayers, ensureCountryLayers, setHotspots, showCountry, startPulse } from "./layers";
import { MAP_STYLE, monitorMapErrors } from "./mapErrors";
import { PREVIEW_POINTS } from "./previewPoints";
import { flyToCountry, returnToOrbit, setViewMode } from "./flights";

const START_LNG = 62;
const SPIN_DEGREES_PER_MS = 0.005;
const FOG = {
  color: "rgb(22, 13, 10)",
  "high-color": "rgb(138, 44, 18)",
  "horizon-blend": 0.05,
  "space-color": "rgb(11, 11, 10)",
  "star-intensity": 0,
};

// Builds the Mapbox globe and returns a small controller. Modes: boot -> intro -> orbit <-> flight/country.
export function createGlobe({ mapboxgl, container, slot, onFeed }) {
  // Phones and tablets get cheaper rendering: no antialiasing and ~30 fps for the idle animation.
  const compact = window.matchMedia("(max-width: 1000px), (pointer: coarse)").matches;
  const minFrameMs = compact ? 33 : 0;

  const map = new mapboxgl.Map({
    container,
    accessToken: MAPBOX_TOKEN,
    style: MAP_STYLE,
    projection: "globe",
    center: [START_LNG, ORBIT_LAT],
    zoom: 0.5,
    maxZoom: 9,
    maxPitch: 72,
    antialias: !compact,
    fadeDuration: 0,
  });
  setInteractive(map, false);

  const camera = createCamera(map);
  let visible = true;
  let markReady;
  const stage = {
    map,
    camera,
    container,
    slot,
    mode: "boot",
    viewMode: "3d",
    pulse: null,
    highlight: null,
    activeFlight: null,
    ready: new Promise((resolve) => (markReady = resolve)),
  };

  // Idle spin: skipped when the tab or the hero is off screen, and capped on compact devices.
  let pending = 0;
  const spin = (_time, delta) => {
    if (stage.mode !== "orbit" || document.hidden || !visible) return;
    pending += delta;
    if (pending < minFrameMs) return;
    camera.state.lng -= pending * SPIN_DEGREES_PER_MS;
    pending = 0;
    if (camera.state.lng < -180) camera.state.lng += 360;
    camera.apply();
  };

  const relayout = () => {
    if (stage.mode !== "orbit") return;
    map.resize();
    Object.assign(camera.state, orbitLayout(container, slot));
    camera.apply();
  };

  // The globe spins in from a distance and decelerates into its resting spot.
  function startIntro() {
    const layout = orbitLayout(container, slot);
    Object.assign(camera.state, { ...layout, lng: START_LNG + 150, lat: ORBIT_LAT, zoom: layout.zoom - 1.6 });
    camera.apply();
    container.classList.add("is-ready");
    stage.mode = "intro";

    gsap.to(camera.state, {
      lng: START_LNG,
      zoom: layout.zoom,
      duration: prefersReducedMotion() ? 0.01 : 3.4,
      ease: "power4.out",
      onUpdate: camera.apply,
      onComplete: () => {
        stage.mode = "orbit";
      },
    });
    markReady(true);
  }

  map.on("load", () => {
    if (stage.mode !== "boot") return;
    map.setFog(FOG);
    addHotspotLayers(map);
    setHotspots(map, PREVIEW_POINTS);
    stage.pulse = startPulse(map, minFrameMs || 40);
    startIntro();
  });

  const stopMonitoringErrors = monitorMapErrors(map, {
    isBooting: () => stage.mode === "boot",
    onFatal: () => {
      stage.mode = "error";
      onFeed({ status: "map-error" });
      markReady(false);
    },
  });

  if (!prefersReducedMotion()) gsap.ticker.add(spin);
  window.addEventListener("resize", relayout);
  const resizeObserver = new ResizeObserver(relayout);
  resizeObserver.observe(slot);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!stage.pulse) return;
    if (visible) stage.pulse.play();
    else stage.pulse.pause();
  });
  visibilityObserver.observe(container);

  return {
    fly: (options) => flyToCountry(stage, options),
    back: () => returnToOrbit(stage),
    setView: (mode) => setViewMode(stage, mode),
    updateHotspots(points, country) {
      if (stage.mode !== "country" && !(stage.mode === "flight" && stage.activeFlight)) return;
      if (country?.geometry) {
        stage.highlight?.pause();
        if (ensureCountryLayers(map, country)) stage.highlight = showCountry(map, country.iso3);
      }
      setHotspots(map, points);
    },
    destroy() {
      stage.activeFlight = null;
      markReady(false);
      gsap.ticker.remove(spin);
      gsap.killTweensOf(camera.state);
      window.removeEventListener("resize", relayout);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      stopMonitoringErrors();
      stage.pulse?.pause();
      stage.highlight?.pause();
      document.documentElement.classList.remove("globe-locked");
      map.remove();
    },
  };
}

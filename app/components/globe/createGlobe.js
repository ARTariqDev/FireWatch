import gsap from "gsap";
import { ORBIT_LAT, createCamera, orbitLayout, setInteractive } from "./camera";
import { MAPBOX_TOKEN, fetchWorldHotspots, prefersReducedMotion } from "./geo";
import { addCountryLayers, addHotspotLayers, setHotspots, startPulse } from "./layers";
import { flyToCountry, returnToOrbit } from "./flights";

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
  const map = new mapboxgl.Map({
    container,
    accessToken: MAPBOX_TOKEN,
    style: "mapbox://styles/mapbox/dark-v11",
    projection: "globe",
    center: [START_LNG, ORBIT_LAT],
    zoom: 0.5,
    maxZoom: 9,
    antialias: true,
    fadeDuration: 0,
  });
  setInteractive(map, false);

  const camera = createCamera(map);
  let disposed = false;
  let markReady;
  const stage = {
    map,
    camera,
    container,
    slot,
    mode: "boot",
    worldPoints: [],
    pulse: null,
    highlight: null,
    ready: new Promise((resolve) => (markReady = resolve)),
  };

  const spin = (_time, delta) => {
    if (stage.mode !== "orbit" || document.hidden) return;
    camera.state.lng -= delta * SPIN_DEGREES_PER_MS;
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
        markReady(true);
      },
    });
  }

  async function loadWorld() {
    try {
      const data = await fetchWorldHotspots();
      if (disposed) return;
      stage.worldPoints = data.points;
      if (stage.mode === "intro" || stage.mode === "orbit") setHotspots(map, data.points);
      onFeed({ status: "ready", total: data.total, shown: data.points.length });
    } catch {
      if (!disposed) onFeed({ status: "error" });
    }
  }

  map.on("load", () => {
    map.setFog(FOG);
    addCountryLayers(map);
    addHotspotLayers(map);
    stage.pulse = startPulse(map);
    startIntro();
    loadWorld();
  });

  map.on("error", (event) => {
    console.error("Mapbox error:", event.error?.message ?? event.error);
    if (stage.mode === "boot" && [401, 403, 404].includes(event.error?.status)) {
      onFeed({ status: "map-error" });
      markReady(false);
    }
  });

  if (!prefersReducedMotion()) gsap.ticker.add(spin);
  window.addEventListener("resize", relayout);
  const observer = new ResizeObserver(relayout);
  observer.observe(slot);

  return {
    fly: (options) => flyToCountry(stage, options),
    back: () => returnToOrbit(stage),
    destroy() {
      disposed = true;
      markReady(false);
      gsap.ticker.remove(spin);
      gsap.killTweensOf(camera.state);
      window.removeEventListener("resize", relayout);
      observer.disconnect();
      stage.pulse?.pause();
      stage.highlight?.pause();
      document.documentElement.classList.remove("globe-locked");
      map.remove();
    },
  };
}

import { applyTerrain } from "./terrain.js";

const TILE_SIZE = 512;
export const ORBIT_LAT = 16;

// Measured: Mapbox's rendered globe is ~14% wider than the worldSize / π geometry predicts.
const RENDERED_GLOBE_RATIO = 1.14;

const clampPad = (value) => Math.max(0, Math.round(value));

// Globe diameter in px -> Mapbox zoom (globe radius is worldSize / 2π).
export const zoomForDiameter = (diameter) =>
  Math.log2((diameter * Math.PI) / (TILE_SIZE * RENDERED_GLOBE_RATIO));

// Padding that shifts the map's visual centre onto `target` (viewport px) within `rect`.
export function paddingToward(rect, target) {
  const dx = 2 * (target.x - rect.left) - rect.width;
  const dy = 2 * (target.y - rect.top) - rect.height;
  return { padL: clampPad(dx), padR: clampPad(-dx), padT: clampPad(dy), padB: clampPad(-dy) };
}

export function slotCenter(slot) {
  const rect = slot.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Where the globe rests in orbit: centred in the layout slot and sized to fit it.
export function orbitLayout(container, slot) {
  const slotRect = slot.getBoundingClientRect();
  const diameter = Math.min(slotRect.width, slotRect.height) * 0.96;
  return {
    ...paddingToward(container.getBoundingClientRect(), slotCenter(slot)),
    zoom: zoomForDiameter(diameter),
  };
}

export const NO_PADDING = { padL: 0, padR: 0, padT: 0, padB: 0 };

// Preserve a usable area even when the HUD occupies most of a small viewport.
export function fitPadding(padding, width, height) {
  if (width <= 0 || height <= 0) return null;
  const scaleFor = (total, size) => {
    const available = size - Math.min(120, size / 2);
    return total > available ? available / total : 1;
  };
  const horizontal = scaleFor(padding.left + padding.right, width);
  const vertical = scaleFor(padding.top + padding.bottom, height);
  return {
    left: padding.left * horizontal,
    right: padding.right * horizontal,
    top: padding.top * vertical,
    bottom: padding.bottom * vertical,
  };
}

// A plain object GSAP can tween; `apply` pushes it to the map. Terrain is quantised so it updates in steps.
export function createCamera(map) {
  const state = {
    lng: 0,
    lat: ORBIT_LAT,
    zoom: 1,
    pitch: 0,
    bearing: 0,
    terrain: 0,
    ...NO_PADDING,
  };
  let appliedTerrain = 0;

  const apply = () => {
    const terrain = Math.round(state.terrain * 20) / 20;
    if (terrain !== appliedTerrain) {
      appliedTerrain = terrain;
      applyTerrain(map, terrain);
    }
    map.jumpTo({
      center: [state.lng, state.lat],
      zoom: state.zoom,
      pitch: state.pitch,
      bearing: state.bearing,
      padding: { left: state.padL, right: state.padR, top: state.padT, bottom: state.padB },
    });
  };
  return { state, apply };
}

// Copies the live camera into the tweenable state, e.g. after the visitor has panned.
export function syncCamera(map, state) {
  const center = map.getCenter();
  Object.assign(state, {
    lng: center.lng,
    lat: center.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    ...NO_PADDING,
  });
}

// Tilt and rotation are only offered in the 3D view; the 2D view stays locked north-up.
export function setInteractive(map, enabled, tilt = false) {
  const handlers = [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard];
  handlers.forEach((handler) => (enabled ? handler.enable() : handler.disable()));

  if (enabled && tilt) {
    map.dragRotate.enable();
    map.touchPitch.enable();
    map.touchZoomRotate.enableRotation();
  } else {
    map.dragRotate.disable();
    map.touchPitch.disable();
    map.touchZoomRotate.disableRotation();
  }
}

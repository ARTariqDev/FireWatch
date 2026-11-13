const TILE_SIZE = 512;
export const ORBIT_LAT = 16;

const clampPad = (value) => Math.max(0, Math.round(value));

// Measured: Mapbox's rendered globe is ~14% wider than the worldSize / π geometry predicts.
const RENDERED_GLOBE_RATIO = 1.14;

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

// A plain object GSAP can tween; `apply` pushes it to the map.
export function createCamera(map) {
  const state = { lng: 0, lat: ORBIT_LAT, zoom: 1, ...NO_PADDING };
  const apply = () =>
    map.jumpTo({
      center: [state.lng, state.lat],
      zoom: state.zoom,
      padding: { left: state.padL, right: state.padR, top: state.padT, bottom: state.padB },
    });
  return { state, apply };
}

export function setInteractive(map, enabled) {
  const handlers = [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard];
  handlers.forEach((handler) => (enabled ? handler.enable() : handler.disable()));
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
}

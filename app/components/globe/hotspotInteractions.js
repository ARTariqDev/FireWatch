const INTERACTIVE_LAYERS = [
  "tracked-fires-center",
  "tracked-fires-ring",
  "fire-predicted-footprint-line",
  "fire-current-footprint-fill",
  "hotspots-core",
  "hotspots-glow",
];

const HIT_RADIUS_PX = 14;

function extractFireId(feature) {
  const props = feature?.properties;
  if (!props) return null;
  const candidate = props.fire_final ?? props.event_id ?? feature?.id;
  if (candidate === undefined || candidate === null || candidate === "") return null;
  return candidate;
}

function buildHitPayload(feature, event) {
  const coords =
    feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  const props = feature?.properties || {};
  const lng = Number(coords?.[0] ?? props.center_lon ?? event?.lngLat?.lng);
  const lat = Number(coords?.[1] ?? props.center_lat ?? event?.lngLat?.lat);

  return {
    fireId: extractFireId(feature),
    lng: Number.isFinite(lng) ? lng : null,
    lat: Number.isFinite(lat) ? lat : null,
    x: event?.point?.x ?? null,
    y: event?.point?.y ?? null,
    properties: props,
  };
}

function queryInteractiveFeature(map, event, layers) {
  const pt = event?.point;
  if (!pt) return null;
  const bbox = [
    [pt.x - HIT_RADIUS_PX, pt.y - HIT_RADIUS_PX],
    [pt.x + HIT_RADIUS_PX, pt.y + HIT_RADIUS_PX],
  ];
  const features = map.queryRenderedFeatures?.(bbox, { layers }) || [];
  if (!features.length) return null;
  return features.find((f) => extractFireId(f) !== null) || features[0];
}

export function bindHotspotInteractions(map, { onSelectFire, onHoverFire } = {}) {
  if (!map || typeof map.on !== "function") return () => {};

  const existingLayers = () => INTERACTIVE_LAYERS.filter((id) => Boolean(map.getLayer?.(id)));

  const onClick = (event) => {
    const layers = existingLayers();
    if (!layers.length) return;
    const hit = queryInteractiveFeature(map, event, layers);
    if (!hit) return;
    onSelectFire?.(buildHitPayload(hit, event));
  };

  const onMouseMove = (event) => {
    const layers = existingLayers();
    const canvas = map.getCanvas?.();
    if (!canvas || !layers.length) return;
    const hit = queryInteractiveFeature(map, event, layers);
    if (hit) {
      canvas.style.cursor = "pointer";
      onHoverFire?.(buildHitPayload(hit, event));
    } else {
      canvas.style.cursor = "";
      onHoverFire?.(null);
    }
  };

  const onMouseLeave = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = "";
    onHoverFire?.(null);
  };

  map.on("click", onClick);
  map.on("mousemove", onMouseMove);
  map.on("mouseleave", onMouseLeave);

  return () => {
    map.off?.("click", onClick);
    map.off?.("mousemove", onMouseMove);
    map.off?.("mouseleave", onMouseLeave);
  };
}

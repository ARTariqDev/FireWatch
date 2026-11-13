const DEM_SOURCE = "mapbox-dem";
const RELIEF_LAYER = "relief";

export const TERRAIN_EXAGGERATION = 2;

export function ensureTerrainSource(map) {
  if (map.getSource(DEM_SOURCE)) return;
  map.addSource(DEM_SOURCE, {
    type: "raster-dem",
    url: "mapbox://mapbox.mapbox-terrain-dem-v1",
    tileSize: 512,
    maxzoom: 14,
  });
}

// The dark base style has no relief shading, so a faint hillshade makes the terrain readable.
function ensureReliefLayer(map) {
  if (map.getLayer(RELIEF_LAYER)) return;
  const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: RELIEF_LAYER,
      type: "hillshade",
      source: DEM_SOURCE,
      paint: {
        "hillshade-exaggeration": 0,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#4a3328",
        "hillshade-accent-color": "#1b1310",
        "hillshade-illumination-anchor": "viewport",
      },
    },
    labelLayer,
  );
}

// An amount of 0 removes terrain and relief entirely so the flat views cost nothing extra.
export function applyTerrain(map, amount) {
  if (amount <= 0) {
    if (map.getTerrain()) map.setTerrain(null);
    if (map.getLayer(RELIEF_LAYER)) map.setLayoutProperty(RELIEF_LAYER, "visibility", "none");
    return;
  }
  ensureTerrainSource(map);
  ensureReliefLayer(map);
  map.setTerrain({ source: DEM_SOURCE, exaggeration: amount });
  map.setLayoutProperty(RELIEF_LAYER, "visibility", "visible");
  map.setPaintProperty(RELIEF_LAYER, "hillshade-exaggeration", Math.min(0.6, amount * 0.3));
}

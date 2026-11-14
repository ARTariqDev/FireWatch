// Small status chip under the resting globe. The landing globe shows sample signals only, and says so.
function GlobeReadout({ status }) {
  const copy = {
    preview: [
      "ILLUSTRATIVE PREVIEW",
      "Sample signals only. Choose View Hotspots to load live MODIS + VIIRS detections for your region.",
    ],
    "map-error": ["MAP UNAVAILABLE", "The map couldn't load. Check your connection or Mapbox token, then reload."],
    "no-token": ["MAP UNAVAILABLE", "Add NEXT_PUBLIC_MAPBOX_TOKEN to enable the globe."],
  }[status] ?? [];

  return (
    <div className="globe-readout" data-status={status} role="status">
      <span className="readout-label">
        <i aria-hidden="true" />
        {copy[0]}
      </span>
      <span className="readout-detail">{copy[1]}</span>
    </div>
  );
}

export default GlobeReadout;

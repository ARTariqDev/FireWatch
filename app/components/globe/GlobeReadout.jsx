const formatCount = (value) => value.toLocaleString("en-US");

// Small status chip under the resting globe: live, syncing, or the reason it's unavailable.
function GlobeReadout({ feed }) {
  const { status } = feed;

  const copy = {
    loading: ["SYNCING SATELLITE FEED", "Waiting for the latest MODIS + VIIRS passes…"],
    ready: [
      "LIVE · LAST 24 H",
      `${formatCount(feed.total ?? 0)} detections · ${formatCount(feed.shown ?? 0)} brightest clusters shown`,
    ],
    error: ["FEED OFFLINE", "Satellite detections are unavailable right now. The globe is still live."],
    "map-error": ["MAP UNAVAILABLE", "The map couldn't load. Check the Mapbox token and try again."],
    "no-token": ["MAP UNAVAILABLE", "Add NEXT_PUBLIC_MAPBOX_TOKEN to enable the globe."],
  }[status];

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

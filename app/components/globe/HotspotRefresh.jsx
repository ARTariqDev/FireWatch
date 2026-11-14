import "./hud.css";
import { useHotspotPolling } from "./useHotspotPolling";

function HotspotRefresh({ iso3, enabled, switching, onData, onError, onRefreshStart }) {
  const { refresh, refreshing, refreshError } = useHotspotPolling({ iso3, enabled, onData, onError });
  const onRefresh = () => {
    onRefreshStart();
    refresh(true);
  };

  return (
    <div className="hotspot-refresh">
      <button
        type="button"
        onClick={onRefresh}
        disabled={!enabled || switching || refreshing}
        aria-label={refreshing ? "Refreshing hotspots" : "Refresh hotspots"}
      >
        <span className="refresh-icon" aria-hidden="true">↻</span>{" "}
        {refreshing ? "Refreshing…" : <>Refresh<span className="refresh-extra"> hotspots</span></>}
      </button>
      <span className="hotspot-refresh-status" role="status">
        {refreshError ? "Refresh failed. Try again." : ""}
      </span>
    </div>
  );
}

export default HotspotRefresh;

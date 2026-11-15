"use client";

import { useMemo } from "react";

const RATING_CLASS = {
  Low: "hazard-low",
  Moderate: "hazard-moderate",
  High: "hazard-high",
  "Very High": "hazard-very-high",
  Extreme: "hazard-extreme",
};

const getRatingClass = (rating) => RATING_CLASS[rating] || "hazard-unknown";

const pct = (val) =>
  typeof val === "number" && Number.isFinite(val) ? `${(val * 100).toFixed(1)}%` : "—";

const num = (val, digits = 2) =>
  typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";

function model3EnvelopeByFireType(fireType) {
  const t = String(fireType || "").toLowerCase();
  if (t === "crop") return { p10: 1.13, median: 1.27, p90: 1.69 };
  if (t === "forest" || t === "shrub_grass" || t === "wildland") {
    return { p10: 1.13, median: 1.55, p90: 2.81 };
  }
  return { p10: 1.13, median: 1.41, p90: 2.44 };
}

export default function OnMapFireHud({
  activeTab = "combined",
  sortedEvents = [],
  selectedFireEvent = null,
  isLoadingModels = false,
  hoveredHit = null,
  fireListScope = "recent",
  onChangeFireListScope,
  recentCount = 0,
  pastCount = 0,
  onSelectFire,
  onFocusFire,
  onClearFire,
}) {
  const hoveredEvent = useMemo(() => {
    if (!hoveredHit) return null;
    if (hoveredHit.fireId !== null && hoveredHit.fireId !== undefined) {
      const exact = sortedEvents.find(
        (ev) => String(ev.fire?.fire_final) === String(hoveredHit.fireId),
      );
      if (exact) return exact;
    }
    if (Number.isFinite(hoveredHit.lng) && Number.isFinite(hoveredHit.lat)) {
      let best = null;
      let bestDistSq = 0.015 * 0.015;
      for (const ev of sortedEvents) {
        const dLon = Number(ev.fire?.lon) - hoveredHit.lng;
        const dLat = Number(ev.fire?.lat) - hoveredHit.lat;
        const distSq = dLon * dLon + dLat * dLat;
        if (distSq <= bestDistSq) {
          bestDistSq = distSq;
          best = ev;
        }
      }
      return best;
    }
    return null;
  }, [hoveredHit, sortedEvents]);

  const currentIdx = useMemo(() => {
    if (!selectedFireEvent?.fire) return -1;
    return sortedEvents.findIndex(
      (ev) => String(ev.fire?.fire_final) === String(selectedFireEvent.fire.fire_final),
    );
  }, [sortedEvents, selectedFireEvent]);

  const handleStep = (delta) => {
    if (!sortedEvents.length) return;
    const base = currentIdx >= 0 ? currentIdx : 0;
    const nextIdx = (base + delta + sortedEvents.length) % sortedEvents.length;
    const target = sortedEvents[nextIdx];
    if (target?.fire) {
      onSelectFire?.(target.fire.fire_final);
    }
  };

  const tooltipStyle = useMemo(() => {
    if (!hoveredHit || typeof hoveredHit.x !== "number" || typeof hoveredHit.y !== "number") {
      return null;
    }
    const maxW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
    const left = Math.min(maxW - 260, Math.max(16, hoveredHit.x + 16));
    const top = Math.min(maxH - 130, Math.max(88, hoveredHit.y - 16));
    return { left: `${left}px`, top: `${top}px` };
  }, [hoveredHit]);

  const f = selectedFireEvent?.fire || null;
  const hazard = selectedFireEvent?.hazard || null;
  const prediction = selectedFireEvent?.prediction || null;
  const hindcast = selectedFireEvent?.hindcast || null;
  const isPastFire = Boolean(selectedFireEvent?.is_past);
  const showActualVsPredicted =
    isPastFire ||
    (Boolean(hindcast?.isMultiPass) &&
      Number(hindcast?.actualFinalAreaKm2) > Number(hindcast?.initialAreaKm2));

  const currentArea = f
    ? Math.max(Number(prediction?.current_area_km2 ?? f.area_km2) || 0.18, 0.14)
    : 0;
  const m3 = model3EnvelopeByFireType(f?.fire_type);
  const hasExpansionArea = Number(prediction?.predicted_total_area_km2) > currentArea + 0.05;
  const projectedArea = f
    ? hasExpansionArea
      ? Number(prediction.predicted_total_area_km2)
      : Number((currentArea + m3.median).toFixed(2))
    : 0;
  const outerBoundArea = f
    ? Number((currentArea + (prediction?.additional_area_p90_km2 ?? m3.p90)).toFixed(2))
    : 0;
  const initialArea = f
    ? Math.max(
        Number(hindcast?.initialAreaKm2 ?? prediction?.current_area_km2 ?? f.area_km2) || 0.18,
        0.14
      )
    : 0;
  const actualArea = f
    ? Math.max(Number(hindcast?.actualFinalAreaKm2 ?? f.area_km2) || initialArea, initialArea)
    : 0;
  const predictedArea = f
    ? prediction?.predicted_total_area_km2 != null
      ? Number(prediction.predicted_total_area_km2)
      : projectedArea
    : 0;

  return (
    <>
      {hoveredHit && tooltipStyle && (
        <div className="map-hover-tooltip" style={tooltipStyle} role="status" aria-live="off">
          <div className="map-tooltip-head">
            <span className="map-tooltip-id">
              {hoveredEvent?.fire
                ? `FIRE #${hoveredEvent.fire.fire_final}`
                : hoveredHit.fireId !== null && hoveredHit.fireId !== undefined
                  ? `FIRE #${hoveredHit.fireId}`
                  : "THERMAL SIGNAL"}
            </span>
            {(hoveredEvent?.hazard?.hazard_rating || hoveredHit.properties?.hazard_rating) && (
              <span
                className={`hazard-pill ${getRatingClass(
                  hoveredEvent?.hazard?.hazard_rating || hoveredHit.properties?.hazard_rating,
                )}`}
              >
                {hoveredEvent?.hazard?.hazard_rating || hoveredHit.properties?.hazard_rating}
                {hoveredEvent?.hazard?.hazard_score != null ||
                hoveredHit.properties?.hazard_score != null
                  ? ` · ${hoveredEvent?.hazard?.hazard_score ?? hoveredHit.properties?.hazard_score}/100`
                  : ""}
              </span>
            )}
          </div>
          <div className="map-tooltip-meta">
            <span>
              Area{" "}
              {num(
                hoveredEvent?.fire?.area_km2 ?? hoveredHit.properties?.area_km2 ?? 0.18,
                2,
              )}{" "}
              km²
            </span>
            <span>·</span>
            <span>
              FRP{" "}
              {num(
                hoveredEvent?.fire?.frp_sum ?? hoveredHit.properties?.frp ?? 0,
                1,
              )}{" "}
              MW
            </span>
            {hoveredEvent?.fire?.province &&
              hoveredEvent.fire.province !== "outside_pakistan" && (
                <>
                  <span>·</span>
                  <span>{hoveredEvent.fire.province}</span>
                </>
              )}
          </div>
          <span className="map-tooltip-hint">Click to zoom &amp; inspect spread on map</span>
        </div>
      )}

      <div className="on-map-fire-hud" aria-label="On-map fire spread and hazard controls">
        {!f ? (
          <div className="map-quickpick-bar">
            {onChangeFireListScope && (recentCount > 0 || pastCount > 0) && (
              <div className="map-scope-switch" role="group" aria-label="Fire age scope">
                <button
                  type="button"
                  className={`map-scope-btn ${fireListScope === "recent" ? "is-active" : ""}`}
                  onClick={() => onChangeFireListScope("recent")}
                >
                  RECENT ({recentCount})
                </button>
                <button
                  type="button"
                  className={`map-scope-btn ${fireListScope === "past" ? "is-active" : ""}`}
                  onClick={() => onChangeFireListScope("past")}
                >
                  PAST 14D ({pastCount})
                </button>
              </div>
            )}
            <div className="map-quickpick-prompt">
              <span className="map-quickpick-dot" aria-hidden="true" />
              <span>
                {sortedEvents.length > 0
                  ? fireListScope === "past"
                    ? "Pick a past fire to compare Actual vs. Predicted spread"
                    : "Click any hotspot on the map to see its spread & hazard"
                  : fireListScope === "past"
                    ? "No past tracked fires in this filter window"
                    : "No ≤12h tracked fires in this feed"}
              </span>
            </div>
            {sortedEvents.length > 0 && (
              <div className="map-quickpick-list">
                {sortedEvents.slice(0, 3).map((ev) => {
                  const fire = ev.fire;
                  const haz = ev.hazard;
                  return (
                    <button
                      key={fire.fire_final}
                      type="button"
                      className="map-quickpick-btn"
                      onClick={() => onSelectFire?.(fire.fire_final)}
                    >
                      <span className="map-quickpick-id">#{fire.fire_final}</span>
                      {haz?.hazard_rating ? (
                        <span className={`hazard-pill ${getRatingClass(haz.hazard_rating)}`}>
                          {haz.hazard_rating} {haz.hazard_score}
                        </span>
                      ) : (
                        <span className="map-quickpick-frp">{num(fire.frp_sum, 1)} MW</span>
                      )}
                      <span className="map-quickpick-area">{num(fire.area_km2, 2)} km²</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="map-spread-card">
            <div className="map-spread-head">
              <div>
                <span className="map-spread-eyebrow">
                  {isPastFire ? "PAST FIRE · ACTUAL VS. PREDICTED SPREAD" : "ON-MAP SPREAD & HAZARD"}
                </span>
                <h3 className="map-spread-title">
                  Fire #{f.fire_final} ·{" "}
                  {f.province && f.province !== "outside_pakistan"
                    ? f.province
                    : `${num(f.lat, 2)}°, ${num(f.lon, 2)}°`}{" "}
                  · {String(f.fire_type || "other").replace("_", "/")}
                </h3>
              </div>

              {hazard?.hazard_rating ? (
                <span className={`hazard-pill map-hazard-badge ${getRatingClass(hazard.hazard_rating)}`}>
                  {hazard.hazard_score}/100 · {hazard.hazard_rating.toUpperCase()}
                </span>
              ) : isLoadingModels ? (
                <span className="hazard-pill hazard-unknown map-hazard-badge">SCORING…</span>
              ) : (
                <span className="hazard-pill hazard-unknown map-hazard-badge">
                  {activeTab === "modis" ? "MODIS ONLY" : "NO VIIRS SCORE"}
                </span>
              )}
            </div>

            {hazard ? (
              <div className="map-pillars-wrap">
                <div className="map-pillars-grid">
                  <div className="map-pillar-mini">
                    <div className="map-pillar-row">
                      <span>Behaviour</span>
                      <strong>{pct(hazard.hazard_pillar_fire_behaviour)}</strong>
                    </div>
                    <div className="pillar-bar">
                      <span
                        style={{
                          width: `${Math.min(100, (hazard.hazard_pillar_fire_behaviour || 0) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="map-pillar-mini">
                    <div className="map-pillar-row">
                      <span>Terrain/Fuel</span>
                      <strong>{pct(hazard.hazard_pillar_terrain_fuel)}</strong>
                    </div>
                    <div className="pillar-bar">
                      <span
                        style={{
                          width: `${Math.min(100, (hazard.hazard_pillar_terrain_fuel || 0) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="map-pillar-mini">
                    <div className="map-pillar-row">
                      <span>Weather</span>
                      <strong>{pct(hazard.hazard_pillar_weather)}</strong>
                    </div>
                    <div className="pillar-bar">
                      <span
                        style={{
                          width: `${Math.min(100, (hazard.hazard_pillar_weather || 0) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                {hazard.hazard_top_factors && (
                  <p className="map-top-drivers">Top drivers: {hazard.hazard_top_factors}</p>
                )}
              </div>
            ) : (
              <p className="map-top-drivers">
                {isLoadingModels
                  ? "Fetching Python backend hazard rating & spread predictions…"
                  : activeTab === "modis"
                    ? "Switch to VIIRS · ML or select a VIIRS-backed fire for calibrated hazard scores."
                    : "Calibrated hazard score unavailable for this event location."}
              </p>
            )}

            <div className="map-spread-metrics">
              {showActualVsPredicted ? (
                <>
                  <div className="map-metric-cell map-metric-actual">
                    <span>ACTUAL SPREAD</span>
                    <strong>{num(actualArea, 2)} km²</strong>
                  </div>
                  <div className="map-metric-cell map-metric-pred">
                    <span>MODEL PREDICTED</span>
                    <strong>
                      {prediction ? `${num(predictedArea, 2)} km²` : isLoadingModels ? "Scoring…" : "—"}
                    </strong>
                  </div>
                  <div className="map-metric-cell">
                    <span>INITIAL PASS (T0)</span>
                    <strong>{num(initialArea, 2)} km²</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="map-metric-cell">
                    <span>CURRENT SPREAD</span>
                    <strong>{num(currentArea, 2)} km²</strong>
                  </div>
                  <div className="map-metric-cell">
                    <span>{hasExpansionArea ? "PREDICTED TOTAL" : "MODEL-3 ENVELOPE"}</span>
                    <strong>{num(projectedArea, 2)} km²</strong>
                  </div>
                  <div className="map-metric-cell">
                    <span>90% SPREAD BOUND</span>
                    <strong>{num(outerBoundArea, 2)} km²</strong>
                  </div>
                </>
              )}
              <div className="map-metric-cell">
                <span>PERSIST (12–24H)</span>
                <strong>{pct(prediction?.persistence_probability)}</strong>
              </div>
              <div className="map-metric-cell">
                <span>EXPANSION PROB</span>
                <strong>{pct(prediction?.expansion_probability)}</strong>
              </div>
              <div className="map-metric-cell">
                <span>OBSERVATIONS</span>
                <strong>
                  {f.n_det} det · {f.n_passes}p · {num(f.frp_sum, 1)} MW
                </strong>
              </div>
            </div>

            {selectedFireEvent?.context && (
              <div className="map-context-pill" title="14-day harmonized MODIS-equivalent regional baseline">
                <span>14d Baseline</span>
                <strong>
                  {selectedFireEvent.context.anomalyRatio != null
                    ? `${num(selectedFireEvent.context.anomalyRatio, 2)}× median`
                    : "n/a"}
                  {selectedFireEvent.context.percentile != null
                    ? ` · P${Math.round(selectedFireEvent.context.percentile)}`
                    : ""}
                  {selectedFireEvent.context.modisEquivalent != null
                    ? ` · ${num(selectedFireEvent.context.modisEquivalent, 1)} MODIS-eq`
                    : ""}
                </strong>
              </div>
            )}

            <div className="map-ring-key" aria-label="Map spread ring legend">
              <span>
                <i className="ring-swatch ring-current" />{" "}
                {showActualVsPredicted ? "Initial Pass (t0)" : "Current Spread"}
              </span>
              {showActualVsPredicted && (
                <span>
                  <i className="ring-swatch ring-actual" /> Actual Spread
                </span>
              )}
              <span>
                <i
                  className={`ring-swatch ${
                    prediction?.prediction_status === "expansion_likely"
                      ? "ring-predicted-exp"
                      : "ring-predicted"
                  }`}
                />{" "}
                {showActualVsPredicted ? "Predicted Spread" : "12–24h Spread"}
              </span>
              <span>
                <i className="ring-swatch ring-outer" /> 90% Bound
              </span>
              <span>
                <i className="ring-swatch ring-trail" /> Pass Trail
              </span>
            </div>

            <div className="map-spread-actions">
              <button
                type="button"
                className="map-action-btn"
                onClick={() => handleStep(-1)}
                disabled={sortedEvents.length <= 1}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="map-action-btn"
                onClick={() => handleStep(1)}
                disabled={sortedEvents.length <= 1}
              >
                Next →
              </button>
              <button
                type="button"
                className="map-action-btn map-action-focus"
                onClick={() =>
                  onFocusFire?.({ lng: f.lon, lat: f.lat, areaKm2: f.area_km2 })
                }
              >
                ⊕ Zoom to Spread
              </button>
              <button
                type="button"
                className="map-action-btn map-action-clear"
                onClick={() => onClearFire?.()}
              >
                × Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

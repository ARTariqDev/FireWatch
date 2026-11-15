"use client";

import { useMemo } from "react";

const RATING_CLASS = {
  Low: "hazard-low",
  Moderate: "hazard-moderate",
  High: "hazard-high",
  "Very High": "hazard-very-high",
  Extreme: "hazard-extreme",
};

const LAND_COVER_META = [
  { key: "lc_forest", label: "Forest", color: "#2e7d32" },
  { key: "lc_shrub_grass", label: "Shrub/Grass", color: "#8bc34a" },
  { key: "lc_crop", label: "Crop", color: "#fbc02d" },
  { key: "lc_urban", label: "Urban", color: "#90a4ae" },
  { key: "lc_bare_other", label: "Bare", color: "#8d6e63" },
  { key: "lc_water", label: "Water", color: "#29b6f6" },
];

const pct = (val) =>
  typeof val === "number" && Number.isFinite(val) ? `${(val * 100).toFixed(1)}%` : "—";

const num = (val, digits = 2) =>
  typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";

function formatShortUtc(iso) {
  if (!iso || typeof iso !== "string") return "—";
  return iso.replace("T", " ").replace(/:00(\.\d+)?Z$/, "Z").slice(0, 16) + (iso.endsWith("Z") ? "" : "Z");
}

function getRatingClass(rating) {
  return RATING_CLASS[rating] || "hazard-unknown";
}

function formatPredictionStatus(status) {
  if (status === "expansion_likely") return "EXPANSION LIKELY";
  if (status === "expansion_unlikely") return "EXPANSION UNLIKELY";
  if (status === "low_confidence") return "LOW CONFIDENCE";
  return status ? String(status).toUpperCase() : "UNAVAILABLE";
}

export default function FireInspectorPanel({
  iso3,
  activeTab,
  tabData,
  sortedEvents: passedSortedEvents,
  onDemandCache = {},
  selectedFireId,
  onSelectFire,
  onFocusFire,
  generatedAt,
}) {
  const fireEvents = useMemo(() => tabData?.fire_events || [], [tabData?.fire_events]);
  const modelSummary = tabData?.modelSummary || null;
  const metadata = tabData?.metadata || {};

  const sortedEvents = useMemo(() => {
    if (Array.isArray(passedSortedEvents) && passedSortedEvents.length) {
      return passedSortedEvents;
    }
    return [...fireEvents].sort((a, b) => {
      const expA = a.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      const expB = b.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      if (expB !== expA) return expB - expA;
      const hazA = a.hazard?.hazard_score ?? -1;
      const hazB = b.hazard?.hazard_score ?? -1;
      if (hazB !== hazA) return hazB - hazA;
      return Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0);
    });
  }, [passedSortedEvents, fireEvents]);

  const activeFireEvent = useMemo(() => {
    if (!sortedEvents.length) return null;
    if (selectedFireId !== null && selectedFireId !== undefined) {
      return (
        sortedEvents.find(
          (e) => String(e.fire?.fire_final) === String(selectedFireId),
        ) || null
      );
    }
    return null;
  }, [sortedEvents, selectedFireId]);

  const activeFireId = activeFireEvent?.fire?.fire_final;
  const cacheKey = `${iso3 || ""}:${generatedAt || ""}:${activeTab}:${activeFireId ?? ""}`;
  const cachedModels = onDemandCache[cacheKey];
  const resolvedHazard = activeFireEvent?.hazard || cachedModels?.hazard || null;
  const resolvedPrediction = activeFireEvent?.prediction || cachedModels?.prediction || null;
  const hasViirsSupport = Boolean(
    activeFireEvent?.fire &&
      (activeTab === "viirs" ||
        (activeTab === "combined" &&
          (activeFireEvent.fire.satellites || []).some((s) =>
            String(s).toUpperCase().includes("VIIRS"),
          ))),
  );
  const isLoadingHazard =
    Boolean(activeFireEvent?.fire) &&
    hasViirsSupport &&
    !activeFireEvent.hazard &&
    !cachedModels?.fetched;

  const handleSelectAndFocus = (event) => {
    const f = event?.fire;
    if (!f) return;
    onSelectFire?.(f.fire_final);
  };

  const f = activeFireEvent?.fire || null;
  const lcTotal = f
    ? LAND_COVER_META.reduce((sum, item) => sum + (Number(f[item.key]) || 0), 0)
    : 0;
  const topFire = sortedEvents[0] || null;
  const showModelSections = Boolean(
    activeTab === "viirs" || hasViirsSupport || resolvedHazard || resolvedPrediction,
  );

  return (
    <div className="tracker-models-panel">
      <div className="tracker-workflow-banner">
        <div className="tracker-banner-row">
          <span className="tracker-banner-badge">14D TRACKER → ≤12H RECENT FIRES</span>
          <span className="tracker-banner-counts">
            {metadata.n_fires_14d ?? fireEvents.length} tracked (14d) · {fireEvents.length} recent (≤12h)
          </span>
        </div>
        {iso3 !== "PAK" && activeTab === "viirs" && (
          <p className="tracker-region-warning">
            Note: Models &amp; hazard cutoffs are tailored specifically for Pakistan (2019–2025).
            Detections outside Pakistan carry low confidence.
          </p>
        )}
      </div>

      {activeTab === "viirs" && modelSummary && (
        <div className="model-overview-section">
          <div className="model-section-header">
            <span className="model-section-title">VIIRS HAZARD &amp; ML PREDICTIONS</span>
            <span className="model-version-tag">v{modelSummary.modelVersion || "2.0.0"} · 12–24H</span>
          </div>

          <div className="model-overview-grid">
            <div className="model-kpi-card">
              <span className="model-kpi-label">PEAK HAZARD</span>
              <span className="model-kpi-value">
                {modelSummary.hazardEvaluatedCount > 0 ? `${modelSummary.maxHazardScore}/100` : "—"}
              </span>
              {modelSummary.maxHazardRating && (
                <span className={`hazard-pill ${getRatingClass(modelSummary.maxHazardRating)}`}>
                  {modelSummary.maxHazardRating}
                </span>
              )}
            </div>

            <div className="model-kpi-card">
              <span className="model-kpi-label">EXPANSION ALERTS</span>
              <span className="model-kpi-value">{modelSummary.expandingCount}</span>
              <span className="model-kpi-sub">P ≥ 8.45% threshold</span>
            </div>

            <div className="model-kpi-card">
              <span className="model-kpi-label">MAX PERSISTENCE</span>
              <span className="model-kpi-value">
                {modelSummary.predictedCount > 0 ? pct(modelSummary.maxPersistenceProb) : "—"}
              </span>
              <span className="model-kpi-sub">
                Avg {pct(modelSummary.avgPersistenceProb)}
              </span>
            </div>

            <div className="model-kpi-card">
              <span className="model-kpi-label">EST. EXTRA AREA</span>
              <span className="model-kpi-value">
                +{num(modelSummary.totalProjectedAddAreaKm2, 2)} km²
              </span>
              <span className="model-kpi-sub">{modelSummary.predictedCount} fires scored</span>
            </div>
          </div>

          <div className="footprint-legend" aria-label="Prediction Footprint Legend">
            <span className="fp-legend-item">
              <i className="fp-swatch fp-current" /> Current
            </span>
            <span className="fp-legend-item">
              <i className="fp-swatch fp-predicted" /> Predicted 12–24h
            </span>
            <span className="fp-legend-item">
              <i className="fp-swatch fp-growth" /> Growth Zone
            </span>
            <span className="fp-legend-item">
              <i className="fp-swatch fp-outer" /> 90% Bound
            </span>
          </div>
        </div>
      )}

      <div className="tracked-fires-section">
        <div className="model-section-header">
          <span className="model-section-title">RECENT TRACKED FIRES (≤12H)</span>
          <span className="model-count-tag">{sortedEvents.length} EVENTS</span>
        </div>

        {sortedEvents.length === 0 ? (
          <p className="hud-note">No tracked fires detected within the last 12 hours for this feed.</p>
        ) : (
          <ul className="tracked-fire-list" role="listbox" aria-label="Recent tracked fires">
            {sortedEvents.map((event) => {
              const fire = event.fire;
              const isSelected = String(fire.fire_final) === String(activeFireId);
              const haz = event.hazard;
              const pred = event.prediction;
              return (
                <li key={fire.fire_final}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`tracked-fire-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => handleSelectAndFocus(event)}
                  >
                    <div className="tracked-fire-top">
                      <span className="tracked-fire-id">FIRE #{fire.fire_final}</span>
                      <span className="tracked-fire-loc">
                        {fire.province && fire.province !== "outside_pakistan"
                          ? fire.province
                          : `${num(fire.lat, 2)}°, ${num(fire.lon, 2)}°`}{" "}
                        · {String(fire.fire_type || "other").replace("_", "/")}
                      </span>
                      {haz && (
                        <span className={`hazard-pill ${getRatingClass(haz.hazard_rating)}`}>
                          {haz.hazard_rating} ({haz.hazard_score})
                        </span>
                      )}
                    </div>
                    <div className="tracked-fire-meta">
                      <span>{num(fire.area_km2, 2)} km²</span>
                      <span>·</span>
                      <span>{num(fire.frp_sum, 1)} MW</span>
                      <span>·</span>
                      <span>{fire.n_det} det / {fire.n_passes}p</span>
                      {pred && (
                        <span
                          className={`pred-chip ${
                            pred.prediction_status === "expansion_likely"
                              ? "pred-expanding"
                              : "pred-stable"
                          }`}
                        >
                          {pred.prediction_status === "expansion_likely"
                            ? "EXPANDING"
                            : `PERSIST ${pct(pred.persistence_probability)}`}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!f && topFire && (
        <div className="fire-pick-prompt">
          <p className="inspector-note">
            Click any fire above or click any hotspot on the map to zoom to its spread rings and
            display hazard scores directly on the map.
          </p>
          <button
            type="button"
            className="inspector-focus-btn fire-pick-cta"
            onClick={() => handleSelectAndFocus(topFire)}
          >
            ⊕ Inspect Top Fire (#{topFire.fire.fire_final}) on Map
          </button>
        </div>
      )}

      {f && (
        <div className="fire-inspector-card" aria-label="Selected Fire Inspector">
          <div className="inspector-header">
            <div>
              <span className="inspector-eyebrow">SELECTED FIRE EVENT</span>
              <h3 className="inspector-title">
                Fire #{f.fire_final} · {f.province || "Unknown"}
              </h3>
            </div>
            <button
              type="button"
              className="inspector-focus-btn"
              onClick={() =>
                onFocusFire?.({ lng: f.lon, lat: f.lat, areaKm2: f.area_km2 })
              }
              title="Zoom map to this fire spread"
            >
              ⊕ FOCUS
            </button>
          </div>

          <div className="inspector-kv-grid">
            <div className="inspector-kv">
              <span>TYPE</span>
              <strong>{String(f.fire_type || "other").replace("_", " ")}</strong>
            </div>
            <div className="inspector-kv">
              <span>DETECTED AREA</span>
              <strong>{num(f.area_km2, 2)} km²</strong>
            </div>
            <div className="inspector-kv">
              <span>TOTAL FRP</span>
              <strong>{num(f.frp_sum, 1)} MW</strong>
            </div>
            <div className="inspector-kv">
              <span>DURATION</span>
              <strong>{num(f.duration_h, 0)} h ({f.n_passes}p)</strong>
            </div>
            <div className="inspector-kv">
              <span>FIRST SEEN</span>
              <strong>{formatShortUtc(f.first_detection_utc)}</strong>
            </div>
            <div className="inspector-kv">
              <span>LAST SEEN</span>
              <strong>{formatShortUtc(f.last_detection_utc)}</strong>
            </div>
          </div>

          <div className="inspector-sat-row">
            <span>SATELLITES: {(f.satellites || []).join(", ") || "—"}</span>
            {f.merges_in > 0 && <span>MERGES: {f.merges_in}</span>}
          </div>

          {lcTotal > 0 && (
            <div className="land-cover-wrap">
              <span className="inspector-sublabel">LAND COVER MIX</span>
              <div className="land-cover-bar" role="img" aria-label="Land cover breakdown">
                {LAND_COVER_META.map((item) => {
                  const val = Number(f[item.key]) || 0;
                  if (val <= 0) return null;
                  return (
                    <span
                      key={item.key}
                      style={{ width: `${(val / lcTotal) * 100}%`, background: item.color }}
                      title={`${item.label}: ${val.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className="land-cover-legend">
                {LAND_COVER_META.map((item) => {
                  const val = Number(f[item.key]) || 0;
                  if (val < 1) return null;
                  return (
                    <span key={item.key}>
                      <i style={{ background: item.color }} /> {item.label} {Math.round(val)}%
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {showModelSections && (
            <>
              <div className="inspector-subsection">
                <div className="inspector-subhead">
                  <span className="inspector-sublabel">HAZARD RATING (0–100 RELATIVE INDEX)</span>
                  {resolvedHazard && (
                    <span className={`hazard-pill ${getRatingClass(resolvedHazard.hazard_rating)}`}>
                      {resolvedHazard.hazard_rating} · {resolvedHazard.hazard_score}/100
                    </span>
                  )}
                </div>

                {isLoadingHazard ? (
                  <p className="inspector-loading">Calculating hazard rating from backend…</p>
                ) : resolvedHazard ? (
                  <div className="hazard-details">
                    <div className="pillar-row">
                      <div className="pillar-label">
                        <span>Fire Behaviour (52%)</span>
                        <strong>{pct(resolvedHazard.hazard_pillar_fire_behaviour)}</strong>
                      </div>
                      <div className="pillar-bar">
                        <span
                          style={{
                            width: `${Math.min(100, (resolvedHazard.hazard_pillar_fire_behaviour || 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="pillar-factors">
                        FRP {num(resolvedHazard.hf_frp_mw_value, 1)} MW · Area{" "}
                        {num(resolvedHazard.hf_area_km2_value, 2)} km² · Dur{" "}
                        {num(resolvedHazard.hf_duration_h_value, 0)} h
                      </span>
                    </div>

                    <div className="pillar-row">
                      <div className="pillar-label">
                        <span>Terrain &amp; Fuel (33%)</span>
                        <strong>{pct(resolvedHazard.hazard_pillar_terrain_fuel)}</strong>
                      </div>
                      <div className="pillar-bar">
                        <span
                          style={{
                            width: `${Math.min(100, (resolvedHazard.hazard_pillar_terrain_fuel || 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="pillar-factors">
                        Slope {num(resolvedHazard.hf_slope_deg_value, 1)}° · Veg{" "}
                        {num(resolvedHazard.hf_vegetation_pct_value, 1)}% · Fuel{" "}
                        {num(resolvedHazard.hf_fuel_type_value, 2)}
                      </span>
                    </div>

                    <div className="pillar-row">
                      <div className="pillar-label">
                        <span>Weather (15%)</span>
                        <strong>{pct(resolvedHazard.hazard_pillar_weather)}</strong>
                      </div>
                      <div className="pillar-bar">
                        <span
                          style={{
                            width: `${Math.min(100, (resolvedHazard.hazard_pillar_weather || 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="pillar-factors">
                        {num(resolvedHazard.hf_temperature_c_value, 1)}°C · Wind{" "}
                        {num(resolvedHazard.hf_wind_kmh_value, 1)} km/h · RH{" "}
                        {num(resolvedHazard.hf_humidity_pct_value, 0)}% · Soil{" "}
                        {num(resolvedHazard.hf_soil_moisture_value, 2)}
                      </span>
                    </div>

                    <div className="hazard-meta-note">
                      <span>Top drivers: {resolvedHazard.hazard_top_factors || "—"}</span>
                      <span>
                        Env date: {resolvedHazard.environment_date || "—"} · Quality:{" "}
                        {resolvedHazard.data_quality || "ok"}
                        {resolvedHazard.weather_age_days > 0
                          ? ` (${resolvedHazard.weather_age_days}d weather lag)`
                          : ""}
                      </span>
                      {resolvedHazard.hazard_missing_factors && (
                        <span>Missing: {resolvedHazard.hazard_missing_factors}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="inspector-note">Hazard evaluation unavailable for this event.</p>
                )}
              </div>

              <div className="inspector-subsection">
                <div className="inspector-subhead">
                  <span className="inspector-sublabel">ML PREDICTION MODELS (12–24H)</span>
                  {resolvedPrediction && (
                    <span
                      className={`pred-chip ${
                        resolvedPrediction.prediction_status === "expansion_likely"
                          ? "pred-expanding"
                          : resolvedPrediction.prediction_status === "low_confidence"
                            ? "pred-low"
                            : "pred-stable"
                      }`}
                    >
                      {formatPredictionStatus(resolvedPrediction.prediction_status)}
                    </span>
                  )}
                </div>

                {resolvedPrediction ? (
                  <div className="ml-models-box">
                    <div className="ml-prob-row">
                      <div className="pillar-label">
                        <span>Model 1 · Persistence Probability</span>
                        <strong>{pct(resolvedPrediction.persistence_probability)}</strong>
                      </div>
                      <div className="pillar-bar">
                        <span
                          className="bar-persist"
                          style={{
                            width: `${Math.min(100, (resolvedPrediction.persistence_probability || 0) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="ml-prob-row">
                      <div className="pillar-label">
                        <span>Model 2 · Expansion (≥1 km² &amp; ≥25%)</span>
                        <strong>{pct(resolvedPrediction.expansion_probability)}</strong>
                      </div>
                      <div className="pillar-bar">
                        <span
                          className="bar-expand"
                          style={{
                            width: `${Math.min(100, (resolvedPrediction.expansion_probability || 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="pillar-factors">
                        Alert threshold: {pct(resolvedPrediction.expansion_threshold ?? 0.0845)} ·
                        Confidence: {resolvedPrediction.confidence || "NORMAL"}
                      </span>
                    </div>

                    <div className="ml-area-grid">
                      <div className="inspector-kv">
                        <span>MODEL 3 · ADD AREA</span>
                        <strong>+{num(resolvedPrediction.predicted_additional_area_km2, 2)} km²</strong>
                      </div>
                      <div className="inspector-kv">
                        <span>PROJECTED TOTAL</span>
                        <strong>{num(resolvedPrediction.predicted_total_area_km2, 2)} km²</strong>
                      </div>
                      <div className="inspector-kv">
                        <span>CURRENT FOOTPRINT</span>
                        <strong>{num(resolvedPrediction.current_area_km2, 2)} km²</strong>
                      </div>
                      <div className="inspector-kv">
                        <span>10%–90% RANGE</span>
                        <strong>
                          {resolvedPrediction.additional_area_p10_km2 != null &&
                          resolvedPrediction.additional_area_p90_km2 != null
                            ? `${num(resolvedPrediction.additional_area_p10_km2, 2)}–${num(resolvedPrediction.additional_area_p90_km2, 2)} km²`
                            : "N/A (unlikely)"}
                        </strong>
                      </div>
                    </div>

                    <div className="hazard-meta-note">
                      <span>
                        Quality: {resolvedPrediction.data_quality || "ok"}
                        {resolvedPrediction.imputed_features
                          ? ` · Imputed: ${resolvedPrediction.imputed_features}`
                          : ""}
                      </span>
                      <span>
                        Horizon: {resolvedPrediction.horizon || "12-24h"} · Model{" "}
                        {resolvedPrediction.model_version || "2.0.0"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="inspector-note">
                    {modelSummary?.predictionReasonCode === "OUT_OF_REGION"
                      ? "Outside Pakistan coverage area — predictions not generated."
                      : "Prediction data unavailable for this event."}
                  </p>
                )}
              </div>
            </>
          )}

          <details className="model-limitations-box">
            <summary>Model &amp; Hazard Limitations</summary>
            <ul>
              <li>Calibrated specifically for Pakistan (2019–2025 VIIRS NOAA-20 + Suomi-NPP).</li>
              <li>Weather inputs (~50 km grid) come from NASA POWER and may lag recent days.</li>
              <li>Expansion is rare (~0.4% base rate); footprints show isotropic area, not wind direction.</li>
              <li>Hazard score (0–100) is a relative physical index, not human/property exposure risk.</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

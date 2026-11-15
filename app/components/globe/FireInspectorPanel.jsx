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

const CIVIDIS_STOPS = [
  "#131f3b",
  "#233e6c",
  "#4c566d",
  "#7a7b78",
  "#af9e56",
  "#fee838",
];

function cividisColor(value, maxVal) {
  if (!maxVal || value <= 0) return "#181512";
  const ratio = Math.min(1, Math.max(0, value / maxVal));
  const idx = Math.min(
    CIVIDIS_STOPS.length - 1,
    Math.max(0, Math.round(ratio * (CIVIDIS_STOPS.length - 1))),
  );
  return CIVIDIS_STOPS[idx];
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerCsvDownload(filename, content) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function FireInspectorPanel({
  iso3,
  activeTab,
  tabData,
  harmonization = null,
  rawPoints = [],
  sortedEvents: passedSortedEvents,
  fireListScope = "recent",
  onChangeFireListScope,
  selectedDay = null,
  onSelectDay,
  isHistoricalWindow = false,
  onDemandCache = {},
  selectedFireId,
  onSelectFire,
  onFocusFire,
  generatedAt,
}) {
  const fireEvents = useMemo(() => tabData?.fire_events || [], [tabData?.fire_events]);
  const pastEvents = useMemo(() => tabData?.past_fire_events || [], [tabData?.past_fire_events]);
  const modelSummary = tabData?.modelSummary || null;
  const metadata = tabData?.metadata || {};

  const sortedEvents = useMemo(() => {
    if (Array.isArray(passedSortedEvents)) {
      return passedSortedEvents;
    }
    const baseList = fireListScope === "past" ? pastEvents : fireEvents;
    return [...baseList].sort((a, b) => {
      const expA = a.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      const expB = b.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      if (expB !== expA) return expB - expA;
      const hazA = a.hazard?.hazard_score ?? -1;
      const hazB = b.hazard?.hazard_score ?? -1;
      if (hazB !== hazA) return hazB - hazA;
      return Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0);
    });
  }, [passedSortedEvents, fireEvents, pastEvents, fireListScope]);

  const activeFireEvent = useMemo(() => {
    if (selectedFireId === null || selectedFireId === undefined) return null;
    return (
      sortedEvents.find((e) => String(e.fire?.fire_final) === String(selectedFireId)) ||
      fireEvents.find((e) => String(e.fire?.fire_final) === String(selectedFireId)) ||
      pastEvents.find((e) => String(e.fire?.fire_final) === String(selectedFireId)) ||
      null
    );
  }, [sortedEvents, fireEvents, pastEvents, selectedFireId]);

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
  const harmSummary = harmonization?.summary || null;
  const harmValidation = harmonization?.validation || null;
  const harmDaily = useMemo(() => harmonization?.dailySeries || [], [harmonization?.dailySeries]);
  const maxDailyModisEq = useMemo(
    () => Math.max(0, ...harmDaily.map((d) => Number(d.modisEquivalent) || 0)),
    [harmDaily],
  );
  const eventContext = activeFireEvent?.context || harmonization?.context || null;

  const handleExportHotspotsCsv = () => {
    const headerNote = [
      `# Methods Note: Layer B Event Fusion (1.0 km geodesic, +/-4-5.5h drift-adaptive coincidence gate)`,
      `# Region: ${iso3 || "UNKNOWN"} | Tab: ${activeTab} | Generated: ${generatedAt || new Date().toISOString()}`,
      `# Filters: MODIS >= 30%, VIIRS nominal+high | Window: <=12h display from 14d tracker`,
      harmSummary
        ? `# Baseline: Median ${harmSummary.median14d} MODIS-eq cell-days (14d) | Unit: ${harmSummary.unit}`
        : `# Baseline: N/A`,
    ];
    const columns = "longitude,latitude,frp_mw,sensor,satellite,confidence,acq_datetime_utc,tier,fire_final";
    const rows = (rawPoints || []).map((pt) => {
      const tierLabel =
        pt[6] === 1
          ? "Tier 4 (Inactive)"
          : pt[8] === 1
            ? "Tier 1 (Dual)"
            : pt[8] === 2
              ? "Tier 2 (VIIRS Solo)"
              : "Tier 3 (MODIS Solo)";
      const isoTime = Number.isFinite(pt[5]) ? new Date(pt[5]).toISOString() : "";
      return [
        csvCell(pt[0]),
        csvCell(pt[1]),
        csvCell(pt[2]),
        csvCell(pt[3] === 0 ? "MODIS" : "VIIRS"),
        csvCell(pt[10] ?? ""),
        csvCell(pt[9] ?? ""),
        csvCell(isoTime),
        csvCell(tierLabel),
        csvCell(pt[12] ?? ""),
      ].join(",");
    });
    triggerCsvDownload(
      `firewatch-${(iso3 || "region").toLowerCase()}-hotspots-${activeTab}.csv`,
      [...headerNote, columns, ...rows].join("\n"),
    );
  };

  const handleExportSeriesCsv = () => {
    if (!harmDaily.length) return;
    const headerNote = [
      `# Methods Note: Layer A Statistical Harmonization (1 km ~0.009 deg hotspot-cell-day binning)`,
      `# Region: ${iso3 || "UNKNOWN"} | Reference Unit: ${harmSummary?.unit || "MODIS-equivalent cell-days"}`,
      `# Consistency Filter: MODIS >= 30%, VIIRS nominal+high | Afternoon ~13:30 share: ${Math.round((harmSummary?.filterStats?.afternoonShare ?? 0) * 100)}%`,
      `# Validation (LOO-CV): Method=${harmValidation?.method || "N/A"}, MAE=${harmValidation?.mae ?? "N/A"}, RMSE=${harmValidation?.rmse ?? "N/A"}, Bias=${harmValidation?.bias ?? "N/A"}, Quality=${harmValidation?.qualityFlag || "N/A"}`,
      `# Baseline (14d): Median=${harmSummary?.median14d ?? 0}, IQR=${harmSummary?.iqr14d ?? 0}`,
    ];
    const columns =
      "date_utc,observed_modis_cell_days,raw_viirs_cell_days,calibrated_viirs,modis_equivalent,pi90_lower,pi90_upper,source,frp_sum_mw,afternoon_share,drift_detected";
    const rows = harmDaily.map((d) =>
      [
        csvCell(d.date),
        csvCell(d.modisCellDays),
        csvCell(d.viirsCellDays),
        csvCell(d.calibratedViirs),
        csvCell(d.modisEquivalent),
        csvCell(d.interval?.[0] ?? 0),
        csvCell(d.interval?.[1] ?? 0),
        csvCell(d.source),
        csvCell(d.totalFrpSum ?? 0),
        csvCell(d.afternoonShare ?? ""),
        csvCell(d.driftDetected ? "true" : "false"),
      ].join(","),
    );
    triggerCsvDownload(
      `firewatch-${(iso3 || "region").toLowerCase()}-harmonized-14d.csv`,
      [...headerNote, columns, ...rows].join("\n"),
    );
  };

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

      {(activeTab === "combined" || activeTab === "viirs") && harmSummary && (
        <div className="harm-baseline-section" aria-label="Statistical Harmonization and 14-Day Baseline">
          <div className="model-section-header">
            <span className="model-section-title">HARMONIZED 14D BASELINE (LAYER A)</span>
            <span className="model-version-tag">
              MODIS-EQ · {String(harmValidation?.qualityFlag || "low").toUpperCase()}
            </span>
          </div>

          <div className="harm-headline-grid">
            <div className="harm-kpi">
              <span>TODAY (MODIS-EQ)</span>
              <strong>
                {num(harmSummary.latestModisEquivalent, 1)}{" "}
                <small>
                  [{num(harmSummary.latestInterval?.[0], 1)}–{num(harmSummary.latestInterval?.[1], 1)}]
                </small>
              </strong>
              <em>1 km cell-days · 90% PI</em>
            </div>
            <div className="harm-kpi">
              <span>VS 14D MEDIAN ({num(harmSummary.median14d, 1)})</span>
              <strong>
                {harmSummary.anomalyRatio !== null
                  ? `${num(harmSummary.anomalyRatio, 2)}×`
                  : harmSummary.latestModisEquivalent > 0
                    ? "ABOVE 0 MED"
                    : "1.00×"}{" "}
                <small>P{harmSummary.percentile}</small>
              </strong>
              <em>
                {harmSummary.anomalyDelta >= 0 ? "+" : ""}
                {num(harmSummary.anomalyDelta, 1)} cell-days · IQR {num(harmSummary.iqr14d, 1)}
              </em>
            </div>
          </div>

          {harmDaily.length > 0 && (
            <div className="harm-strip-wrap">
              <div className="harm-strip-head">
                <span>14-DAY ACTIVITY CALENDAR (CLICK DAY TO FILTER)</span>
                {selectedDay ? (
                  <button
                    type="button"
                    className="harm-day-clear-btn"
                    onClick={() => onSelectDay?.(null)}
                  >
                    {selectedDay.slice(5)} ×
                  </button>
                ) : (
                  <span>
                    {harmDaily[0]?.date?.slice(5)} → {harmDaily[harmDaily.length - 1]?.date?.slice(5)}
                  </span>
                )}
              </div>
              <div className="harm-strip" role="group" aria-label="14-day MODIS-equivalent activity calendar">
                {harmDaily.map((day) => {
                  const isUncertain =
                    day.source === "calibrated_viirs" || harmValidation?.qualityFlag === "low_sparse";
                  const isDaySelected = selectedDay === day.date;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`harm-cell ${isUncertain ? "is-uncertain" : ""} ${isDaySelected ? "is-day-selected" : ""}`}
                      style={{ backgroundColor: cividisColor(day.modisEquivalent, maxDailyModisEq) }}
                      onClick={() => onSelectDay?.(day.date)}
                      aria-pressed={isDaySelected}
                      title={`${day.date} (click to filter) · MODIS-eq ${day.modisEquivalent} [90% PI ${day.interval?.[0]}–${day.interval?.[1]}] | Obs MODIS ${day.modisCellDays} | Raw VIIRS ${day.viirsCellDays} (${day.source})`}
                    />
                  );
                })}
              </div>
              <div className="harm-strip-foot">
                <span>Low (0)</span>
                <span className="cividis-bar" aria-hidden="true" />
                <span>Peak ({num(maxDailyModisEq, 1)})</span>
              </div>
            </div>
          )}

          <div className="harm-meta-row">
            <span>
              Transfer: ×{harmValidation?.transferRatio ?? "—"} ({harmValidation?.method || "prior"}) ·
              LOO MAE {harmValidation?.mae ?? "—"} / Bias {harmValidation?.bias ?? "—"}
            </span>
            <span>
              ~13:30 pass: {Math.round((harmSummary.filterStats?.afternoonShare ?? 0) * 100)}% ·{" "}
              {harmSummary.filterStats?.driftDetected
                ? "Orbital drift (±5.5h gate)"
                : "Nominal timing (±4h)"}
            </span>
          </div>

          <div className="harm-export-row">
            <button
              type="button"
              className="harm-export-btn"
              onClick={handleExportHotspotsCsv}
              disabled={!rawPoints?.length}
            >
              ↓ Hotspots CSV
            </button>
            <button
              type="button"
              className="harm-export-btn"
              onClick={handleExportSeriesCsv}
              disabled={!harmDaily.length}
            >
              ↓ 14d Series CSV
            </button>
          </div>
        </div>
      )}

      <div className="tracked-fires-section">
        <div className="fire-scope-switch" role="tablist" aria-label="Fire event list timeframe">
          <button
            type="button"
            role="tab"
            aria-selected={fireListScope === "recent"}
            className={`fire-scope-btn ${fireListScope === "recent" ? "is-active" : ""}`}
            onClick={() => onChangeFireListScope?.("recent")}
          >
            RECENT (≤12H) · {fireEvents.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={fireListScope === "past"}
            className={`fire-scope-btn ${fireListScope === "past" ? "is-active" : ""}`}
            onClick={() => onChangeFireListScope?.("past")}
          >
            PAST FIRES (14D) · {pastEvents.length}
          </button>
        </div>

        <div className="model-section-header">
          <span className="model-section-title">
            {isHistoricalWindow
              ? "MATCHED FIRES IN WINDOW"
              : fireListScope === "past"
                ? "PAST TRACKED FIRES (ACTUAL VS PREDICTED)"
                : "RECENT TRACKED FIRES (≤12H)"}
          </span>
          <span className="model-count-tag">{sortedEvents.length} EVENTS</span>
        </div>

        {sortedEvents.length === 0 ? (
          <p className="hud-note">
            {fireListScope === "past"
              ? "No past tracked fires match the active filter."
              : "No tracked fires match the current filter in this feed."}
          </p>
        ) : (
          <ul className="tracked-fire-list" role="listbox" aria-label="Tracked fires">
            {sortedEvents.slice(0, 60).map((event) => {
              const fire = event.fire;
              const isSelected = String(fire.fire_final) === String(activeFireId);
              const haz = event.hazard;
              const pred = event.prediction;
              const hc = event.hindcast;
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
                      {event.is_past && hc?.isMultiPass && (
                        <span className="pred-chip pred-actual">
                          ACTUAL +{num(hc.actualAddAreaKm2, 2)} km²
                        </span>
                      )}
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

          {activeFireEvent?.is_past && activeFireEvent?.hindcast && (
            <div className="hindcast-compare-box" aria-label="Actual versus model predicted spread">
              <div className="inspector-subhead">
                <span className="inspector-sublabel">ACTUAL VS. PREDICTED SPREAD (HINDCAST)</span>
                <span className="hindcast-badge">
                  {activeFireEvent.hindcast.persisted
                    ? `PERSISTED (${activeFireEvent.hindcast.totalPasses} PASSES)`
                    : "SINGLE PASS"}
                </span>
              </div>
              <div className="ml-area-grid">
                <div className="inspector-kv">
                  <span>INITIAL PASS (T0)</span>
                  <strong>{num(activeFireEvent.hindcast.initialAreaKm2, 2)} km²</strong>
                </div>
                <div className="inspector-kv hindcast-actual-cell">
                  <span>ACTUAL SPREAD</span>
                  <strong>{num(activeFireEvent.hindcast.actualFinalAreaKm2, 2)} km²</strong>
                </div>
                <div className="inspector-kv hindcast-pred-cell">
                  <span>MODEL PREDICTED</span>
                  <strong>
                    {resolvedPrediction
                      ? `${num(resolvedPrediction.predicted_total_area_km2, 2)} km²`
                      : isLoadingHazard
                        ? "Scoring..."
                        : "—"}
                  </strong>
                </div>
                <div className="inspector-kv">
                  <span>ACTUAL GROWTH</span>
                  <strong>+{num(activeFireEvent.hindcast.actualAddAreaKm2, 2)} km²</strong>
                </div>
              </div>
              {resolvedPrediction && (
                <p className="hindcast-outcome-note">
                  Persistence: <strong>{activeFireEvent.hindcast.persisted ? "Yes" : "No"}</strong>{" "}
                  (Model 1: {pct(resolvedPrediction.persistence_probability)}) · Expansion{" "}
                  ≥1km²/25%: <strong>{activeFireEvent.hindcast.expandedActual ? "Yes" : "No"}</strong>{" "}
                  (Model 2: {pct(resolvedPrediction.expansion_probability)})
                </p>
              )}
            </div>
          )}

          {eventContext && (
            <div className="context-baseline-pill">
              <span>14D REGIONAL CONTEXT</span>
              <strong>
                {eventContext.anomalyRatio !== null
                  ? `${num(eventContext.anomalyRatio, 2)}× median`
                  : "Above zero median"}{" "}
                · P{eventContext.percentile} · {num(eventContext.modisEquivalent, 1)} MODIS-eq
              </strong>
            </div>
          )}

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

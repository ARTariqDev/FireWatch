"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyHotspots, formatUtcTime } from "@/lib/hotspot-data";

export default function TimelineControls({
  rawPoints = [],
  activeTab = "combined",
  onFiltered,
  onQueryDate,
  disabled = false,
}) {
  const [mode, setMode] = useState("slider"); // 'slider' | 'interval'
  const [hoursBack, setHoursBack] = useState(0);
  const [confidenceLevel, setConfidenceLevel] = useState(0); // 0: All, 1: Moderate+, 2: VIIRS+Dual, 3: High+Dual, 4: Dual only
  const [loading, setLoading] = useState(false);
  const [sliderTimeLabel, setSliderTimeLabel] = useState("WITHIN 12H OF DETECTION");

  // Default dates for custom interval (last 14 days for tracker)
  const defaults = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 14 * 24 * 3600 * 1000);
    return {
      startDate: start.toISOString().slice(0, 10),
      startTime: start.toISOString().slice(11, 16),
      endDate: end.toISOString().slice(0, 10),
      endTime: end.toISOString().slice(11, 16),
    };
  }, []);

  const [intervalForm, setIntervalForm] = useState(defaults);
  const [activeInterval, setActiveInterval] = useState(null);

  const tierFilter = useMemo(() => {
    if (activeTab !== "combined") return "all";
    switch (confidenceLevel) {
      case 0:
        return "all";
      case 1:
        return "moderate_plus";
      case 2:
        return "viirs_and_dual";
      case 3:
        return "high_and_dual";
      case 4:
        return "dual_only";
      default:
        return "all";
    }
  }, [activeTab, confidenceLevel]);

  // Re-classify points whenever rawPoints, activeTab, hoursBack, activeInterval, or confidenceLevel changes
  useEffect(() => {
    if (mode === "slider") {
      const result = classifyHotspots(rawPoints, { hoursBack, tierFilter, windowHours: 12 });
      onFiltered?.(result.filteredPoints, result.stats);
    } else if (mode === "interval" && activeInterval) {
      const result = classifyHotspots(rawPoints, {
        interval: activeInterval,
        tierFilter,
        windowHours: 12,
      });
      onFiltered?.(result.filteredPoints, result.stats);
    }
  }, [rawPoints, hoursBack, mode, activeInterval, tierFilter, onFiltered]);

  // Handle slider scrub
  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    setHoursBack(value);
    if (value === 0) {
      setSliderTimeLabel("WITHIN 12H OF DETECTION");
    } else {
      let latestTime = 0;
      for (const p of rawPoints) {
        if (typeof p[5] === "number" && p[5] > latestTime) latestTime = p[5];
      }
      const ref = latestTime || Date.now();
      setSliderTimeLabel(formatUtcTime(ref - value * 3600 * 1000));
    }
  };

  // Reset back to live default
  const handleResetLive = useCallback(() => {
    setHoursBack(0);
    setConfidenceLevel(0);
    setSliderTimeLabel("WITHIN 12H OF DETECTION");
    setActiveInterval(null);
    setMode("slider");
    const result = classifyHotspots(rawPoints, {
      hoursBack: 0,
      tierFilter: "all",
      windowHours: 12,
    });
    onFiltered?.(result.filteredPoints, result.stats);
  }, [rawPoints, onFiltered]);

  // Apply custom interval
  const handleApplyInterval = async (e) => {
    e?.preventDefault();
    const { startDate, startTime, endDate, endTime } = intervalForm;
    if (!startDate || !endDate) return;

    const startMs = Date.parse(`${startDate}T${startTime || "00:00"}:00Z`);
    const endMs = Date.parse(`${endDate}T${endTime || "23:59"}:59Z`);

    if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
      return;
    }

    const interval = { startMs, endMs };
    setActiveInterval(interval);

    const hasLocal = rawPoints.some((p) => p[5] >= startMs && p[5] <= endMs);
    if (!hasLocal && onQueryDate) {
      setLoading(true);
      const spanDays = Math.max(
        1,
        Math.min(14, Math.ceil((endMs - startMs) / (24 * 3600 * 1000)) || 1),
      );
      try {
        const data = await onQueryDate({ date: startDate, dayRange: spanDays });
        const tabPoints = data?.tabs?.[activeTab]?.points ?? data?.points;
        if (tabPoints) {
          const result = classifyHotspots(tabPoints, {
            interval,
            tierFilter,
            windowHours: 12,
          });
          onFiltered?.(result.filteredPoints, result.stats);
        }
      } finally {
        setLoading(false);
      }
    } else {
      const result = classifyHotspots(rawPoints, { interval, tierFilter, windowHours: 12 });
      onFiltered?.(result.filteredPoints, result.stats);
    }
  };

  const applyPreset = (hours) => {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const form = {
      startDate: start.toISOString().slice(0, 10),
      startTime: start.toISOString().slice(11, 16),
      endDate: end.toISOString().slice(0, 10),
      endTime: end.toISOString().slice(11, 16),
    };
    setIntervalForm(form);
    setActiveInterval({ startMs: start.getTime(), endMs: end.getTime() });
  };

  const isLive =
    mode === "slider" && hoursBack === 0 && (activeTab !== "combined" || confidenceLevel === 0);

  const confidenceLabels = ["ALL", "MODERATE+", "VIIRS+DUAL", "HIGH+DUAL", "DUAL ONLY"];
  const confidenceDescriptions = [
    "All combined detections — MODIS solo + VIIRS solo + dual-confirmed within 12 h.",
    "Moderate+ — excludes low-confidence MODIS (<50%) and low-confidence VIIRS.",
    "High-resolution VIIRS 375m + dual-confirmed detections.",
    "High confidence only — VIIRS High (H), MODIS ≥80%, and dual-confirmed.",
    "Dual-confirmed only — coincident MODIS + VIIRS cross-validation (within 1 km & ±4 h).",
  ];

  return (
    <div className="timeline-section" aria-label="Thermal Timeline Controls">
      <div className="timeline-header">
        <span className="timeline-title">RECENT DETECTION WINDOW (12H)</span>
        {!isLive && (
          <button type="button" className="timeline-reset-btn" onClick={handleResetLive}>
            ↺ LIVE
          </button>
        )}
      </div>

      {activeTab === "combined" ? (
        <div className="confidence-control">
          <div className="confidence-header">
            <span className="confidence-title">HARMONIZATION FILTER</span>
            <span className="confidence-badge">{confidenceLabels[confidenceLevel]}</span>
          </div>
          <div className="confidence-slider-wrap">
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              value={confidenceLevel}
              onChange={(e) => setConfidenceLevel(parseInt(e.target.value, 10))}
              disabled={disabled || loading}
              className="confidence-slider"
              aria-label="Confidence filter tier"
            />
            <div className="confidence-slider-ticks" aria-hidden="true">
              <span>ALL</span>
              <span>MOD+</span>
              <span>VIIRS+DUAL</span>
              <span>HIGH+</span>
              <span>DUAL</span>
            </div>
          </div>
          <p className="confidence-desc">{confidenceDescriptions[confidenceLevel]}</p>
        </div>
      ) : (
        <div className="confidence-control">
          <div className="confidence-header">
            <span className="confidence-title">
              {activeTab === "viirs" ? "VIIRS-ONLY TRACKER FEED" : "MODIS-ONLY TRACKER FEED"}
            </span>
            <span className="confidence-badge">
              {activeTab === "viirs" ? "375M · N20 + SNPP" : "1KM · TERRA + AQUA"}
            </span>
          </div>
          <p className="confidence-desc">
            {activeTab === "viirs"
              ? "Low-confidence VIIRS hotspots and known static industrial/gas-flare sources are removed by the tracker before running ML predictions and hazard rating."
              : "MODIS 1 km detections tracked independently over 14 days; hazard and ML predictions are isolated to the VIIRS tab."}
          </p>
        </div>
      )}

      <div className="timeline-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "slider"}
          className={`timeline-tab ${mode === "slider" ? "is-active" : ""}`}
          onClick={() => setMode("slider")}
          disabled={disabled}
        >
          12H SLIDER
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "interval"}
          className={`timeline-tab ${mode === "interval" ? "is-active" : ""}`}
          onClick={() => setMode("interval")}
          disabled={disabled}
        >
          DATE & TIME
        </button>
      </div>

      {mode === "slider" ? (
        <div className="timeline-slider-box">
          <div className="timeline-readout">
            <span className="timeline-badge">
              {hoursBack === 0 ? "RECENT (≤12H)" : `-${hoursBack.toFixed(1)}h AGO`}
            </span>
            <span className="timeline-utc">{sliderTimeLabel}</span>
          </div>

          <div className="timeline-slider-wrap">
            <input
              type="range"
              min="0"
              max="12"
              step="0.5"
              value={hoursBack}
              onChange={handleSliderChange}
              disabled={disabled}
              className="timeline-slider"
              aria-label="Hours back slider"
            />
            <div className="timeline-slider-ticks" aria-hidden="true">
              <span>NOW</span>
              <span>-3h</span>
              <span>-6h</span>
              <span>-9h</span>
              <span>-12h</span>
            </div>
          </div>
        </div>
      ) : (
        <form className="timeline-interval-box" onSubmit={handleApplyInterval}>
          <div className="timeline-presets">
            <button type="button" onClick={() => applyPreset(4)} className="timeline-preset-btn">
              Last 4h
            </button>
            <button type="button" onClick={() => applyPreset(8)} className="timeline-preset-btn">
              Last 8h
            </button>
            <button type="button" onClick={() => applyPreset(12)} className="timeline-preset-btn">
              Last 12h
            </button>
          </div>

          <div className="timeline-input-group">
            <label className="timeline-label">START (UTC)</label>
            <div className="timeline-inputs-row">
              <input
                type="date"
                value={intervalForm.startDate}
                onChange={(e) => setIntervalForm({ ...intervalForm, startDate: e.target.value })}
                className="timeline-input"
                disabled={disabled || loading}
              />
              <input
                type="time"
                value={intervalForm.startTime}
                onChange={(e) => setIntervalForm({ ...intervalForm, startTime: e.target.value })}
                className="timeline-input"
                disabled={disabled || loading}
              />
            </div>
          </div>

          <div className="timeline-input-group">
            <label className="timeline-label">END (UTC)</label>
            <div className="timeline-inputs-row">
              <input
                type="date"
                value={intervalForm.endDate}
                onChange={(e) => setIntervalForm({ ...intervalForm, endDate: e.target.value })}
                className="timeline-input"
                disabled={disabled || loading}
              />
              <input
                type="time"
                value={intervalForm.endTime}
                onChange={(e) => setIntervalForm({ ...intervalForm, endTime: e.target.value })}
                className="timeline-input"
                disabled={disabled || loading}
              />
            </div>
          </div>

          <div className="timeline-actions">
            <button type="submit" className="timeline-apply-btn" disabled={disabled || loading}>
              {loading ? "FETCHING..." : "FILTER INTERVAL"}
            </button>
            <button
              type="button"
              className="timeline-clear-btn"
              onClick={handleResetLive}
              disabled={disabled}
            >
              RESET
            </button>
          </div>
        </form>
      )}

      <div className="timeline-legend" aria-label="Confidence Tier Legend">
        {activeTab === "combined" && (
          <div
            className="timeline-legend-item"
            title="Dual-Confirmed: Both MODIS + VIIRS saw this fire within 4 hours (95–100% confidence)"
          >
            <span className="dot dot-dual" aria-hidden="true" />
            <span>
              DUAL <span className="legend-pct">95–100%</span>
            </span>
          </div>
        )}
        {activeTab !== "modis" && (
          <div
            className="timeline-legend-item"
            title="VIIRS: High-resolution 375m active detection"
          >
            <span className="dot dot-viirs" aria-hidden="true" />
            <span>VIIRS 375m</span>
          </div>
        )}
        {activeTab !== "viirs" && (
          <div className="timeline-legend-item" title="MODIS: 1km thermal anomaly detection">
            <span className="dot dot-modis" aria-hidden="true" />
            <span>MODIS 1km</span>
          </div>
        )}
        <div
          className="timeline-legend-item"
          title="Inactive in latest 6h pass (within 12h detection window)"
        >
          <span className="dot dot-extinguished" aria-hidden="true" />
          <span>COOLING</span>
        </div>
      </div>
    </div>
  );
}

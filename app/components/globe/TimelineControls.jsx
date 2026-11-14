"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyHotspots, formatUtcTime } from "@/lib/hotspot-data";

export default function TimelineControls({ rawPoints = [], onFiltered, onQueryDate, disabled = false }) {
  const [mode, setMode] = useState("slider"); // 'slider' | 'interval'
  const [hoursBack, setHoursBack] = useState(0);
  const [confidenceLevel, setConfidenceLevel] = useState(2); // 0: All, 1: Moderate+, 2: VIIRS+Dual (Default), 3: High+Dual, 4: Dual only
  const [loading, setLoading] = useState(false);
  const [sliderTimeLabel, setSliderTimeLabel] = useState("CURRENT DETECTIONS");

  // Default dates for custom interval
  const defaults = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
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
        return "viirs_and_dual";
    }
  }, [confidenceLevel]);

  // Re-classify points whenever rawPoints, hoursBack, activeInterval, or confidenceLevel changes
  useEffect(() => {
    if (!rawPoints || !rawPoints.length) return;

    if (mode === "slider") {
      const result = classifyHotspots(rawPoints, { hoursBack, tierFilter });
      onFiltered?.(result.filteredPoints, result.stats);
    } else if (mode === "interval" && activeInterval) {
      const result = classifyHotspots(rawPoints, { interval: activeInterval, tierFilter });
      onFiltered?.(result.filteredPoints, result.stats);
    }
  }, [rawPoints, hoursBack, mode, activeInterval, tierFilter, onFiltered]);

  // Handle slider scrub
  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    setHoursBack(value);
    if (value === 0) {
      setSliderTimeLabel("CURRENT DETECTIONS");
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
    setConfidenceLevel(2);
    setSliderTimeLabel("CURRENT DETECTIONS");
    setActiveInterval(null);
    setMode("slider");
    const result = classifyHotspots(rawPoints, { hoursBack: 0, tierFilter: "viirs_and_dual" });
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

    // If loaded rawPoints do not cover this interval, fetch historical points
    const hasLocal = rawPoints.some((p) => p[5] >= startMs && p[5] <= endMs);
    if (!hasLocal && onQueryDate) {
      setLoading(true);
      const spanDays = Math.max(1, Math.min(5, Math.ceil((endMs - startMs) / (24 * 3600 * 1000)) || 1));
      try {
        const data = await onQueryDate({ date: startDate, dayRange: spanDays });
        if (data?.points) {
          const result = classifyHotspots(data.points, { interval, tierFilter });
          onFiltered?.(result.filteredPoints, result.stats);
        }
      } finally {
        setLoading(false);
      }
    } else {
      const result = classifyHotspots(rawPoints, { interval, tierFilter });
      onFiltered?.(result.filteredPoints, result.stats);
    }
  };

  // Preset quick selections
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
    const startMs = start.getTime();
    const endMs = end.getTime();
    setActiveInterval({ startMs, endMs });
  };

  const isLive = mode === "slider" && hoursBack === 0 && confidenceLevel === 2;

  const confidenceLabels = ["ALL", "MODERATE+", "VIIRS+DUAL", "HIGH+DUAL", "DUAL ONLY"];
  const confidenceDescriptions = [
    "All sensors — MODIS solo + VIIRS solo + dual-confirmed. Includes low-confidence/coarse detections.",
    "Moderate+ — excludes low-confidence MODIS (<50%) and low-confidence VIIRS.",
    "Default operational view — high-resolution VIIRS 375m + dual-confirmed detections.",
    "High confidence only — nominal/low filtered out. Only VIIRS High (H), MODIS ≥80%, and dual-confirmed.",
    "Dual-confirmed only — coincident multi-satellite cross-validation (MODIS + VIIRS within 1 km and ±4 h).",
  ];

  return (
    <div className="timeline-section" aria-label="Thermal Timeline Controls">
      <div className="timeline-header">
        <span className="timeline-title">TIMELINE & HISTORICAL SCRUB</span>
        {!isLive && (
          <button type="button" className="timeline-reset-btn" onClick={handleResetLive}>
            ↺ LIVE
          </button>
        )}
      </div>

      <div className="confidence-control">
        <div className="confidence-header">
          <span className="confidence-title">CONFIDENCE FILTER</span>
          <span className="confidence-badge">
            {confidenceLabels[confidenceLevel]}
          </span>
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
        <p className="confidence-desc">
          {confidenceDescriptions[confidenceLevel]}
        </p>
      </div>

      <div className="timeline-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "slider"}
          className={`timeline-tab ${mode === "slider" ? "is-active" : ""}`}
          onClick={() => setMode("slider")}
          disabled={disabled}
        >
          24H SLIDER
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
              {hoursBack === 0 ? "LIVE (NOW)" : `-${hoursBack.toFixed(1)}h AGO`}
            </span>
            <span className="timeline-utc">{sliderTimeLabel}</span>
          </div>

          <div className="timeline-slider-wrap">
            <input
              type="range"
              min="0"
              max="24"
              step="0.5"
              value={hoursBack}
              onChange={handleSliderChange}
              disabled={disabled}
              className="timeline-slider"
              aria-label="Hours back slider"
            />
            <div className="timeline-slider-ticks" aria-hidden="true">
              <span>NOW</span>
              <span>-6h</span>
              <span>-12h</span>
              <span>-18h</span>
              <span>-24h</span>
            </div>
          </div>
        </div>
      ) : (
        <form className="timeline-interval-box" onSubmit={handleApplyInterval}>
          <div className="timeline-presets">
            <button type="button" onClick={() => applyPreset(6)} className="timeline-preset-btn">
              Last 6h
            </button>
            <button type="button" onClick={() => applyPreset(12)} className="timeline-preset-btn">
              Last 12h
            </button>
            <button type="button" onClick={() => applyPreset(24)} className="timeline-preset-btn">
              Last 24h
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
            <button type="button" className="timeline-clear-btn" onClick={handleResetLive} disabled={disabled}>
              RESET
            </button>
          </div>
        </form>
      )}

      <div className="timeline-legend" aria-label="Confidence Tier Legend">
        <div className="timeline-legend-item" title="Dual-Confirmed: Both MODIS + VIIRS saw this fire within 4 hours (95–100% confidence)">
          <span className="dot dot-dual" aria-hidden="true" />
          <span>DUAL <span className="legend-pct">95–100%</span></span>
        </div>
        <div className="timeline-legend-item" title="VIIRS Solo: High-resolution 375m active detection (75–90% confidence)">
          <span className="dot dot-viirs" aria-hidden="true" />
          <span>VIIRS <span className="legend-pct">75–90%</span></span>
        </div>
        <div className="timeline-legend-item" title="MODIS Solo: 1km coarse detection, unconfirmed by VIIRS (30–55% confidence)">
          <span className="dot dot-modis" aria-hidden="true" />
          <span>MODIS <span className="legend-pct">30–55%</span></span>
        </div>
        <div className="timeline-legend-item" title="Put Out / Inactive: No thermal signal in the latest satellite pass">
          <span className="dot dot-extinguished" aria-hidden="true" />
          <span>PUT OUT</span>
        </div>
      </div>
    </div>
  );
}

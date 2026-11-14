"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyHotspots, formatUtcTime } from "@/lib/hotspot-data";

export default function TimelineControls({ rawPoints = [], onFiltered, onQueryDate, disabled = false }) {
  const [mode, setMode] = useState("slider"); // 'slider' | 'interval'
  const [hoursBack, setHoursBack] = useState(0);
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

  // Re-classify points whenever rawPoints, hoursBack, or activeInterval changes
  useEffect(() => {
    if (!rawPoints || !rawPoints.length) return;

    if (mode === "slider") {
      const result = classifyHotspots(rawPoints, { hoursBack });
      onFiltered?.(result.filteredPoints, result.stats);
    } else if (mode === "interval" && activeInterval) {
      const result = classifyHotspots(rawPoints, { interval: activeInterval });
      onFiltered?.(result.filteredPoints, result.stats);
    }
  }, [rawPoints, hoursBack, mode, activeInterval, onFiltered]);

  // Handle slider scrub
  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    setHoursBack(value);
    if (value === 0) {
      setSliderTimeLabel("CURRENT DETECTIONS");
    } else {
      setSliderTimeLabel(formatUtcTime(Date.now() - value * 3600 * 1000));
    }
  };

  // Reset back to live
  const handleResetLive = useCallback(() => {
    setHoursBack(0);
    setSliderTimeLabel("CURRENT DETECTIONS");
    setActiveInterval(null);
    setMode("slider");
    const result = classifyHotspots(rawPoints, { hoursBack: 0 });
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
          const result = classifyHotspots(data.points, { interval });
          onFiltered?.(result.filteredPoints, result.stats);
        }
      } finally {
        setLoading(false);
      }
    } else {
      const result = classifyHotspots(rawPoints, { interval });
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

  const isLive = mode === "slider" && hoursBack === 0;

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

          <div className="timeline-legend">
            <div className="timeline-legend-item">
              <span className="dot dot-active" aria-hidden="true" />
              <span>ACTIVE</span>
            </div>
            <div className="timeline-legend-item">
              <span className="dot dot-extinguished" aria-hidden="true" />
              <span>PUT OUT / INACTIVE</span>
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
    </div>
  );
}

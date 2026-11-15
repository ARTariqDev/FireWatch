"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyHotspots, formatUtcTime } from "@/lib/hotspot-data";

export default function TimelineControls({
  rawPoints = [],
  points14d = null,
  activeTab = "combined",
  harmonization = null,
  selectedDay = null,
  onSelectDay,
  onFiltered,
  onQueryDate,
  disabled = false,
}) {
  const [mode, setMode] = useState("slider"); // 'slider' | 'interval'
  const [hoursBack, setHoursBack] = useState(0);
  const [confidenceLevel, setConfidenceLevel] = useState(0); // 0: All, 1: Moderate+, 2: VIIRS+Dual, 3: High+Dual, 4: Dual only
  const [loading, setLoading] = useState(false);

  const fullPoints = useMemo(
    () => (Array.isArray(points14d) && points14d.length ? points14d : rawPoints),
    [points14d, rawPoints],
  );

  const { referenceTime, minDatasetTime } = useMemo(() => {
    let maxT = 0;
    let minT = Infinity;
    for (const p of fullPoints) {
      const acq = p?.[5];
      if (typeof acq === "number" && Number.isFinite(acq)) {
        if (acq > maxT) maxT = acq;
        if (acq < minT) minT = acq;
      }
    }
    const harmEndMs = harmonization?.window?.end ? Date.parse(harmonization.window.end) : NaN;
    const harmStartMs = harmonization?.window?.start ? Date.parse(harmonization.window.start) : NaN;
    const ref = maxT > 0 ? maxT : Number.isFinite(harmEndMs) ? harmEndMs : 0;
    const min = Number.isFinite(minT)
      ? minT
      : Number.isFinite(harmStartMs)
        ? harmStartMs
        : ref > 0
          ? ref - 14 * 24 * 3600 * 1000
          : 0;
    return { referenceTime: ref, minDatasetTime: min };
  }, [fullPoints, harmonization]);

  const buildDefaultForm = useCallback(
    (refMs, minMs) => {
      if (!refMs || !Number.isFinite(refMs)) {
        return {
          startDate: "",
          startTime: "00:00",
          endDate: "",
          endTime: "23:59",
        };
      }
      const end = new Date(refMs);
      const start = new Date(Math.max(minMs || 0, refMs - 24 * 3600 * 1000));
      return {
        startDate: start.toISOString().slice(0, 10),
        startTime: start.toISOString().slice(11, 16),
        endDate: end.toISOString().slice(0, 10),
        endTime: end.toISOString().slice(11, 16),
      };
    },
    [],
  );

  const [intervalForm, setIntervalForm] = useState(() =>
    buildDefaultForm(referenceTime, minDatasetTime),
  );
  const [activeInterval, setActiveInterval] = useState(null);
  const [prevRefTime, setPrevRefTime] = useState(referenceTime);
  const [prevSelectedDay, setPrevSelectedDay] = useState(selectedDay);

  if (referenceTime !== prevRefTime) {
    setPrevRefTime(referenceTime);
    if (!activeInterval) {
      setIntervalForm(buildDefaultForm(referenceTime, minDatasetTime));
    }
  }

  if (selectedDay !== prevSelectedDay) {
    setPrevSelectedDay(selectedDay);
    if (selectedDay) {
      const [startDay, endDay] = selectedDay.includes("..")
        ? selectedDay.split("..")
        : [selectedDay, selectedDay];
      const startMs = Date.parse(`${startDay}T00:00:00Z`);
      const endMs = Date.parse(`${endDay || startDay}T23:59:59Z`);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        setMode("interval");
        setIntervalForm({
          startDate: startDay,
          startTime: "00:00",
          endDate: endDay || startDay,
          endTime: "23:59",
        });
        setActiveInterval({ startMs, endMs });
      }
    } else if (prevSelectedDay) {
      setActiveInterval(null);
      setHoursBack(0);
      setMode("slider");
    }
  }

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
        return "all";
    }
  }, [confidenceLevel]);

  // Re-classify points whenever data, slider, calendar interval, or harmonization tier changes
  useEffect(() => {
    if (mode === "slider") {
      const source = hoursBack > 0 ? fullPoints : rawPoints.length ? rawPoints : fullPoints;
      const result = classifyHotspots(source, {
        hoursBack,
        tierFilter,
        windowHours: 12,
        referenceTime,
      });
      onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
    } else if (mode === "interval" && activeInterval) {
      const result = classifyHotspots(fullPoints, {
        interval: activeInterval,
        tierFilter,
        windowHours: 12,
        referenceTime,
      });
      onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
    } else if (mode === "interval") {
      const result = classifyHotspots(fullPoints, {
        hoursBack: 0,
        tierFilter,
        windowHours: 12,
        referenceTime,
      });
      onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
    }
  }, [fullPoints, rawPoints, hoursBack, mode, activeInterval, tierFilter, referenceTime, onFiltered]);

  const sliderTimeLabel = useMemo(() => {
    if (hoursBack === 0) return "WITHIN 12H OF DETECTION";
    if (!referenceTime) return `-${hoursBack}H`;
    return formatUtcTime(referenceTime - hoursBack * 3600 * 1000);
  }, [hoursBack, referenceTime]);

  const handleSliderChange = (e) => {
    const value = parseFloat(e.target.value);
    setHoursBack(value);
    if (selectedDay) onSelectDay?.(null);
    setActiveInterval(null);
  };

  const handleResetLive = useCallback(() => {
    setHoursBack(0);
    setConfidenceLevel(0);
    setActiveInterval(null);
    setIntervalForm(buildDefaultForm(referenceTime, minDatasetTime));
    setMode("slider");
    onSelectDay?.(null);
    const source = rawPoints.length ? rawPoints : fullPoints;
    const result = classifyHotspots(source, {
      hoursBack: 0,
      tierFilter: "all",
      windowHours: 12,
      referenceTime,
    });
    onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
  }, [rawPoints, fullPoints, referenceTime, minDatasetTime, buildDefaultForm, onSelectDay, onFiltered]);

  const handleApplyInterval = async (e) => {
    e?.preventDefault();
    const { startDate, startTime, endDate, endTime } = intervalForm;
    if (!startDate || !endDate) return;

    const startMs = Date.parse(`${startDate}T${startTime || "00:00"}:00Z`);
    const endMs = Date.parse(`${endDate}T${endTime || "23:59"}:59Z`);

    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
      return;
    }

    const interval = { startMs, endMs };
    setMode("interval");
    setActiveInterval(interval);
    const nextRange = startDate === endDate ? startDate : `${startDate}..${endDate}`;
    if (nextRange !== selectedDay) {
      onSelectDay?.(nextRange);
    }

    const inLoadedWindow =
      endMs >= minDatasetTime - 12 * 3600 * 1000 &&
      startMs <= referenceTime + 12 * 3600 * 1000;

    if (!inLoadedWindow && onQueryDate) {
      setLoading(true);
      const spanDays = Math.max(
        1,
        Math.min(14, Math.ceil((endMs - startMs) / (24 * 3600 * 1000)) || 1),
      );
      try {
        const data = await onQueryDate({ date: startDate, dayRange: spanDays });
        const tabPoints =
          data?.tabs?.[activeTab]?.points14d ??
          data?.tabs?.[activeTab]?.points ??
          data?.points14d ??
          data?.points;
        if (tabPoints) {
          const result = classifyHotspots(tabPoints, {
            interval,
            tierFilter,
            windowHours: 12,
          });
          onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
        }
      } finally {
        setLoading(false);
      }
    } else {
      const result = classifyHotspots(fullPoints, {
        interval,
        tierFilter,
        windowHours: 12,
        referenceTime,
      });
      onFiltered?.(result.filteredPoints, result.stats, result.filterWindow);
    }
  };

  const applyPreset = (hours) => {
    if (!referenceTime) return;
    const endMs = referenceTime;
    const startMs = Math.max(minDatasetTime - 3600 * 1000, endMs - hours * 3600 * 1000);
    const end = new Date(endMs);
    const start = new Date(startMs);
    setIntervalForm({
      startDate: start.toISOString().slice(0, 10),
      startTime: start.toISOString().slice(11, 16),
      endDate: end.toISOString().slice(0, 10),
      endTime: end.toISOString().slice(11, 16),
    });
    setMode("interval");
    onSelectDay?.(null);
    setActiveInterval({ startMs, endMs });
  };

  const isLive =
    mode === "slider" && hoursBack === 0 && confidenceLevel === 0 && !activeInterval && !selectedDay;

  const tiers = harmonization?.empiricalTiers;
  const formatTierLabel = (tierStat, fallbackRank) => {
    if (!tierStat) return `Tier ${fallbackRank}`;
    if (!tierStat.sampleSize || tierStat.confirmedRate === null) {
      return `Tier ${tierStat.ordinalRank}`;
    }
    return `T${tierStat.ordinalRank} · ${Math.round(tierStat.confirmedRate * 100)}%`;
  };
  const formatTierTitle = (baseDesc, tierStat) => {
    if (!tierStat || !tierStat.sampleSize || tierStat.confirmedRate === null) {
      return `${baseDesc} (Ordinal rank ${tierStat?.ordinalRank ?? "—"})`;
    }
    const ci = tierStat.ci95
      ? ` [95% CI ${Math.round(tierStat.ci95[0] * 100)}–${Math.round(tierStat.ci95[1] * 100)}%]`
      : "";
    return `${baseDesc} Empirical multi-pass confirmation: ${Math.round(tierStat.confirmedRate * 100)}% (${tierStat.confirmedCount}/${tierStat.sampleSize})${ci}`;
  };

  const confidenceLabels =
    activeTab === "modis"
      ? ["ALL", "MODIS ≥30%", "MODIS ≥65%", "MODIS ≥80%", "DUAL N/A"]
      : ["ALL", "MODERATE+", "VIIRS+DUAL", "HIGH+DUAL", "DUAL ONLY"];
  const confidenceDescriptions =
    activeTab === "viirs"
      ? [
          "All tracked VIIRS detections (nominal & high confidence).",
          "Consistent VIIRS detections (nominal & high).",
          "All tracked VIIRS 375m detections.",
          "High-confidence VIIRS (H) detections only.",
          "Dual-confirmed MODIS + VIIRS detections (switch to MODIS + VIIRS for all dual pairs).",
        ]
      : activeTab === "modis"
        ? [
            "All tracked MODIS 1 km detections.",
            "MODIS confidence ≥ 30% (cross-sensor consistent threshold).",
            "MODIS confidence ≥ 65% only.",
            "High-confidence MODIS ≥ 80% detections only.",
            "Dual-confirmed pairs (available in MODIS + VIIRS combined tab).",
          ]
        : [
            "All combined detections — ordinal Tiers 1 > 2 > 3 > 4.",
            "Moderate+ — cross-sensor consistent (MODIS >= 30% & VIIRS nominal/high).",
            "High-resolution VIIRS 375m + dual-confirmed detections (Tier 1 & Tier 2).",
            "High confidence only — VIIRS High (H), MODIS >= 80%, and Tier 1 Dual-confirmed.",
            "Tier 1 Dual-confirmed — MODIS + VIIRS coincidence within 1 km & ±4–5.5 h drift-adaptive window.",
          ];

  return (
    <div className="timeline-section" aria-label="Thermal Timeline Controls">
      <div className="timeline-header">
        <span className="timeline-title">HARMONIZATION &amp; 24H TIMELINE</span>
        {!isLive && (
          <button type="button" className="timeline-reset-btn" onClick={handleResetLive}>
            ↺ LIVE
          </button>
        )}
      </div>

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
            {activeTab === "modis" ? (
              <>
                <span>ALL</span>
                <span>≥30%</span>
                <span>≥65%</span>
                <span>≥80%</span>
                <span>DUAL</span>
              </>
            ) : (
              <>
                <span>ALL</span>
                <span>MOD+</span>
                <span>VIIRS+DUAL</span>
                <span>HIGH+</span>
                <span>DUAL</span>
              </>
            )}
          </div>
        </div>
        <p className="confidence-desc">{confidenceDescriptions[confidenceLevel]}</p>
      </div>

      <div className="timeline-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "slider"}
          className={`timeline-tab ${mode === "slider" ? "is-active" : ""}`}
          onClick={() => {
            setMode("slider");
            setActiveInterval(null);
            onSelectDay?.(null);
          }}
          disabled={disabled}
        >
          24H SLIDER
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "interval"}
          className={`timeline-tab ${mode === "interval" ? "is-active" : ""}`}
          onClick={() => {
            setMode("interval");
            if (!activeInterval) {
              setIntervalForm(buildDefaultForm(referenceTime, minDatasetTime));
            }
          }}
          disabled={disabled}
        >
          CALENDAR &amp; DATE
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
              max="24"
              step="0.5"
              value={hoursBack}
              onChange={handleSliderChange}
              disabled={disabled}
              className="timeline-slider"
              aria-label="24 hours back slider"
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
              6h
            </button>
            <button type="button" onClick={() => applyPreset(12)} className="timeline-preset-btn">
              12h
            </button>
            <button type="button" onClick={() => applyPreset(24)} className="timeline-preset-btn">
              24h
            </button>
            <button type="button" onClick={() => applyPreset(7 * 24)} className="timeline-preset-btn">
              7d
            </button>
            <button type="button" onClick={() => applyPreset(14 * 24)} className="timeline-preset-btn">
              14d
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
              {loading ? "FETCHING..." : "APPLY CALENDAR"}
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

      <div className="timeline-legend" aria-label="Empirical Ordinal Confidence Tier Legend">
        {activeTab === "combined" && (
          <div
            className="timeline-legend-item"
            title={formatTierTitle(
              "Dual-Confirmed (Tier 1): Coincident MODIS + VIIRS within 1 km.",
              tiers?.tier1,
            )}
          >
            <span className="dot dot-dual" aria-hidden="true" />
            <span>
              DUAL <span className="legend-pct">{formatTierLabel(tiers?.tier1, 1)}</span>
            </span>
          </div>
        )}
        {activeTab !== "modis" && (
          <div
            className="timeline-legend-item"
            title={formatTierTitle(
              "VIIRS Solo (Tier 2): High-resolution 375m active detection.",
              tiers?.tier2,
            )}
          >
            <span className="dot dot-viirs" aria-hidden="true" />
            <span>
              VIIRS <span className="legend-pct">{formatTierLabel(tiers?.tier2, 2)}</span>
            </span>
          </div>
        )}
        {activeTab !== "viirs" && (
          <div
            className="timeline-legend-item"
            title={formatTierTitle(
              "MODIS Solo (Tier 3): Coarse 1km thermal anomaly detection.",
              tiers?.tier3,
            )}
          >
            <span className="dot dot-modis" aria-hidden="true" />
            <span>
              MODIS <span className="legend-pct">{formatTierLabel(tiers?.tier3, 3)}</span>
            </span>
          </div>
        )}
        <div
          className="timeline-legend-item"
          title="Low / Cooling (Tier 4): Low confidence (<30% MODIS / VIIRS 'l') or absent in latest 6h pass"
        >
          <span className="dot dot-extinguished" aria-hidden="true" />
          <span>
            COOL/LOW <span className="legend-pct">T4</span>
          </span>
        </div>
      </div>
    </div>
  );
}

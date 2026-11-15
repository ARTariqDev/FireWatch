"use client";

import { useMemo, useState } from "react";

const CIVIDIS_STOPS = [
  "#00224e",
  "#233e6c",
  "#4c566d",
  "#7a7b78",
  "#af9e56",
  "#fee838",
];

function cividisColor(value, maxVal) {
  if (!maxVal || value <= 0) return "#14161d";
  const ratio = Math.min(1, Math.max(0, value / maxVal));
  const idx = Math.min(
    CIVIDIS_STOPS.length - 1,
    Math.max(0, Math.round(ratio * (CIVIDIS_STOPS.length - 1))),
  );
  return CIVIDIS_STOPS[idx];
}

function anomalyDivergingColor(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "#1f2937";
  if (ratio <= 0.4) return "#1d4ed8";
  if (ratio <= 0.75) return "#3b82f6";
  if (ratio <= 0.95) return "#64748b";
  if (ratio <= 1.15) return "#94a3b8";
  if (ratio <= 1.5) return "#f59e0b";
  if (ratio <= 2.2) return "#ea580c";
  return "#dc2626";
}

function eraRegimeColor(cell) {
  if (cell?.isObservedFirms) return "#10b981";
  if (cell?.era === "modis_era") return "#3b82f6";
  return "#f59e0b";
}

function num(val, digits = 1) {
  return typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";
}

function dayOfWeekShort(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return "";
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return names[new Date(ms).getUTCDay()] || "";
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

function parseSelectedDatesFromProp(selectedDay, allDates) {
  if (!selectedDay) return [];
  const str = String(selectedDay);
  if (str.includes("..")) {
    const [start, end] = str.split("..");
    return allDates.filter((d) => d >= start && d <= end);
  }
  return allDates.includes(str) ? [str] : [str];
}

export default function FireActivityCalendar({
  iso3 = "PAK",
  activeTab = "combined",
  harmonization = null,
  points14d = [],
  rawPoints = [],
  selectedDay = null,
  onSelectDay,
  generatedAt = "",
}) {
  const harmSummary = harmonization?.summary || null;
  const harmValidation = harmonization?.validation || null;
  const ssot = harmonization?.ssot || null;
  const climatology = harmonization?.climatology || null;
  const harmDaily = useMemo(() => harmonization?.dailySeries || [], [harmonization?.dailySeries]);

  const [calendarView, setCalendarView] = useState("daily"); // "daily" | "monthly"
  const [metric, setMetric] = useState("modis_eq"); // "modis_eq" | "frp" | "anomaly" | "regimes"
  const [eraFilter, setEraFilter] = useState("all"); // "all" | "overlap" | "modis"
  const [multiMode, setMultiMode] = useState(false);
  const [customDailySelection, setCustomDailySelection] = useState([]);
  const [rangeAnchorDay, setRangeAnchorDay] = useState(null);
  const [selectedMonthlyKeys, setSelectedMonthlyKeys] = useState([]);
  const [prevSelectedDay, setPrevSelectedDay] = useState(selectedDay);
  const [prevIso3, setPrevIso3] = useState(iso3);

  const allDailyDates = useMemo(() => harmDaily.map((d) => d.date), [harmDaily]);

  if (iso3 !== prevIso3) {
    setPrevIso3(iso3);
    setCustomDailySelection([]);
    setRangeAnchorDay(null);
    setSelectedMonthlyKeys([]);
  }

  if (selectedDay !== prevSelectedDay) {
    setPrevSelectedDay(selectedDay);
    if (!selectedDay) {
      setCustomDailySelection([]);
      setRangeAnchorDay(null);
    } else if (!multiMode) {
      setCustomDailySelection(parseSelectedDatesFromProp(selectedDay, allDailyDates));
    }
  }

  const activeDailySelection = useMemo(() => {
    if (customDailySelection.length > 0) return customDailySelection;
    if (selectedDay) return parseSelectedDatesFromProp(selectedDay, allDailyDates);
    return [];
  }, [customDailySelection, selectedDay, allDailyDates]);

  const activeDailySet = useMemo(() => new Set(activeDailySelection), [activeDailySelection]);

  const maxDailyModisEq = useMemo(
    () => Math.max(0.1, ...harmDaily.map((d) => Number(d.modisEquivalent) || 0)),
    [harmDaily],
  );
  const maxDailyFrp = useMemo(
    () => Math.max(1, ...harmDaily.map((d) => Number(d.totalFrpSum) || 0)),
    [harmDaily],
  );
  const maxDailyRegimeTotal = useMemo(
    () =>
      Math.max(
        1,
        ...harmDaily.map(
          (d) =>
            (d.coincidentDual || 0) +
            (d.diurnalBridged || 0) +
            (d.subResolutionViirs || 0) +
            (d.modisGapFill || 0),
        ),
      ),
    [harmDaily],
  );

  // Sync contiguous or single daily selection to the 3D globe filter
  const pushDailySelectionToMap = (nextDates) => {
    const sorted = [...new Set(nextDates)].sort();
    setCustomDailySelection(sorted);
    if (!sorted.length) {
      onSelectDay?.(null);
      return;
    }
    if (sorted.length === 1) {
      onSelectDay?.(sorted[0]);
      return;
    }
    if (sorted.length === allDailyDates.length) {
      onSelectDay?.(`${sorted[0]}..${sorted[sorted.length - 1]}`);
      return;
    }
    // Check if sorted matches a contiguous slice of allDailyDates
    const startIdx = allDailyDates.indexOf(sorted[0]);
    const endIdx = allDailyDates.indexOf(sorted[sorted.length - 1]);
    if (startIdx >= 0 && endIdx - startIdx + 1 === sorted.length) {
      onSelectDay?.(`${sorted[0]}..${sorted[sorted.length - 1]}`);
    } else {
      // Multi-day non-contiguous export selection focuses the globe onto its spanning window
      onSelectDay?.(`${sorted[0]}..${sorted[sorted.length - 1]}`);
    }
  };

  const handleDailyCellClick = (day, event) => {
    const dateStr = day.date;
    if (event?.shiftKey && rangeAnchorDay && allDailyDates.includes(rangeAnchorDay)) {
      const a = allDailyDates.indexOf(rangeAnchorDay);
      const b = allDailyDates.indexOf(dateStr);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      pushDailySelectionToMap(allDailyDates.slice(lo, hi + 1));
      return;
    }

    if (multiMode) {
      const exists = activeDailySet.has(dateStr);
      const next = exists
        ? activeDailySelection.filter((d) => d !== dateStr)
        : [...activeDailySelection, dateStr];
      setRangeAnchorDay(dateStr);
      pushDailySelectionToMap(next);
      return;
    }

    setRangeAnchorDay(dateStr);
    if (selectedDay === dateStr) {
      setCustomDailySelection([]);
      onSelectDay?.(null);
    } else {
      setCustomDailySelection([dateStr]);
      onSelectDay?.(dateStr);
    }
  };

  const monthlyCells = useMemo(() => climatology?.cells || [], [climatology?.cells]);
  const filteredYears = useMemo(() => {
    const yrs = climatology?.years || [];
    if (eraFilter === "modis") return yrs.filter((y) => y <= 2011);
    if (eraFilter === "overlap") return yrs.filter((y) => y >= 2012);
    return yrs;
  }, [climatology?.years, eraFilter]);

  const visibleMonthlyCells = useMemo(() => {
    const yearSet = new Set(filteredYears);
    return monthlyCells.filter((c) => yearSet.has(c.year));
  }, [monthlyCells, filteredYears]);

  const monthlyCellMap = useMemo(() => {
    const map = new Map();
    for (const c of visibleMonthlyCells) map.set(c.key, c);
    return map;
  }, [visibleMonthlyCells]);

  const maxMonthlyModisEq = useMemo(
    () => Math.max(1, ...visibleMonthlyCells.map((c) => Number(c.modisEquivalent) || 0)),
    [visibleMonthlyCells],
  );
  const maxMonthlyFrp = useMemo(
    () => Math.max(1, ...visibleMonthlyCells.map((c) => Number(c.frpSum) || 0)),
    [visibleMonthlyCells],
  );

  const selectedMonthSet = useMemo(() => new Set(selectedMonthlyKeys), [selectedMonthlyKeys]);

  const handleToggleMonthCell = (key) => {
    setSelectedMonthlyKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleToggleYearRow = (year) => {
    const keys = visibleMonthlyCells.filter((c) => c.year === year).map((c) => c.key);
    const allSelected = keys.length > 0 && keys.every((k) => selectedMonthSet.has(k));
    setSelectedMonthlyKeys((prev) => {
      if (allSelected) return prev.filter((k) => !keys.includes(k));
      return [...new Set([...prev, ...keys])];
    });
  };

  const handleToggleMonthColumn = (monthNum) => {
    const keys = visibleMonthlyCells.filter((c) => c.month === monthNum).map((c) => c.key);
    const allSelected = keys.length > 0 && keys.every((k) => selectedMonthSet.has(k));
    setSelectedMonthlyKeys((prev) => {
      if (allSelected) return prev.filter((k) => !keys.includes(k));
      return [...new Set([...prev, ...keys])];
    });
  };

  const exportDays = useMemo(() => {
    if (activeDailySelection.length > 0) {
      return harmDaily.filter((d) => activeDailySet.has(d.date));
    }
    return harmDaily;
  }, [harmDaily, activeDailySelection.length, activeDailySet]);

  const exportMonths = useMemo(() => {
    if (selectedMonthlyKeys.length > 0) {
      return visibleMonthlyCells.filter((c) => selectedMonthSet.has(c.key));
    }
    return visibleMonthlyCells;
  }, [visibleMonthlyCells, selectedMonthlyKeys.length, selectedMonthSet]);

  const allAvailablePoints = useMemo(
    () => (Array.isArray(points14d) && points14d.length ? points14d : rawPoints || []),
    [points14d, rawPoints],
  );

  const selectedHotspotsForExport = useMemo(() => {
    if (calendarView === "daily") {
      if (!activeDailySelection.length) {
        return rawPoints?.length ? rawPoints : allAvailablePoints;
      }
      return allAvailablePoints.filter((pt) => {
        const acq = Number(pt?.[5]);
        if (!Number.isFinite(acq)) return false;
        const dayStr = new Date(acq).toISOString().slice(0, 10);
        return activeDailySet.has(dayStr);
      });
    }

    // Monthly calendar mode: filter points14d belonging to selected YYYY-MMs (or all 14d points if none selected)
    if (!selectedMonthlyKeys.length) {
      return allAvailablePoints;
    }
    return allAvailablePoints.filter((pt) => {
      const acq = Number(pt?.[5]);
      if (!Number.isFinite(acq)) return false;
      const ymStr = new Date(acq).toISOString().slice(0, 7);
      return selectedMonthSet.has(ymStr);
    });
  }, [
    calendarView,
    activeDailySelection.length,
    activeDailySet,
    selectedMonthlyKeys.length,
    selectedMonthSet,
    rawPoints,
    allAvailablePoints,
  ]);

  const selectionSummary = useMemo(() => {
    if (calendarView === "daily") {
      const items = exportDays;
      const totalEq = items.reduce((s, d) => s + (Number(d.modisEquivalent) || 0), 0);
      const totalFrp = items.reduce((s, d) => s + (Number(d.totalFrpSum) || 0), 0);
      const peak = items.reduce((best, d) => (!best || d.modisEquivalent > best.modisEquivalent ? d : best), null);
      const dualCount = items.reduce((s, d) => s + (d.coincidentDual || 0) + (d.diurnalBridged || 0), 0);
      const viirsSubCount = items.reduce((s, d) => s + (d.subResolutionViirs || 0), 0);
      const modisGapCount = items.reduce((s, d) => s + (d.modisGapFill || 0), 0);
      return {
        label: activeDailySelection.length ? `${items.length}d selected` : `All ${items.length}d`,
        totalEq: Number(totalEq.toFixed(1)),
        meanEq: items.length ? Number((totalEq / items.length).toFixed(1)) : 0,
        totalFrp: Number(totalFrp.toFixed(1)),
        peakLabel: peak ? `${peak.date.slice(5)} (${peak.modisEquivalent})` : "—",
        dualCount,
        viirsSubCount,
        modisGapCount,
      };
    }

    const items = exportMonths;
    const totalEq = items.reduce((s, c) => s + (Number(c.modisEquivalent) || 0), 0);
    const totalFrp = items.reduce((s, c) => s + (Number(c.frpSum) || 0), 0);
    const peak = items.reduce((best, c) => (!best || c.modisEquivalent > best.modisEquivalent ? c : best), null);
    const observedCount = items.filter((c) => c.isObservedFirms).length;
    return {
      label: selectedMonthlyKeys.length ? `${items.length} mo selected` : `${items.length} mo (${eraFilter})`,
      totalEq: Number(totalEq.toFixed(1)),
      meanEq: items.length ? Number((totalEq / items.length).toFixed(1)) : 0,
      totalFrp: Number(totalFrp.toFixed(1)),
      peakLabel: peak ? `${peak.monthLabel} ${peak.year} (${peak.modisEquivalent})` : "—",
      observedCount,
    };
  }, [
    calendarView,
    exportDays,
    exportMonths,
    activeDailySelection.length,
    selectedMonthlyKeys.length,
    eraFilter,
  ]);

  const handleExportCalendarCsv = () => {
    const stamp = generatedAt || harmSummary?.latestDate || "export";
    if (calendarView === "daily") {
      if (!exportDays.length) return;
      const selectionDesc = activeDailySelection.length
        ? `${activeDailySelection.length} selected days (${activeDailySelection.join(", ")})`
        : "All 14 daily periods";
      const headerNote = [
        `# Methods Note: SSOT Daily Fire Activity Calendar (Layer A Statistical + Layer B Optical/Temporal Reconciliation)`,
        `# Region: ${iso3} | Active Tab: ${activeTab} | Selection: ${selectionDesc} | Exported: ${stamp}`,
        `# Reference Unit: ${harmSummary?.unit || "MODIS-equivalent cell-days (1 km)"} | Transfer Ratio: ${harmValidation?.transferRatio ?? "N/A"} (${harmValidation?.method || "N/A"})`,
        `# Validation (LOO-CV): MAE=${harmValidation?.mae ?? "N/A"}, RMSE=${harmValidation?.rmse ?? "N/A"}, Bias=${harmValidation?.bias ?? "N/A"}, Quality=${harmValidation?.qualityFlag || "N/A"}`,
        `# SSOT Reconciliation: Coincident<=${ssot?.coincidentWindowMin ?? 90}m, DiurnalBridge<=${ssot?.bridgedWindowHours ?? 5.5}h, Non-additive FRP_M/Sum(FRP_V)=${ssot?.meanFrpRatio ?? "N/A"}`,
      ];
      const columns = [
        "date_utc",
        "day_of_week",
        "observed_modis_cell_days",
        "raw_viirs_cell_days",
        "calibrated_viirs",
        "modis_equivalent",
        "pi90_lower",
        "pi90_upper",
        "vs_14d_median_ratio",
        "source",
        "ssot_frp_mw",
        "modis_frp_mw",
        "viirs_frp_mw",
        "coincident_dual",
        "diurnal_bridged",
        "sub_resolution_viirs",
        "modis_gap_fill",
        "demoted_anomalies",
        "afternoon_share",
        "drift_detected",
      ].join(",");

      const med14 = Number(harmSummary?.median14d) || 0;
      const rows = exportDays.map((d) => {
        const ratio = med14 > 0 ? Number((d.modisEquivalent / med14).toFixed(2)) : "";
        return [
          csvCell(d.date),
          csvCell(dayOfWeekShort(d.date)),
          csvCell(d.modisCellDays),
          csvCell(d.viirsCellDays),
          csvCell(d.calibratedViirs),
          csvCell(d.modisEquivalent),
          csvCell(d.interval?.[0] ?? 0),
          csvCell(d.interval?.[1] ?? 0),
          csvCell(ratio),
          csvCell(d.source),
          csvCell(d.ssotFrpSum ?? d.totalFrpSum ?? 0),
          csvCell(d.modisFrpSum ?? 0),
          csvCell(d.viirsFrpSum ?? 0),
          csvCell(d.coincidentDual ?? 0),
          csvCell(d.diurnalBridged ?? 0),
          csvCell(d.subResolutionViirs ?? 0),
          csvCell(d.modisGapFill ?? 0),
          csvCell(d.demotedAnomalies ?? 0),
          csvCell(d.afternoonShare ?? ""),
          csvCell(d.driftDetected ? "true" : "false"),
        ].join(",");
      });

      triggerCsvDownload(
        `firewatch-${iso3.toLowerCase()}-calendar-14d-${activeDailySelection.length ? "selected" : "all"}.csv`,
        [...headerNote, columns, ...rows].join("\n"),
      );
      return;
    }

    if (!exportMonths.length) return;
    const selectionDesc = selectedMonthlyKeys.length
      ? `${selectedMonthlyKeys.length} selected months`
      : `All visible ${eraFilter} months (${exportMonths.length})`;
    const headerNote = [
      `# Methods Note: Multi-Decade Monthly Fire Activity Calendar (${climatology?.metadata?.span || "2001-2026"})`,
      `# Region: ${iso3} | Era Filter: ${eraFilter} | Selection: ${selectionDesc} | Exported: ${stamp}`,
      `# Archive Provenance: ${climatology?.metadata?.note || ""}`,
      `# Live FIRMS Observed Months: ${(climatology?.metadata?.observedLiveMonths || []).join(", ") || "None"}`,
      `# Reference Unit: MODIS-equivalent cell-days | Baselines use per-month out-of-sample median & IQR`,
    ];
    const columns = [
      "year_month",
      "year",
      "month",
      "month_label",
      "era",
      "modis_equivalent",
      "pi90_lower",
      "pi90_upper",
      "hist_month_median",
      "hist_month_iqr",
      "anomaly_ratio",
      "anomaly_delta",
      "percentile",
      "frp_sum_mw",
      "source",
      "is_observed_firms",
      "observed_days_in_window",
      "coverage_pct",
    ].join(",");

    const rows = exportMonths.map((c) =>
      [
        csvCell(c.key),
        csvCell(c.year),
        csvCell(c.month),
        csvCell(c.monthLabel),
        csvCell(c.era),
        csvCell(c.modisEquivalent),
        csvCell(c.interval?.[0] ?? 0),
        csvCell(c.interval?.[1] ?? 0),
        csvCell(c.median),
        csvCell(c.iqr),
        csvCell(c.anomalyRatio),
        csvCell(c.anomalyDelta),
        csvCell(c.percentile),
        csvCell(c.frpSum),
        csvCell(c.source),
        csvCell(c.isObservedFirms ? "true" : "false"),
        csvCell(c.observedDaysInWindow ?? 0),
        csvCell(c.coveragePct ?? ""),
      ].join(","),
    );

    triggerCsvDownload(
      `firewatch-${iso3.toLowerCase()}-calendar-monthly-${selectedMonthlyKeys.length ? "selected" : eraFilter}.csv`,
      [...headerNote, columns, ...rows].join("\n"),
    );
  };

  const handleExportSelectedHotspotsCsv = () => {
    if (!selectedHotspotsForExport.length) return;
    const stamp = generatedAt || harmSummary?.latestDate || "export";
    const scopeLabel =
      calendarView === "daily"
        ? activeDailySelection.length
          ? activeDailySelection.join(";")
          : "latest_window"
        : selectedMonthlyKeys.length
          ? selectedMonthlyKeys.join(";")
          : "loaded_14d";

    const headerNote = [
      `# Methods Note: SSOT Harmonized Hotspots Export (Lifecycle + GIFOV Optical Ellipse + 3-Regime Delta-t)`,
      `# Region: ${iso3} | Tab: ${activeTab} | Calendar Scope: ${scopeLabel} | Exported: ${stamp}`,
      `# Optical Containment: scan x track elliptical GIFOV with VIIRS 375m centroid lock & suppressed coarse MODIS in matches`,
      `# Consistency Filter: Tier 1=Dual, Tier 2=VIIRS 375m, Tier 3=MODIS Gap-Fill, Tier 4=Demoted/Low-Conf`,
    ];
    const columns = [
      "longitude",
      "latitude",
      "frp_mw",
      "sensor",
      "satellite",
      "confidence",
      "acq_datetime_utc",
      "ssot_tier",
      "ssot_regime",
      "scan_km",
      "track_km",
      "frp_ratio_modis_viirs",
      "matched_corroborations",
      "overpass_family",
      "fire_final",
    ].join(",");

    const rows = selectedHotspotsForExport.map((pt) => {
      const meta = pt?.[13] || null;
      const tierNum = Number(pt?.[8]) || 2;
      const tierLabel =
        tierNum === 1
          ? "Tier 1 (Dual-Confirmed)"
          : tierNum === 2
            ? "Tier 2 (VIIRS Solo)"
            : tierNum === 3
              ? "Tier 3 (MODIS Gap-Fill)"
              : "Tier 4 (Demoted/Low-Conf)";
      const isoTime = Number.isFinite(pt?.[5]) ? new Date(pt[5]).toISOString() : "";
      const defaultRes = pt?.[3] === 0 ? 1.0 : 0.375;
      return [
        csvCell(pt?.[0]),
        csvCell(pt?.[1]),
        csvCell(pt?.[2]),
        csvCell(pt?.[3] === 0 ? "MODIS" : "VIIRS"),
        csvCell(pt?.[10] ?? ""),
        csvCell(pt?.[9] ?? ""),
        csvCell(isoTime),
        csvCell(tierLabel),
        csvCell(meta?.regime ?? ""),
        csvCell(meta?.scan ?? defaultRes),
        csvCell(meta?.track ?? defaultRes),
        csvCell(meta?.frpRatio ?? ""),
        csvCell(Array.isArray(pt?.[11]) ? pt[11].length : 0),
        csvCell(meta?.overpassFamily ?? ""),
        csvCell(pt?.[12] ?? ""),
      ].join(",");
    });

    triggerCsvDownload(
      `firewatch-${iso3.toLowerCase()}-ssot-hotspots-${activeTab}.csv`,
      [...headerNote, columns, ...rows].join("\n"),
    );
  };

  if (!harmDaily.length && !monthlyCells.length) return null;

  return (
    <div className="calendar-panel" aria-label="Fire Activity Calendar View">
      <div className="calendar-head-row">
        <div className="calendar-view-switch" role="tablist" aria-label="Calendar timeframe view">
          <button
            type="button"
            role="tab"
            aria-selected={calendarView === "daily"}
            className={`calendar-tab-btn ${calendarView === "daily" ? "is-active" : ""}`}
            onClick={() => setCalendarView("daily")}
          >
            14D DAILY SSOT
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={calendarView === "monthly"}
            className={`calendar-tab-btn ${calendarView === "monthly" ? "is-active" : ""}`}
            onClick={() => setCalendarView("monthly")}
          >
            2001–26 MONTH×YEAR
          </button>
        </div>

        <div className="calendar-metric-switch" role="group" aria-label="Calendar metric">
          {[
            { id: "modis_eq", label: "MODIS-EQ" },
            { id: "frp", label: "FRP" },
            { id: "anomaly", label: "ANOM" },
            { id: "regimes", label: calendarView === "daily" ? "SSOT" : "ERA" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              className={`calendar-metric-btn ${metric === m.id ? "is-active" : ""}`}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {calendarView === "daily" ? (
        <div className="calendar-daily-section">
          <div className="calendar-toolbar">
            <div className="calendar-toolbar-left">
              <button
                type="button"
                className={`cal-mode-pill ${multiMode ? "is-active" : ""}`}
                onClick={() => setMultiMode((v) => !v)}
                title="Toggle multi-day selection (or Shift+click any two days for a range)"
              >
                {multiMode ? "✓ MULTI-DAY" : "MULTI-DAY"}
              </button>
              <button
                type="button"
                className="cal-quick-btn"
                onClick={() => pushDailySelectionToMap(allDailyDates)}
              >
                All 14d
              </button>
              <button
                type="button"
                className="cal-quick-btn"
                onClick={() =>
                  pushDailySelectionToMap(
                    harmDaily
                      .filter((d) => (d.modisEquivalent || 0) > 0 || (d.totalFrpSum || 0) > 0)
                      .map((d) => d.date),
                  )
                }
              >
                Active
              </button>
              {activeDailySelection.length > 0 && (
                <button
                  type="button"
                  className="cal-quick-btn cal-clear-btn"
                  onClick={() => pushDailySelectionToMap([])}
                >
                  Clear ×
                </button>
              )}
            </div>
            <span className="calendar-hint">Shift+click = range</span>
          </div>

          <div className="cal-daily-grid" role="grid" aria-label="14-day interactive fire activity calendar">
            {harmDaily.map((day) => {
              const isSelected = activeDailySet.has(day.date);
              const isUncertain =
                day.source === "calibrated_viirs" || harmValidation?.qualityFlag === "low_sparse";
              const med14 = Number(harmSummary?.median14d) || 0;
              const dayRatio = med14 > 0 ? day.modisEquivalent / med14 : day.modisEquivalent > 0 ? 2.0 : 1.0;

              let bgColor;
              let primaryVal;
              if (metric === "frp") {
                bgColor = cividisColor(day.totalFrpSum, maxDailyFrp);
                primaryVal = `${Math.round(day.totalFrpSum || 0)}`;
              } else if (metric === "anomaly") {
                bgColor = anomalyDivergingColor(dayRatio);
                primaryVal = `${num(dayRatio, 1)}×`;
              } else if (metric === "regimes") {
                const dualTotal = (day.coincidentDual || 0) + (day.diurnalBridged || 0);
                const viirsSub = day.subResolutionViirs || 0;
                const modisGap = day.modisGapFill || 0;
                const tot = dualTotal + viirsSub + modisGap;
                bgColor = tot > 0 ? "#1b2432" : "#14161d";
                primaryVal = `${tot}`;
              } else {
                bgColor = cividisColor(day.modisEquivalent, maxDailyModisEq);
                primaryVal = `${num(day.modisEquivalent, 0)}`;
              }

              const dualShare = ((day.coincidentDual || 0) + (day.diurnalBridged || 0)) / maxDailyRegimeTotal;
              const viirsShare = (day.subResolutionViirs || 0) / maxDailyRegimeTotal;
              const gapShare = (day.modisGapFill || 0) / maxDailyRegimeTotal;

              return (
                <button
                  key={day.date}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  className={`cal-day-card ${isSelected ? "is-selected" : ""} ${isUncertain ? "is-uncertain" : ""}`}
                  style={{ backgroundColor: bgColor }}
                  onClick={(e) => handleDailyCellClick(day, e)}
                  title={`${day.date} (${dayOfWeekShort(day.date)}) | MODIS-eq: ${day.modisEquivalent} [90% PI ${day.interval?.[0]}–${day.interval?.[1]}] | FRP: ${day.totalFrpSum} MW | Dual:${day.coincidentDual ?? 0} Bridged:${day.diurnalBridged ?? 0} VIIRS-Sub:${day.subResolutionViirs ?? 0} MODIS-Gap:${day.modisGapFill ?? 0} Demoted:${day.demotedAnomalies ?? 0}`}
                >
                  <span className="cal-day-dow">{dayOfWeekShort(day.date)}</span>
                  <span className="cal-day-num">{day.date.slice(8)}</span>
                  <strong className="cal-day-val">{primaryVal}</strong>
                  {metric === "regimes" && (
                    <span className="cal-regime-mini-bar" aria-hidden="true">
                      <i style={{ width: `${Math.round(dualShare * 100)}%`, background: "#fde047" }} />
                      <i style={{ width: `${Math.round(viirsShare * 100)}%`, background: "#ff6a32" }} />
                      <i style={{ width: `${Math.round(gapShare * 100)}%`, background: "#d97706" }} />
                    </span>
                  )}
                  {day.driftDetected && <span className="cal-drift-dot" title="Orbital drift detected" />}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-monthly-section">
          <div className="calendar-toolbar">
            <div className="calendar-toolbar-left">
              {[
                { id: "all", label: "2001–26" },
                { id: "overlap", label: "2012+ Overlap" },
                { id: "modis", label: "2001–11 MODIS" },
              ].map((ef) => (
                <button
                  key={ef.id}
                  type="button"
                  className={`cal-mode-pill ${eraFilter === ef.id ? "is-active" : ""}`}
                  onClick={() => setEraFilter(ef.id)}
                >
                  {ef.label}
                </button>
              ))}
            </div>
            <div className="calendar-toolbar-left">
              <button
                type="button"
                className="cal-quick-btn"
                onClick={() =>
                  setSelectedMonthlyKeys(
                    visibleMonthlyCells.filter((c) => c.percentile >= 80).map((c) => c.key),
                  )
                }
              >
                Peak≥P80
              </button>
              {selectedMonthlyKeys.length > 0 && (
                <button
                  type="button"
                  className="cal-quick-btn cal-clear-btn"
                  onClick={() => setSelectedMonthlyKeys([])}
                >
                  Clear ×
                </button>
              )}
            </div>
          </div>

          <div className="cal-matrix-scroll" role="grid" aria-label="Month by Year Harmonized Activity Calendar">
            <div className="cal-matrix-grid">
              <div className="cal-matrix-corner">YR</div>
              {(climatology?.months || []).map((mLabel, mIdx) => (
                <button
                  key={mLabel}
                  type="button"
                  className="cal-matrix-colhead"
                  onClick={() => handleToggleMonthColumn(mIdx + 1)}
                  title={`Click to select/unselect all ${mLabel} cells`}
                >
                  {mLabel}
                </button>
              ))}

              {[...filteredYears].reverse().map((year) => (
                <div key={year} className="cal-matrix-row">
                  <button
                    type="button"
                    className="cal-matrix-rowhead"
                    onClick={() => handleToggleYearRow(year)}
                    title={`Click to toggle all months in ${year}`}
                  >
                    {year}
                  </button>
                  {(climatology?.months || []).map((_, mIdx) => {
                    const ym = `${year}-${String(mIdx + 1).padStart(2, "0")}`;
                    const cell = monthlyCellMap.get(ym);
                    if (!cell) {
                      return <span key={ym} className="cal-mcell is-empty" aria-hidden="true" />;
                    }
                    const isSelected = selectedMonthSet.has(ym);
                    let bgColor;
                    if (metric === "frp") bgColor = cividisColor(cell.frpSum, maxMonthlyFrp);
                    else if (metric === "anomaly") bgColor = anomalyDivergingColor(cell.anomalyRatio);
                    else if (metric === "regimes") bgColor = eraRegimeColor(cell);
                    else bgColor = cividisColor(cell.modisEquivalent, maxMonthlyModisEq);

                    return (
                      <button
                        key={ym}
                        type="button"
                        role="gridcell"
                        aria-selected={isSelected}
                        className={`cal-mcell ${isSelected ? "is-selected" : ""} ${cell.isObservedFirms ? "is-observed-firms" : ""}`}
                        style={{ backgroundColor: bgColor }}
                        onClick={() => handleToggleMonthCell(ym)}
                        title={`${cell.monthLabel} ${cell.year} (${cell.era === "modis_era" ? "MODIS Era" : "Overlap Era"}) · MODIS-eq ${cell.modisEquivalent} [90% PI ${cell.interval?.[0]}–${cell.interval?.[1]}] · Hist Med ${cell.median} (${num(cell.anomalyRatio, 2)}× · P${cell.percentile}) · FRP ${cell.frpSum} MW${cell.isObservedFirms ? " · LIVE FIRMS" : " · Seasonal ref"}`}
                      />
                    );
                  })}
                </div>
              ))}

              <div className="cal-matrix-row cal-matrix-med-row">
                <span className="cal-matrix-rowhead">MED</span>
                {(climatology?.monthlyMedians || []).map((mm) => (
                  <span
                    key={mm.label}
                    className="cal-mcell-med"
                    title={`${mm.label} historical median: ${mm.median} (IQR ${mm.iqr})`}
                  >
                    {Math.round(mm.median)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="cal-provenance-note">
            Green-bordered cells = live/queried FIRMS window; historical cells show{" "}
            {climatology?.metadata?.span || "2001–2026"} seasonal regional baseline pending offline SP archive.
          </p>
        </div>
      )}

      <div className="cal-legend-row" aria-hidden="true">
        {metric === "anomaly" ? (
          <>
            <span>Low (&lt;0.5×)</span>
            <span className="anomaly-diverging-bar" />
            <span>Peak (&gt;2× Med)</span>
          </>
        ) : metric === "regimes" ? (
          calendarView === "daily" ? (
            <span className="cal-regime-key">
              <i style={{ background: "#fde047" }} /> Dual/Bridged ·{" "}
              <i style={{ background: "#ff6a32" }} /> VIIRS 375m ·{" "}
              <i style={{ background: "#d97706" }} /> MODIS Gap-Fill
            </span>
          ) : (
            <span className="cal-regime-key">
              <i style={{ background: "#3b82f6" }} /> MODIS 01–11 ·{" "}
              <i style={{ background: "#f59e0b" }} /> Overlap 12+ ·{" "}
              <i style={{ background: "#10b981" }} /> Live FIRMS
            </span>
          )
        ) : (
          <>
            <span>Low (0)</span>
            <span className="cividis-bar" />
            <span>
              Peak (
              {metric === "frp"
                ? `${Math.round(calendarView === "daily" ? maxDailyFrp : maxMonthlyFrp)} MW`
                : num(calendarView === "daily" ? maxDailyModisEq : maxMonthlyModisEq, 1)}
              )
            </span>
          </>
        )}
      </div>

      <div className="cal-selection-summary">
        <div className="cal-sum-cell">
          <span>SCOPE</span>
          <strong>{selectionSummary.label}</strong>
        </div>
        <div className="cal-sum-cell">
          <span>MODIS-EQ SUM</span>
          <strong>{selectionSummary.totalEq} (avg {selectionSummary.meanEq})</strong>
        </div>
        <div className="cal-sum-cell">
          <span>PEAK PERIOD</span>
          <strong>{selectionSummary.peakLabel}</strong>
        </div>
        <div className="cal-sum-cell">
          <span>TOTAL FRP / DET</span>
          <strong>{Math.round(selectionSummary.totalFrp)} MW · {selectedHotspotsForExport.length} det</strong>
        </div>
      </div>

      <div className="harm-export-row">
        <button
          type="button"
          className="harm-export-btn"
          onClick={handleExportCalendarCsv}
          disabled={calendarView === "daily" ? !exportDays.length : !exportMonths.length}
        >
          ↓ Export Selected Calendar CSV
        </button>
        <button
          type="button"
          className="harm-export-btn"
          onClick={handleExportSelectedHotspotsCsv}
          disabled={!selectedHotspotsForExport.length}
        >
          ↓ Export Selected Hotspots CSV
        </button>
      </div>
    </div>
  );
}

"use client";

import "./hud.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { animate, stagger } from "animejs";
import { prefersReducedMotion } from "./geo";
import HotspotRefresh from "./HotspotRefresh";
import ViewModeSwitch from "./ViewModeSwitch";
import TimelineControls from "./TimelineControls";
import CountryPicker from "./CountryPicker";

gsap.registerPlugin(useGSAP);

const format = (value) => Math.round(value).toLocaleString("en-US");
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, highlight }) {
  return (
    <div className={`hud-stat ${highlight ? "hud-stat-highlight" : ""}`}>
      <span className="hud-stat-value">
        <span data-count={value}>{format(value)}</span>
      </span>
      <span className="hud-stat-label">{label}</span>
    </div>
  );
}

function HudBody({ country, timelineStats }) {
  if (country?.status === "error") {
    return (
      <p className="hud-note">
        The satellite feed is unavailable for this region right now. The globe is still live —
        try again shortly.
      </p>
    );
  }
  if (country?.status !== "ready") {
    return (
      <div className="hud-stats" aria-busy="true">
        {[0, 1, 2, 3].map((slot) => (
          <div className="hud-stat hud-skeleton" key={slot} />
        ))}
      </div>
    );
  }

  const { stats } = country.data;
  const current = timelineStats || {
    total: stats.inside,
    active: stats.inside,
    extinguished: 0,
    dual: stats.dual || 0,
    maxFrp: stats.maxFrp,
    modis: stats.modis,
    viirs: stats.viirs,
    timeLabel: "LIVE (ROLLING 24H)",
  };

  return (
    <>
      <div className="hud-stats">
        <Stat label="DETECTIONS" value={current.total} />
        <Stat label="PEAK FRP · MW" value={current.maxFrp} />
        <Stat label="ACTIVE NOW" value={current.active} />
        <Stat label="PUT OUT" value={current.extinguished} highlight={current.extinguished > 0} />
      </div>
      <div className="hud-secondary-metrics">
        <span>MODIS: {format(current.modis)}</span>
        <span className="metric-divider">/</span>
        <span>VIIRS: {format(current.viirs)}</span>
        {current.dual > 0 && (
          <>
            <span className="metric-divider">/</span>
            <span className="metric-dual">★ {format(current.dual)} DUAL</span>
          </>
        )}
        <span className="metric-pill">{current.timeLabel}</span>
      </div>
      {current.total === 0 ? (
        <p className="hud-note">
          No thermal anomalies detected for this timeframe.
        </p>
      ) : (
        <div className="hud-legend" aria-hidden="true">
          <span>COOLER</span>
          <i />
          <span>HOTTER</span>
        </div>
      )}
      <p className="hud-updated">
        CHECKED {formatTime(stats.generatedAt)} · AUTO-REFRESH EVERY 30 MIN
      </p>
    </>
  );
}

function CountrySidebar({
  active, open, onToggle, canExit, country, onBack, viewMode, switching, onChangeView,
  onData, onRefreshError, onRefreshStart, onFilterChange, onQueryDate, onSelectCountry,
}) {
  const rootRef = useRef(null);
  const ready = country?.status === "ready";
  const [timelineStats, setTimelineStats] = useState(null);
  const [prevIso3, setPrevIso3] = useState(country?.iso3);

  // Reset timeline filter when switching country
  if (country?.iso3 !== prevIso3) {
    setPrevIso3(country?.iso3);
    setTimelineStats(null);
  }

  const handleFilteredPoints = useCallback((points, stats) => {
    setTimelineStats(stats);
    onFilterChange?.(points);
  }, [onFilterChange]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const media = gsap.matchMedia();
      media.add("(max-width: 1000px)", () =>
        gsap.from(".sidebar-panel", { y: 40, duration: 0.65, ease: "power3.out", clearProps: "transform" }),
      );
      media.add("(min-width: 1001px)", () =>
        gsap.from(".sidebar-panel", { x: -40, duration: 0.65, ease: "power3.out", clearProps: "transform" }),
      );
      return () => media.revert();
    },
    { scope: rootRef },
  );

  // Anime.js: numbers count up while their masked cells rise into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready || prefersReducedMotion()) return;

    const animations = [
      animate(root.querySelectorAll(".hud-stat-value > span"), {
        y: ["110%", "0%"],
        delay: stagger(110, { start: 600 }),
        duration: 900,
        ease: "outExpo",
      }),
    ];
    root.querySelectorAll("[data-count]").forEach((element) => {
      const end = Number(element.dataset.count);
      const counter = { value: 0 };
      animations.push(
        animate(counter, {
          value: end,
          delay: 600,
          duration: 1600,
          ease: "outExpo",
          onUpdate: () => {
            element.firstChild.nodeValue = format(counter.value);
          },
        }),
      );
    });
    return () => animations.forEach((animation) => animation.pause());
  }, [ready, country?.iso3, country?.data?.stats?.generatedAt]);

  return (
    <aside
      ref={rootRef}
      className="country-sidebar"
      data-active={active}
      data-open={open}
      aria-label="Hotspot statistics"
      aria-hidden={!active}
    >
      <button
        type="button"
        className="sidebar-toggle"
        aria-controls="country-sidebar-panel"
        aria-expanded={open}
        onClick={onToggle}
        disabled={!active}
      >
        <span className="sidebar-toggle-icon" aria-hidden="true">{open ? "−" : "+"}</span>
        {open ? "Hide panel" : "Show panel"}
      </button>
      <div id="country-sidebar-panel" className="sidebar-panel" inert={!active || !open}>
        <div className="sidebar-controls">
          <ViewModeSwitch enabled={canExit && !switching} mode={viewMode} onChange={onChangeView} />
          <HotspotRefresh
            iso3={country?.iso3}
            enabled={canExit}
            switching={switching}
            onData={onData}
            onError={onRefreshError}
            onRefreshStart={onRefreshStart}
          />
          <CountryPicker
            currentIso3={country?.iso3}
            onSelectCountry={onSelectCountry}
            disabled={!canExit || switching}
          />
        </div>
        <div aria-live="polite">
          <p className="hud-eyebrow">
            <i aria-hidden="true" />
            {country?.located ? "YOUR REGION · FROM DEVICE LOCATION" : "DEFAULT REGION · LOCATION UNAVAILABLE"}
          </p>
          <h2 className="hud-title">{country?.name ?? "—"}</h2>
          <p className="hud-sub">Thermal detections · MODIS + VIIRS · last 24 h</p>
          {ready && (
            <TimelineControls
              rawPoints={country?.data?.points}
              onFiltered={handleFilteredPoints}
              onQueryDate={onQueryDate}
              disabled={!canExit || switching}
            />
          )}
          <HudBody country={country} timelineStats={timelineStats} />
        </div>
        <button type="button" className="hud-back" onClick={onBack} disabled={!canExit || switching}>
          <span aria-hidden="true">←</span> Back to orbit
        </button>
      </div>
    </aside>
  );
}

export default CountrySidebar;

"use client";

import "./hud.css";
import { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { animate, stagger } from "animejs";
import { prefersReducedMotion } from "./geo";

gsap.registerPlugin(useGSAP);

const format = (value) => Math.round(value).toLocaleString("en-US");
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Stat({ label, value }) {
  return (
    <div className="hud-stat">
      <span className="hud-stat-value">
        <span data-count={value}>{format(value)}</span>
      </span>
      <span className="hud-stat-label">{label}</span>
    </div>
  );
}

function HudBody({ country }) {
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
  return (
    <>
      <div className="hud-stats">
        <Stat label="DETECTIONS" value={stats.inside} />
        <Stat label="PEAK FRP · MW" value={stats.maxFrp} />
        <Stat label="MODIS" value={stats.modis} />
        <Stat label="VIIRS" value={stats.viirs} />
      </div>
      {stats.inside === 0 ? (
        <p className="hud-note">
          No thermal anomalies in the last 24 hours — or the next satellite pass hasn&apos;t landed yet.
        </p>
      ) : (
        <div className="hud-legend" aria-hidden="true">
          <span>COOLER</span>
          <i />
          <span>HOTTER</span>
        </div>
      )}
      {stats.context > 0 && (
        <p className="hud-context">+{format(stats.context)} dimmer detections just across the border</p>
      )}
      <p className="hud-updated">
        CHECKED {formatTime(stats.generatedAt)} · AUTO-REFRESH EVERY 30 MIN
      </p>
    </>
  );
}

// Country readout that slides in once the globe starts its descent.
function CountryHud({ open, canExit, country, onBack }) {
  const rootRef = useRef(null);
  const ready = country?.status === "ready";

  useGSAP(
    () => {
      const root = rootRef.current;
      if (prefersReducedMotion()) {
        gsap.set(root, { visibility: open ? "visible" : "hidden" });
        return;
      }
      if (open) {
        gsap.fromTo(
          root,
          { visibility: "visible", clipPath: "inset(0 100% 0 0)", x: -44 },
          {
            clipPath: "inset(0 0% 0 0)",
            x: 0,
            duration: 0.9,
            delay: 0.5,
            ease: "power3.out",
            onComplete: () => gsap.set(root, { clearProps: "clipPath,transform" }),
          },
        );
      } else if (root.style.visibility === "visible") {
        gsap.to(root, {
          clipPath: "inset(0 100% 0 0)",
          x: -30,
          duration: 0.5,
          ease: "power3.in",
          onComplete: () => gsap.set(root, { visibility: "hidden" }),
        });
      }
    },
    { scope: rootRef, dependencies: [open] },
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
  }, [ready, country?.iso3]);

  return (
    <aside ref={rootRef} className="country-hud" aria-live="polite" aria-hidden={!open}>
      <p className="hud-eyebrow">
        <i aria-hidden="true" />
        {country?.located ? "YOUR REGION · FROM DEVICE LOCATION" : "DEFAULT REGION · LOCATION UNAVAILABLE"}
      </p>
      <h2 className="hud-title">{country?.name ?? "—"}</h2>
      <p className="hud-sub">Thermal detections · MODIS + VIIRS · last 24 h</p>
      <HudBody country={country} />
      <button type="button" className="hud-back" onClick={onBack} disabled={!canExit} tabIndex={open ? 0 : -1}>
        <span aria-hidden="true">←</span> Back to orbit
      </button>
    </aside>
  );
}

export default CountryHud;

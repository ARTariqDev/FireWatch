"use client";

import "./hero/hero.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import GlobeReadout from "./globe/GlobeReadout";
import GlobeStage from "./globe/GlobeStage";
import ViewModeSwitch from "./globe/ViewModeSwitch";
import { DEFAULT_COUNTRY, fetchCountryHotspots, locateUser, resolveCountry } from "./globe/geo";
import { useHotspotPolling } from "./globe/useHotspotPolling";
import HeroBackdrop from "./hero/HeroBackdrop";
import HeroCopy from "./hero/HeroCopy";
import HeroFooter from "./hero/HeroFooter";
import HeroNav from "./hero/HeroNav";

// The readout card (and Anime.js with it) is only needed after the first click, so it loads on demand.
const loadHud = () => import("./globe/CountryHud");
const CountryHud = dynamic(loadHud, { ssr: false });

// phase: orbit -> locating -> flying -> country -> returning -> orbit
function Hero() {
  const globeRef = useRef(null);
  const slotRef = useRef(null);
  const [phase, setPhase] = useState("orbit");
  const [feed, setFeed] = useState({ status: "preview" });
  const [country, setCountry] = useState(null);
  const [viewMode, setViewMode] = useState("3d");
  const [switching, setSwitching] = useState(false);

  // Warm the HUD chunk shortly after load so it appears instantly on click.
  useEffect(() => {
    const timer = setTimeout(loadHud, 2500);
    return () => clearTimeout(timer);
  }, []);

  const viewHotspots = useCallback(async () => {
    setPhase("locating");

    // Browser permission prompt; declining (or any failure) falls back to the default country.
    const position = await locateUser();
    const detected = position ? await resolveCountry(position) : null;
    const target = detected ?? DEFAULT_COUNTRY;

    setViewMode("3d");
    setCountry({ status: "loading", iso3: target.iso3, name: target.name, located: Boolean(detected) });
    setPhase("flying");

    const update = (change) =>
      setCountry((current) => (current?.iso3 === target.iso3 ? { ...current, ...change } : current));
    const request = fetchCountryHotspots(target.iso3).then(
      (data) => {
        update({ status: "ready", name: data.country.name, data });
        return data;
      },
      () => {
        update({ status: "error" });
        return null;
      },
    );

    const arrived = await globeRef.current?.flyToCountry({
      iso3: target.iso3,
      focus: detected ? position : DEFAULT_COUNTRY.center,
      request,
    });

    // The globe never started (e.g. the map failed to load): fall back to the landing state.
    if (!arrived) {
      setCountry(null);
      setPhase("orbit");
      return;
    }
    setPhase("country");
  }, []);

  const backToOrbit = useCallback(async () => {
    setPhase("returning");
    await globeRef.current?.returnToOrbit();
    setCountry(null);
    setPhase("orbit");
  }, []);

  const changeView = useCallback(async (mode) => {
    setSwitching(true);
    setViewMode(mode);
    await globeRef.current?.setViewMode(mode);
    setSwitching(false);
  }, []);

  // Fresh detections arrive every few hours; re-check every 30 minutes while a country is open.
  const applyRefresh = useCallback((data) => {
    setCountry((current) =>
      current?.iso3 === data.country.iso3
        ? { ...current, status: "ready", name: data.country.name, data }
        : current,
    );
    globeRef.current?.updateHotspots(data.points);
  }, []);
  useHotspotPolling({ iso3: country?.iso3, enabled: phase === "country", onData: applyRefresh });

  const expanded = phase === "flying" || phase === "country";

  return (
    <main className="firewatch-shell">
      <section
        className="firewatch-hero"
        data-phase={phase}
        data-expanded={expanded}
        aria-labelledby="firewatch-title"
      >
        <GlobeStage ref={globeRef} slotRef={slotRef} onFeed={setFeed} />
        <HeroBackdrop />

        <div className="firewatch-frame">
          <HeroNav />
          <div className="hero-main-grid">
            <HeroCopy phase={phase} onViewHotspots={viewHotspots} />
            <div ref={slotRef} className="globe-slot">
              <GlobeReadout status={feed.status} />
            </div>
          </div>
          <HeroFooter />
        </div>

        <ViewModeSwitch
          visible={expanded}
          enabled={phase === "country" && !switching}
          mode={viewMode}
          onChange={changeView}
        />
        {country && (
          <CountryHud open={expanded} canExit={phase === "country"} country={country} onBack={backToOrbit} />
        )}
      </section>
    </main>
  );
}

export default Hero;

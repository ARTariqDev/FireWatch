"use client";

import "./hero/hero.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import GlobeReadout from "./globe/GlobeReadout";
import GlobeStage from "./globe/GlobeStage";
import { DEFAULT_COUNTRY, fetchCountryBounds, fetchCountryHotspots, locateUser, resolveCountry } from "./globe/geo";
import HeroBackdrop from "./hero/HeroBackdrop";
import HeroCopy from "./hero/HeroCopy";
import HeroFooter from "./hero/HeroFooter";
import HeroNav from "./hero/HeroNav";

// The sidebar (and Anime.js with it) is only needed after the first click, so it loads on demand.
const loadSidebar = () => import("./globe/CountrySidebar");
const CountrySidebar = dynamic(loadSidebar, { ssr: false });

// phase: orbit -> locating -> flying -> country -> returning -> orbit
function Hero() {
  const globeRef = useRef(null);
  const slotRef = useRef(null);
  const requestRef = useRef(null);
  const [phase, setPhase] = useState("orbit");
  const [feed, setFeed] = useState({ status: "preview" });
  const [country, setCountry] = useState(null);
  const [viewMode, setViewMode] = useState("3d");
  const [switching, setSwitching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Warm the sidebar chunk shortly after load so it appears instantly on click.
  useEffect(() => {
    const timer = setTimeout(loadSidebar, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  const viewHotspots = useCallback(async () => {
    setPhase("locating");

    // Browser permission prompt; declining (or any failure) falls back to the default country.
    const position = await locateUser();
    const detected = position ? await resolveCountry(position) : null;
    const target = detected ?? DEFAULT_COUNTRY;

    setViewMode("3d");
    setSidebarOpen(true);
    setCountry({ status: "loading", iso3: target.iso3, name: target.name, located: Boolean(detected) });
    setPhase("flying");

    const controller = new AbortController();
    requestRef.current = controller;
    const update = (change) =>
      setCountry((current) =>
        !controller.signal.aborted && current?.iso3 === target.iso3 ? { ...current, ...change } : current,
      );
    const request = fetchCountryHotspots(target.iso3, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) update({ status: "ready", name: data.country.name, data });
        return data;
      },
      () => {
        if (!controller.signal.aborted) update({ status: "error" });
        return null;
      },
    );
    const bounds = fetchCountryBounds(target.iso3, controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error("Country bounds request failed:", error);
      return request.then((data) => data?.country?.bbox ?? null);
    });

    const arrived = await globeRef.current?.flyToCountry({
      iso3: target.iso3,
      focus: detected ? position : DEFAULT_COUNTRY.center,
      request,
      bounds,
    });

    // The globe never started (e.g. the map failed to load): fall back to the landing state.
    if (!arrived) {
      controller.abort();
      setCountry(null);
      setPhase("orbit");
      return;
    }
    setPhase("country");
  }, []);

  const backToOrbit = useCallback(async () => {
    setPhase("returning");
    requestRef.current?.abort();
    requestRef.current = null;
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
    globeRef.current?.updateHotspots(data.points, data.country);
  }, []);
  const handleRefreshError = useCallback(() => {
    setCountry((current) => current?.status === "loading" ? { ...current, status: "error" } : current);
  }, []);
  const cancelInitialRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const handleFilterChange = useCallback((filteredPoints) => {
    globeRef.current?.updateHotspots(filteredPoints);
  }, []);

  const handleQueryDate = useCallback(
    async (options) => {
      if (!country?.iso3) return null;
      try {
        const data = await fetchCountryHotspots(country.iso3, null, false, options);
        if (data) {
          setCountry((current) => ({ ...current, status: "ready", data }));
          globeRef.current?.updateHotspots(data.points, data.country);
        }
        return data;
      } catch (err) {
        console.error("Failed to query historical dates:", err);
        return null;
      }
    },
    [country],
  );

  const expanded = phase === "flying" || phase === "country";

  return (
    <main className="firewatch-shell">
      <section
        className="firewatch-hero"
        data-phase={phase}
        data-expanded={expanded}
        data-sidebar-open={sidebarOpen}
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

        {country && (
          <CountrySidebar
            active={expanded}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((current) => !current)}
            canExit={phase === "country"}
            country={country}
            onBack={backToOrbit}
            viewMode={viewMode}
            switching={switching}
            onChangeView={changeView}
            onData={applyRefresh}
            onRefreshError={handleRefreshError}
            onRefreshStart={cancelInitialRequest}
            onFilterChange={handleFilterChange}
            onQueryDate={handleQueryDate}
          />
        )}
      </section>
    </main>
  );
}

export default Hero;

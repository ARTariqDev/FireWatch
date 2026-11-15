"use client";

import "./hero/hero.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlobeReadout from "./globe/GlobeReadout";
import GlobeStage from "./globe/GlobeStage";
import OnMapFireHud from "./globe/OnMapFireHud";
import { DEFAULT_COUNTRY, fetchCountryBounds, fetchCountryHotspots, locateUser, resolveCountry } from "./globe/geo";
import HeroBackdrop from "./hero/HeroBackdrop";
import HeroCopy from "./hero/HeroCopy";
import HeroFooter from "./hero/HeroFooter";
import HeroNav from "./hero/HeroNav";

// The sidebar (and Anime.js with it) is only needed after the first click, so it loads on demand.
const loadSidebar = () => import("./globe/CountrySidebar");
const CountrySidebar = dynamic(loadSidebar, { ssr: false });

function approxDistanceKm(lat1, lon1, lat2, lon2) {
  const avgLatRad = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(avgLatRad);
  return Math.hypot(dLat, dLon);
}

function findMatchingFireEvent(events, input) {
  if (!events?.length || input === null || input === undefined) return null;
  const rawId = typeof input === "object" ? input.fireId : input;
  if (rawId !== null && rawId !== undefined && rawId !== "") {
    const exact = events.find((e) => String(e.fire?.fire_final) === String(rawId));
    if (exact) return exact;
  }

  if (
    typeof input === "object" &&
    Number.isFinite(input.lng) &&
    Number.isFinite(input.lat)
  ) {
    let bestEvent = null;
    let bestDistKm = 25;
    for (const ev of events) {
      const fLat = Number(ev.fire?.lat);
      const fLon = Number(ev.fire?.lon);
      if (Number.isFinite(fLat) && Number.isFinite(fLon)) {
        const dKm = approxDistanceKm(input.lat, input.lng, fLat, fLon);
        if (dKm < bestDistKm) {
          bestDistKm = dKm;
          bestEvent = ev;
        }
      }
      for (const det of ev.detections || []) {
        const dLat = Number(det.lat ?? det.latitude);
        const dLon = Number(det.lon ?? det.longitude);
        if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) continue;
        const dKm = approxDistanceKm(input.lat, input.lng, dLat, dLon);
        if (dKm < bestDistKm) {
          bestDistKm = dKm;
          bestEvent = ev;
        }
      }
    }
    return bestEvent;
  }

  return null;
}

// phase: orbit -> locating -> flying -> country -> returning -> orbit
function Hero() {
  const globeRef = useRef(null);
  const slotRef = useRef(null);
  const requestRef = useRef(null);
  const [phase, setPhase] = useState("orbit");
  const [feed, setFeed] = useState({ status: "preview" });
  const [country, setCountry] = useState(null);
  const [viewMode, setViewMode] = useState("2d");
  const [switching, setSwitching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("combined");
  const [selectedFireId, setSelectedFireId] = useState(null);
  const [hoveredHit, setHoveredHit] = useState(null);
  const [onDemandCache, setOnDemandCache] = useState({});

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

    setViewMode("2d");
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
    setSelectedFireId(null);
    setHoveredHit(null);
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
    setSelectedFireId(null);
    setHoveredHit(null);
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

  const handleFocusFire = useCallback((target) => {
    globeRef.current?.focusFire(target);
  }, []);

  const countryData = country?.data;
  const tabs = countryData?.tabs;
  const activeTabData = useMemo(() => {
    if (!countryData) return null;
    return (
      tabs?.[activeTab] || {
        id: activeTab,
        stats: countryData.stats,
        points: countryData.points || [],
        geojson: countryData.eventsGeoJson,
        fire_events: countryData.events || [],
        predictionsGeoJson: null,
        modelSummary: null,
        metadata: {},
      }
    );
  }, [countryData, tabs, activeTab]);

  const sortedEvents = useMemo(() => {
    const list = activeTabData?.fire_events || [];
    return [...list].sort((a, b) => {
      const expA = a.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      const expB = b.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      if (expB !== expA) return expB - expA;
      const hazA = a.hazard?.hazard_score ?? -1;
      const hazB = b.hazard?.hazard_score ?? -1;
      if (hazB !== hazA) return hazB - hazA;
      return Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0);
    });
  }, [activeTabData]);

  const selectedRawEvent = useMemo(() => {
    if (selectedFireId === null || selectedFireId === undefined) return null;
    return (
      (activeTabData?.fire_events || []).find(
        (e) => String(e.fire?.fire_final) === String(selectedFireId),
      ) || null
    );
  }, [activeTabData, selectedFireId]);

  const generatedAt = activeTabData?.stats?.generatedAt || "";
  const selectedCacheKey = selectedRawEvent?.fire
    ? `${country?.iso3 || ""}:${generatedAt}:${activeTab}:${selectedRawEvent.fire.fire_final}`
    : null;
  const onDemandEntry = selectedCacheKey ? onDemandCache[selectedCacheKey] : undefined;

  const selectedPredictionFeatures = useMemo(() => {
    if (!selectedRawEvent?.fire) return [];
    if (onDemandEntry?.predictionGeoJson?.features?.length) {
      return onDemandEntry.predictionGeoJson.features;
    }
    const fireIdStr = String(selectedRawEvent.fire.fire_final);
    const fromActive = (activeTabData?.predictionsGeoJson?.features || []).filter(
      (f) => String(f?.properties?.event_id) === fireIdStr,
    );
    if (fromActive.length) return fromActive;

    if (activeTab === "combined" && selectedRawEvent.viirs_fire_final != null) {
      const viirsIdStr = String(selectedRawEvent.viirs_fire_final);
      return (tabs?.viirs?.predictionsGeoJson?.features || []).filter(
        (f) => String(f?.properties?.event_id) === viirsIdStr,
      );
    }
    return [];
  }, [selectedRawEvent, onDemandEntry, activeTabData, activeTab, tabs]);

  const hydratedSelectedFireEvent = useMemo(() => {
    if (!selectedRawEvent) return null;
    return {
      ...selectedRawEvent,
      hazard: selectedRawEvent.hazard || onDemandEntry?.hazard || null,
      prediction: selectedRawEvent.prediction || onDemandEntry?.prediction || null,
    };
  }, [selectedRawEvent, onDemandEntry]);

  const hasViirsSupport = Boolean(
    selectedRawEvent?.fire &&
      (activeTab === "viirs" ||
        (activeTab === "combined" &&
          (selectedRawEvent.fire.satellites || []).some((s) =>
            String(s).toUpperCase().includes("VIIRS"),
          ))),
  );

  const needsModelFetch = Boolean(
    country?.status === "ready" &&
      selectedRawEvent?.fire &&
      hasViirsSupport &&
      (!selectedRawEvent.hazard ||
        !selectedRawEvent.prediction ||
        !selectedPredictionFeatures.length) &&
      !onDemandEntry?.fetched,
  );

  useEffect(() => {
    if (!needsModelFetch || !selectedRawEvent?.fire || !selectedCacheKey) return;

    const controller = new AbortController();
    fetch("/api/fire-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        fire_event: { fire: selectedRawEvent.fire, detections: selectedRawEvent.detections },
        include_hazard: !selectedRawEvent.hazard,
        include_prediction: !selectedRawEvent.prediction || !selectedPredictionFeatures.length,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        setOnDemandCache((prev) => ({
          ...prev,
          [selectedCacheKey]: {
            hazard: data?.hazard ?? null,
            prediction: data?.prediction ?? null,
            predictionGeoJson: data?.predictionGeoJson ?? null,
            fetched: true,
          },
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOnDemandCache((prev) => ({
            ...prev,
            [selectedCacheKey]: {
              hazard: null,
              prediction: null,
              predictionGeoJson: null,
              fetched: true,
            },
          }));
        }
      });

    return () => controller.abort();
  }, [needsModelFetch, selectedRawEvent, selectedCacheKey, selectedPredictionFeatures.length]);

  useEffect(() => {
    if (country?.status !== "ready" || !activeTabData) return;
    globeRef.current?.updateTrackerOverlay({
      trackedGeoJson: activeTabData.geojson,
      predictionsGeoJson: activeTabData.predictionsGeoJson || null,
      selectedFireId,
      selectedFireEvent: hydratedSelectedFireEvent,
      selectedPredictionFeatures,
      activeTab,
    });
  }, [
    country?.status,
    activeTabData,
    activeTab,
    selectedFireId,
    hydratedSelectedFireEvent,
    selectedPredictionFeatures,
  ]);

  const handleSelectFire = useCallback(
    (input) => {
      if (input === null || input === undefined) {
        setSelectedFireId(null);
        return;
      }
      const events = activeTabData?.fire_events || [];
      const matched = findMatchingFireEvent(events, input);
      if (matched?.fire) {
        setSelectedFireId(matched.fire.fire_final);
        setHoveredHit(null);
        globeRef.current?.focusFire({
          lng: matched.fire.lon,
          lat: matched.fire.lat,
          areaKm2: matched.fire.area_km2,
        });
        return;
      }
      const fallbackId = typeof input === "object" ? input.fireId : input;
      if (fallbackId !== null && fallbackId !== undefined) {
        setSelectedFireId(fallbackId);
      }
      if (
        typeof input === "object" &&
        Number.isFinite(input.lng) &&
        Number.isFinite(input.lat)
      ) {
        globeRef.current?.focusFire({ lng: input.lng, lat: input.lat, areaKm2: 0.5 });
      }
    },
    [activeTabData],
  );

  const handleClearFire = useCallback(() => {
    setSelectedFireId(null);
    setHoveredHit(null);
    globeRef.current?.resetCountryView(country?.data?.country?.bbox);
  }, [country?.data?.country?.bbox]);

  const handleSelectTab = useCallback((tabId) => {
    setActiveTab(tabId);
    setSelectedFireId(null);
    setHoveredHit(null);
  }, []);

  const selectCountry = useCallback(
    async (target) => {
      if (!target?.iso3) return;
      if (country?.iso3 === target.iso3) return;

      setSelectedFireId(null);
      setHoveredHit(null);
      requestRef.current?.abort();
      setPhase("flying");
      setCountry({ status: "loading", iso3: target.iso3, name: target.name || target.iso3, located: false });

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

      const focus = target.center
        ? Array.isArray(target.center)
          ? { lng: target.center[0], lat: target.center[1] }
          : { lng: target.center.lng, lat: target.center.lat }
        : { lng: 0, lat: 20 };

      const arrived = await globeRef.current?.flyToCountry({
        iso3: target.iso3,
        focus,
        request,
        bounds,
      });

      if (!arrived) {
        if (!controller.signal.aborted) {
          controller.abort();
          setPhase("country");
        }
        return;
      }
      setPhase("country");
    },
    [country?.iso3],
  );

  const handleQueryDate = useCallback(
    async (options) => {
      if (!country?.iso3) return null;
      try {
        const data = await fetchCountryHotspots(country.iso3, null, false, options);
        if (data) {
          setSelectedFireId(null);
          setHoveredHit(null);
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
        <GlobeStage
          ref={globeRef}
          slotRef={slotRef}
          onFeed={setFeed}
          onSelectFire={handleSelectFire}
          onHoverFire={setHoveredHit}
        />
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

        {expanded && country?.status === "ready" && (
          <OnMapFireHud
            activeTab={activeTab}
            sortedEvents={sortedEvents}
            selectedFireEvent={hydratedSelectedFireEvent}
            isLoadingModels={needsModelFetch}
            hoveredHit={hoveredHit}
            onSelectFire={handleSelectFire}
            onFocusFire={handleFocusFire}
            onClearFire={handleClearFire}
          />
        )}

        {country && (
          <CountrySidebar
            active={expanded}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((current) => !current)}
            canExit={phase === "country"}
            country={country}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            activeTabData={activeTabData}
            sortedEvents={sortedEvents}
            onDemandCache={onDemandCache}
            onBack={backToOrbit}
            viewMode={viewMode}
            switching={switching}
            onChangeView={changeView}
            onData={applyRefresh}
            onRefreshError={handleRefreshError}
            onRefreshStart={cancelInitialRequest}
            onFilterChange={handleFilterChange}
            onFocusFire={handleFocusFire}
            selectedFireId={selectedFireId}
            onSelectFire={handleSelectFire}
            onQueryDate={handleQueryDate}
            onSelectCountry={selectCountry}
          />
        )}
      </section>
    </main>
  );
}

export default Hero;

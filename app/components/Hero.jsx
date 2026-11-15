"use client";

import "./hero/hero.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pointMatchesTierFilter } from "@/lib/hotspot-data";
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

function detectionMsFromEvent(det) {
  if (!det) return NaN;
  if (typeof det._acquired === "number" && Number.isFinite(det._acquired)) return det._acquired;
  if (typeof det.acq_datetime_utc === "string") {
    const trimmed = det.acq_datetime_utc.trim();
    const norm = /Z$|[+-]\d{2}:?\d{2}$/i.test(trimmed)
      ? trimmed
      : `${trimmed.replace(" ", "T")}Z`;
    const parsed = Date.parse(norm);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function eventMatchesFilter(event, filterWindow) {
  if (!event?.fire) return false;
  if (!filterWindow) return true;
  const tierFilter = filterWindow.tierFilter || "all";
  const hasRange = Number.isFinite(filterWindow.minTime) && Number.isFinite(filterWindow.maxTime);
  const sats = Array.isArray(event.fire.satellites) ? event.fire.satellites : [];
  const hasModisSat = sats.some((s) => String(s).toUpperCase().includes("MODIS"));
  const hasViirsSat = sats.some((s) => String(s).toUpperCase().includes("VIIRS"));
  const fireIsDual = hasModisSat && hasViirsSat;

  if (tierFilter === "dual_only" && !fireIsDual) {
    return false;
  }

  const dets = Array.isArray(event.detections) ? event.detections : [];
  if (!dets.length) {
    const fallbackMs = Date.parse(event.fire.last_detection_utc || "");
    if (hasRange && Number.isFinite(fallbackMs)) {
      return fallbackMs >= filterWindow.minTime && fallbackMs <= filterWindow.maxTime;
    }
    return true;
  }

  for (const det of dets) {
    const acq = detectionMsFromEvent(det);
    if (hasRange && Number.isFinite(acq)) {
      if (acq < filterWindow.minTime || acq > filterWindow.maxTime) continue;
    }
    if (tierFilter === "all") return true;
    const satId = String(det.satellite_id || det.sat || det.instrument || "").toUpperCase();
    const isModis =
      String(det.instrument || "").toUpperCase() === "MODIS" || satId.startsWith("MODIS");
    const sensor = isModis ? 0 : 1;
    const tier = fireIsDual ? 1 : sensor === 1 ? 2 : 3;
    const evidence = fireIsDual ? 3 : 0;
    if (
      pointMatchesTierFilter(
        [
          det.lon ?? det.longitude,
          det.lat ?? det.latitude,
          det.frp ?? 0,
          sensor,
          1,
          acq,
          null,
          evidence,
          tier,
          det.confidence,
          det.satellite ?? det.satellite_id ?? det.sat ?? null,
        ],
        tierFilter,
      )
    ) {
      return true;
    }
  }
  return false;
}

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
  const [filterWindow, setFilterWindow] = useState(null);
  const [fireListScope, setFireListScope] = useState("recent"); // "recent" | "past"
  const [selectedDay, setSelectedDay] = useState(null);

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
    setFilterWindow(null);
    setSelectedDay(null);
    setFireListScope("recent");
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
    setFilterWindow(null);
    setSelectedDay(null);
    setFireListScope("recent");
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

  const handleFilterChange = useCallback((filteredPoints, _stats, nextWindow) => {
    globeRef.current?.updateHotspots(filteredPoints);
    setFilterWindow(nextWindow || null);
  }, []);

  const handleSelectDay = useCallback((dateStr) => {
    setSelectedDay((prev) => (dateStr && prev === dateStr ? null : dateStr || null));
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
        points14d: countryData.points14d || countryData.points || [],
        geojson: countryData.eventsGeoJson,
        all_geojson: countryData.allEventsGeoJson || countryData.eventsGeoJson,
        fire_events: countryData.events || [],
        past_fire_events: countryData.pastEvents || [],
        predictionsGeoJson: null,
        pastPredictionsGeoJson: null,
        modelSummary: null,
        metadata: {},
      }
    );
  }, [countryData, tabs, activeTab]);

  const allTabEvents = useMemo(
    () => [
      ...(activeTabData?.fire_events || []),
      ...(activeTabData?.past_fire_events || []),
    ],
    [activeTabData],
  );

  const sortedEvents = useMemo(() => {
    const recentList = activeTabData?.fire_events || [];
    const pastList = activeTabData?.past_fire_events || [];
    const isHistoricalWindow = Boolean(filterWindow?.isHistorical);
    const tierFilter = filterWindow?.tierFilter || "all";

    let list;
    if (isHistoricalWindow) {
      const pool = fireListScope === "past" ? pastList : [...recentList, ...pastList];
      list = pool.filter((ev) => eventMatchesFilter(ev, filterWindow));
    } else if (fireListScope === "past") {
      list =
        tierFilter === "all"
          ? pastList
          : pastList.filter((ev) => eventMatchesFilter(ev, { tierFilter }));
    } else {
      list =
        tierFilter === "all"
          ? recentList
          : recentList.filter((ev) => eventMatchesFilter(ev, { tierFilter }));
    }

    return [...list].sort((a, b) => {
      if (fireListScope === "past") {
        const multiA = a.hindcast?.isMultiPass ? 1 : 0;
        const multiB = b.hindcast?.isMultiPass ? 1 : 0;
        if (multiB !== multiA) return multiB - multiA;
      }
      const expA = a.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      const expB = b.prediction?.prediction_status === "expansion_likely" ? 1 : 0;
      if (expB !== expA) return expB - expA;
      const hazA = a.hazard?.hazard_score ?? -1;
      const hazB = b.hazard?.hazard_score ?? -1;
      if (hazB !== hazA) return hazB - hazA;
      return Number(b.fire?.frp_sum || 0) - Number(a.fire?.frp_sum || 0);
    });
  }, [activeTabData, filterWindow, fireListScope]);

  const selectedRawEvent = useMemo(() => {
    if (selectedFireId === null || selectedFireId === undefined) return null;
    return (
      allTabEvents.find((e) => String(e.fire?.fire_final) === String(selectedFireId)) || null
    );
  }, [allTabEvents, selectedFireId]);

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
    const activePool = [
      ...(activeTabData?.predictionsGeoJson?.features || []),
      ...(activeTabData?.pastPredictionsGeoJson?.features || []),
    ];
    const fromActive = activePool.filter((f) => String(f?.properties?.event_id) === fireIdStr);
    if (fromActive.length) return fromActive;

    if (activeTab === "combined" && selectedRawEvent.viirs_fire_final != null) {
      const viirsIdStr = String(selectedRawEvent.viirs_fire_final);
      const viirsPool = [
        ...(tabs?.viirs?.predictionsGeoJson?.features || []),
        ...(tabs?.viirs?.pastPredictionsGeoJson?.features || []),
      ];
      return viirsPool.filter((f) => String(f?.properties?.event_id) === viirsIdStr);
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

  const targetModelEvent = useMemo(() => {
    if (!selectedRawEvent?.fire) return null;
    if (activeTab === "combined" && selectedRawEvent.viirs_fire_final != null) {
      const viirsPool = [
        ...(tabs?.viirs?.fire_events || []),
        ...(tabs?.viirs?.past_fire_events || []),
      ];
      const matchedViirs = viirsPool.find(
        (ev) => String(ev.fire?.fire_final) === String(selectedRawEvent.viirs_fire_final),
      );
      if (matchedViirs?.fire) return matchedViirs;
    }
    return selectedRawEvent;
  }, [selectedRawEvent, activeTab, tabs]);

  const needsModelFetch = Boolean(
    country?.status === "ready" &&
    targetModelEvent?.fire &&
    selectedRawEvent?.fire &&
    hasViirsSupport &&
    (!selectedRawEvent.hazard ||
      !selectedRawEvent.prediction ||
      !selectedPredictionFeatures.length) &&
    !onDemandEntry?.fetched,
  );

  useEffect(() => {
    if (!needsModelFetch || !targetModelEvent?.fire || !selectedRawEvent?.fire || !selectedCacheKey) {
      return;
    }

    const controller = new AbortController();
    fetch("/api/fire-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        fire_event: {
          fire: targetModelEvent.fire,
          detections: targetModelEvent.detections,
          is_past: targetModelEvent.is_past ?? selectedRawEvent.is_past,
          hindcast: targetModelEvent.hindcast?.earlyFireEvent
            ? { earlyFireEvent: targetModelEvent.hindcast.earlyFireEvent }
            : undefined,
        },
        include_hazard: !selectedRawEvent.hazard,
        include_prediction: !selectedRawEvent.prediction || !selectedPredictionFeatures.length,
        use_hindcast_snapshot: Boolean(targetModelEvent.is_past ?? selectedRawEvent.is_past),
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
  }, [
    needsModelFetch,
    targetModelEvent,
    selectedRawEvent,
    selectedCacheKey,
    selectedPredictionFeatures.length,
  ]);

  const filteredOverlayGeo = useMemo(() => {
    if (!activeTabData) return { trackedGeoJson: null, predictionsGeoJson: null };
    const visibleIds = new Set(sortedEvents.map((e) => String(e.fire?.fire_final)));
    const sourceTracked =
      filterWindow?.isHistorical || fireListScope === "past"
        ? activeTabData.all_geojson || activeTabData.geojson
        : activeTabData.geojson;
    const trackedFeatures = (sourceTracked?.features || []).filter((f) =>
      visibleIds.has(String(f?.properties?.fire_final ?? f?.id)),
    );
    const trackedGeoJson = sourceTracked
      ? { ...sourceTracked, features: trackedFeatures }
      : null;

    const rawPred = activeTabData.predictionsGeoJson || null;
    const rawPastPred = activeTabData.pastPredictionsGeoJson || null;
    if (!rawPred && !rawPastPred) {
      return { trackedGeoJson, predictionsGeoJson: null };
    }
    const combinedPredFeatures =
      filterWindow?.isHistorical || fireListScope === "past"
        ? [...(rawPred?.features || []), ...(rawPastPred?.features || [])]
        : rawPred?.features || [];
    const filteredPredFeatures = combinedPredFeatures.filter((f) =>
      visibleIds.has(String(f?.properties?.event_id)),
    );
    const predictionsGeoJson = rawPred
      ? { ...rawPred, features: filteredPredFeatures }
      : { type: "FeatureCollection", features: filteredPredFeatures };

    return { trackedGeoJson, predictionsGeoJson };
  }, [activeTabData, sortedEvents, filterWindow?.isHistorical, fireListScope]);

  useEffect(() => {
    if (country?.status !== "ready" || !activeTabData) return;
    globeRef.current?.updateTrackerOverlay({
      trackedGeoJson: filteredOverlayGeo.trackedGeoJson,
      predictionsGeoJson: filteredOverlayGeo.predictionsGeoJson,
      selectedFireId,
      selectedFireEvent: hydratedSelectedFireEvent,
      selectedPredictionFeatures,
      activeTab,
    });
  }, [
    country?.status,
    activeTabData,
    filteredOverlayGeo,
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
      const events = sortedEvents.length ? sortedEvents : allTabEvents;
      let matched = findMatchingFireEvent(events, input);
      if (!matched && events !== allTabEvents) {
        matched = findMatchingFireEvent(allTabEvents, input);
      }
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
    [sortedEvents, allTabEvents],
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
    setFilterWindow(null);
    setSelectedDay(null);
  }, []);

  const selectCountry = useCallback(
    async (target) => {
      if (!target?.iso3) return;
      if (country?.iso3 === target.iso3) return;

      setSelectedFireId(null);
      setHoveredHit(null);
      setFilterWindow(null);
      setSelectedDay(null);
      setFireListScope("recent");
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
          globeRef.current?.updateHotspots(data.points14d || data.points, data.country);
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
            fireListScope={fireListScope}
            onChangeFireListScope={setFireListScope}
            recentCount={activeTabData?.fire_events?.length ?? 0}
            pastCount={activeTabData?.past_fire_events?.length ?? 0}
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
            fireListScope={fireListScope}
            onChangeFireListScope={setFireListScope}
            selectedDay={selectedDay}
            onSelectDay={handleSelectDay}
            isHistoricalWindow={Boolean(filterWindow?.isHistorical)}
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

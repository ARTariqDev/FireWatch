"use client";

import "./hero/hero.css";
import { useCallback, useRef, useState } from "react";
import CountryHud from "./globe/CountryHud";
import GlobeReadout from "./globe/GlobeReadout";
import GlobeStage from "./globe/GlobeStage";
import { DEFAULT_COUNTRY, fetchCountryHotspots, locateUser, resolveCountry } from "./globe/geo";
import HeroBackdrop from "./hero/HeroBackdrop";
import HeroCopy from "./hero/HeroCopy";
import HeroFooter from "./hero/HeroFooter";
import HeroNav from "./hero/HeroNav";

// phase: orbit -> locating -> flying -> country -> returning -> orbit
function Hero() {
  const globeRef = useRef(null);
  const slotRef = useRef(null);
  const [phase, setPhase] = useState("orbit");
  const [feed, setFeed] = useState({ status: "loading" });
  const [country, setCountry] = useState(null);

  const viewHotspots = useCallback(async () => {
    setPhase("locating");

    // Browser permission prompt; declining (or any failure) falls back to the default country.
    const position = await locateUser();
    const detected = position ? await resolveCountry(position) : null;
    const target = detected ?? DEFAULT_COUNTRY;

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

    await globeRef.current?.flyToCountry({
      iso3: target.iso3,
      focus: detected ? position : DEFAULT_COUNTRY.center,
      request,
    });
    setPhase("country");
  }, []);

  const backToOrbit = useCallback(async () => {
    setPhase("returning");
    await globeRef.current?.returnToOrbit();
    setCountry(null);
    setPhase("orbit");
  }, []);

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
              <GlobeReadout feed={feed} />
            </div>
          </div>
          <HeroFooter />
        </div>

        <CountryHud open={expanded} canExit={phase === "country"} country={country} onBack={backToOrbit} />
      </section>
    </main>
  );
}

export default Hero;

"use client";

import "./globe.css";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { hasMapboxToken } from "./geo";

// Runs `task` once the browser is idle (or soon after), so the hero text paints before the heavy map code loads.
function whenIdle(task) {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(task, { timeout: 1500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 400);
  return () => window.clearTimeout(id);
}

// Full-hero Mapbox globe. `slotRef` marks where the globe rests while in orbit.
function GlobeStage({ ref, slotRef, onFeed, onSelectFire, onHoverFire }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const onSelectFireRef = useRef(onSelectFire);
  const onHoverFireRef = useRef(onHoverFire);
  useEffect(() => {
    onSelectFireRef.current = onSelectFire;
  }, [onSelectFire]);
  useEffect(() => {
    onHoverFireRef.current = onHoverFire;
  }, [onHoverFire]);

  // Resolves to the controller once the globe exists, or null if it never will (e.g. no token).
  const [created] = useState(() => {
    let settle;
    const promise = new Promise((resolve) => (settle = resolve));
    return { promise, settle };
  });

  useEffect(() => {
    if (!hasMapboxToken()) {
      onFeed({ status: "no-token" });
      created.settle(null);
      return;
    }

    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      // Mapbox GL and its CSS are heavy and browser-only, so they load as one lazy chunk.
      Promise.all([import("./createGlobe"), import("mapbox-gl")])
        .then(([{ createGlobe }, { default: mapboxgl }]) => {
          if (cancelled) return;
          globeRef.current = createGlobe({
            mapboxgl,
            container: containerRef.current,
            slot: slotRef.current,
            onFeed,
            onSelectFire: (hit) => onSelectFireRef.current?.(hit),
            onHoverFire: (hit) => onHoverFireRef.current?.(hit),
          });
          created.settle(globeRef.current);
        })
        .catch(() => {
          onFeed({ status: "map-error" });
          created.settle(null);
        });
    });

    return () => {
      cancelled = true;
      cancelIdle();
      globeRef.current?.destroy();
      globeRef.current = null;
    };
  }, [slotRef, onFeed, created]);

  useImperativeHandle(
    ref,
    () => ({
      flyToCountry: async (options) => (await created.promise)?.fly(options) ?? false,
      returnToOrbit: async () => (await created.promise)?.back() ?? false,
      setViewMode: async (mode) => (await created.promise)?.setView(mode) ?? false,
      updateHotspots: (points, country) => globeRef.current?.updateHotspots(points, country),
      updateTrackerOverlay: (overlay) => globeRef.current?.updateTrackerOverlay(overlay),
      focusFire: (target) => globeRef.current?.focusFire(target),
      resetCountryView: (bbox) => globeRef.current?.resetCountryView(bbox),
    }),
    [created],
  );

  return (
    <div
      ref={containerRef}
      className="globe-stage"
      role="region"
      aria-label="Globe with illustrative fire signals. Choose View Hotspots to load live satellite detections."
    />
  );
}

export default GlobeStage;

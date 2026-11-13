"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import "./globe.css";
import { useEffect, useImperativeHandle, useRef } from "react";
import { createGlobe } from "./createGlobe";
import { hasMapboxToken } from "./geo";

// Full-hero Mapbox globe. `slotRef` marks where the globe rests while in orbit.
function GlobeStage({ ref, slotRef, onFeed }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);

  useEffect(() => {
    if (!hasMapboxToken()) {
      onFeed({ status: "no-token" });
      return;
    }

    let cancelled = false;
    // Loaded on demand: Mapbox GL needs the browser and is heavy for the first paint.
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled) return;
      globeRef.current = createGlobe({
        mapboxgl,
        container: containerRef.current,
        slot: slotRef.current,
        onFeed,
      });
    });

    return () => {
      cancelled = true;
      globeRef.current?.destroy();
      globeRef.current = null;
    };
  }, [slotRef, onFeed]);

  useImperativeHandle(
    ref,
    () => ({
      flyToCountry: (options) => globeRef.current?.fly(options) ?? Promise.resolve(false),
      returnToOrbit: () => globeRef.current?.back() ?? Promise.resolve(false),
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="globe-stage"
      role="region"
      aria-label="Globe showing recent satellite fire detections"
    />
  );
}

export default GlobeStage;

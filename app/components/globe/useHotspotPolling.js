"use client";

import { useEffect, useRef } from "react";
import { fetchCountryHotspots } from "./geo";

// NASA publishes new detections every few hours; checking twice an hour keeps the view current.
export const REFRESH_MS = 30 * 60 * 1000;

// Re-checks the hotspot feed while a country is open. Background tabs skip ticks and catch up on return.
export function useHotspotPolling({ iso3, enabled, onData }) {
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });

  useEffect(() => {
    if (!enabled || !iso3) return;

    let cancelled = false;
    let inflight = false;
    let lastFetch = Date.now();

    const refresh = async () => {
      if (inflight || document.hidden) return;
      inflight = true;
      try {
        const data = await fetchCountryHotspots(iso3);
        if (!cancelled) {
          lastFetch = Date.now();
          onDataRef.current(data);
        }
      } catch {
        // Keep showing the last good data; the next tick tries again.
      } finally {
        inflight = false;
      }
    };

    const onVisible = () => {
      if (!document.hidden && Date.now() - lastFetch >= REFRESH_MS) refresh();
    };

    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [iso3, enabled]);
}

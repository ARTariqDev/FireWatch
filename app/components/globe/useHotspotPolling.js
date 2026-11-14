"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCountryHotspots } from "./geo";

// NASA publishes new detections every few hours; checking twice an hour keeps the view current.
export const REFRESH_MS = 30 * 60 * 1000;

// Re-checks the hotspot feed while a country is open. Background tabs skip ticks and catch up on return.
export function useHotspotPolling({ iso3, enabled, onData, onError }) {
  const callbacks = useRef({ onData, onError });
  const request = useRef(null);
  const lastFetch = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => {
    callbacks.current = { onData, onError };
  });

  const refresh = useCallback(async (manual = false) => {
    if (!enabled || !iso3 || request.current || (!manual && document.hidden)) return;
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    setRefreshError(false);
    try {
      const data = await fetchCountryHotspots(iso3, controller.signal, manual);
      if (!controller.signal.aborted) {
        lastFetch.current = Date.now();
        callbacks.current.onData(data);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Hotspot refresh failed:", error);
        setRefreshError(true);
        callbacks.current.onError?.();
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRefreshing(false);
      }
    }
  }, [enabled, iso3]);

  useEffect(() => {
    if (!enabled || !iso3) return;

    lastFetch.current = Date.now();

    const onVisible = () => {
      if (!document.hidden && Date.now() - lastFetch.current >= REFRESH_MS) refresh();
    };

    const timer = setInterval(() => refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      request.current?.abort();
    };
  }, [iso3, enabled, refresh]);

  return { refresh, refreshing, refreshError };
}

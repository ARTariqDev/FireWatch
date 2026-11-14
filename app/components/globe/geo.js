export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Used whenever the visitor declines (or can't share) their location.
export const DEFAULT_COUNTRY = {
  iso3: "PAK",
  name: "Pakistan",
  center: { lng: 69.35, lat: 30.38 },
};

const PERMISSION_WAIT_MS = 20000;

export const hasMapboxToken = () => Boolean(MAPBOX_TOKEN?.startsWith("pk."));

// Resolves to { lng, lat }, or null when unsupported, declined, or timed out.
export function locateUser() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), PERMISSION_WAIT_MS);
    const finish = (value) => {
      clearTimeout(giveUp);
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => finish({ lng: coords.longitude, lat: coords.latitude }),
      () => finish(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

// Maps a coordinate to its country using Mapbox's country-boundaries tileset.
export async function resolveCountry({ lng, lat }) {
  try {
    const url = `https://api.mapbox.com/v4/mapbox.country-boundaries-v1/tilequery/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const { features = [] } = await response.json();
    const match =
      features.find((item) => ["all", "US"].includes(item.properties?.worldview)) ?? features[0];
    const iso3 = match?.properties?.iso_3166_1_alpha_3;
    return iso3 ? { iso3, name: match.properties.name_en ?? iso3 } : null;
  } catch {
    return null;
  }
}

export async function fetchCountryBounds(iso3, signal) {
  const response = await fetch(`/api/country?country=${iso3}`, { signal });
  if (!response.ok) throw new Error(`Country bounds request failed (${response.status})`);
  const { bbox } = await response.json();
  return bbox;
}

export async function fetchCountryHotspots(iso3, signal, refresh = false) {
  const response = await fetch(`/api/hotspots?country=${iso3}`, {
    signal,
    method: refresh ? "POST" : "GET",
  });
  if (!response.ok) throw new Error(`Hotspot request failed (${response.status})`);
  return response.json();
}

// Interpolates along the shortest arc so the camera never spins the long way round.
export const shortestLng = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

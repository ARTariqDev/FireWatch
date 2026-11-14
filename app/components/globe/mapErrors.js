export const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";
const STYLE_PATH = "/styles/v1/mapbox/dark-v11";
const RETRY_DELAY_MS = 500;

function messageOf(error) {
  const message = typeof error?.message === "string" ? error.message : String(error);
  return message.replace(/([?&]access_token=)[^&\s]+/g, "$1[redacted]");
}

export function monitorMapErrors(map, { isBooting, onFatal }) {
  let retries = 0;
  let retryTimer = null;
  let failed = false;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const fail = (message) => {
    if (failed) return;
    failed = true;
    clearRetry();
    console.error("Mapbox style failed to load:", message);
    onFatal();
  };

  const onError = ({ error }) => {
    const resource = typeof error?.url === "string" ? error.url : messageOf(error);
    if (!isBooting() || (!resource.includes(STYLE_PATH) && !resource.includes(MAP_STYLE))) {
      console.error("Mapbox error:", messageOf(error));
      return;
    }

    if (retryTimer !== null || failed) return;
    const transient = error?.status == null || [500, 502, 503, 504].includes(error.status);
    if (transient && retries === 0) {
      retries++;
      console.warn("Mapbox style request failed; retrying once.");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!isBooting()) return;
        try {
          map.setStyle(MAP_STYLE, { diff: false });
        } catch (retryError) {
          fail(messageOf(retryError));
        }
      }, RETRY_DELAY_MS);
      return;
    }
    fail(messageOf(error));
  };

  map.on("error", onError);
  map.on("load", clearRetry);
  return () => {
    clearRetry();
    map.off("error", onError);
    map.off("load", clearRetry);
  };
}

// Illustrative signals for the landing globe only. Real detections load when the visitor opens the map.
const REGIONS = [
  // [lng, lat, spread (deg), count]
  [-120.5, 37.5, 3, 6],
  [-122, 45, 2, 3],
  [-103, 22, 3, 4],
  [-55, -9, 5, 12],
  [-48, -14, 3, 6],
  [-61, -23, 3, 4],
  [22, -5, 6, 10],
  [10, 11, 6, 8],
  [28, -14, 4, 6],
  [22, 39, 4, 4],
  [75, 27, 4, 6],
  [102, 16, 4, 5],
  [115, -3, 4, 5],
  [105, 57, 7, 4],
  [146, -24, 4, 5],
  [47, -19, 2, 3],
];

// Small deterministic generator so the preview is identical on the server and the client.
function mulberry32(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPreview() {
  const random = mulberry32(20261113);
  const points = [];
  for (const [lng, lat, spread, count] of REGIONS) {
    for (let i = 0; i < count; i++) {
      const frp = 4 + random() ** 3 * 120;
      points.push([
        Number((lng + (random() - 0.5) * 2 * spread).toFixed(2)),
        Number((lat + (random() - 0.5) * 2 * spread).toFixed(2)),
        Number(frp.toFixed(1)),
        i % 2,
        1,
      ]);
    }
  }
  return points;
}

export const PREVIEW_POINTS = buildPreview();

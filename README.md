This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Country hotspots

The map requests country bounds from `/api/country?country=PAK` and NASA FIRMS detections from `/api/hotspots?country=PAK` in parallel. The map can open while detections are loading; only real detections within the selected country's boundary from the rolling last 24 hours are shown. Substitute any supported ISO alpha-3 country code for `PAK`. The country view checks automatically every 30 minutes; its refresh button requests fresh data immediately.

The country sidebar holds the map controls and statistics. It can be hidden or shown, and becomes a bottom drawer on smaller screens. Country views open in 3D by default.

## Multi-Sensor MODIS-VIIRS Harmonization Strategy

### 1. The Core Scientific Challenge
MODIS (onboard NASA's Terra and Aqua satellites) and VIIRS (onboard S-NPP and NOAA-20/21) have substantially different spatial resolutions, optical scan designs, and orbital revisit times:
- **MODIS**: 1 km nominal spatial resolution at nadir.
- **VIIRS (I-Band 375m)**: 375 m spatial resolution with onboard pixel aggregation.
- **Orbital Overpass Timing**:
  - **Terra (MODIS)**: Morning pass ~10:30 AM local solar time (descending), night ~22:30.
  - **Aqua (MODIS)**: Afternoon pass ~13:30 PM local solar time (ascending), night ~01:30.
  - **S-NPP / NOAA-20 / NOAA-21 (VIIRS)**: Afternoon pass ~13:30 PM (coincident with Aqua), night ~01:30.

Naive approaches to harmonization often propose breaking down a single $1 \times 1\text{ km}$ MODIS pixel into a $3 \times 3$ grid of 9 artificial $350\text{ m}$ sub-pixels. **Our engine explicitly rejects artificial sub-pixel splitting** because:
1. It fabricates 8 non-existent fire detections from a single satellite measurement, artificially inflating fire occurrence counts and active front surface area by up to 900%.
2. A single MODIS detection is triggered by sub-pixel radiant heat anywhere within its $\sim 1\text{ km}^2$ footprint (even a fire covering just $100\text{ m}^2$). Radiometrically, we cannot know which sub-cell contains the fire without high-resolution sensor observations.

### 2. Multi-Sensor Spatial and Temporal Alignment
Instead of synthesizing fake geometry, our engine (`lib/harmonization.js`) uses a physics-grounded multi-sensor fusion strategy:
1. **Spatial Coordinate Anchoring**:
   - Geodesic distance (Haversine) with a $1.0\text{ km}$ spatial coincidence threshold.
   - When a VIIRS observation spatially coincides with a MODIS observation, the fire front is **anchored to the high-accuracy $375\text{ m}$ VIIRS geographic coordinates**.
   - Redundant coarse MODIS points are suppressed from duplicate visualization while their raw observations, radiometric FRP, satellite platform, and detection metadata are preserved inside `event.observations` and `point.matches`.
2. **Temporal Coincidence & Orbit Delays**:
   - Temporal window of $\pm 4\text{ hours}$ accommodates reading and processing time delays as well as the orbital delta between Terra (~10:30) and Aqua/VIIRS (~13:30).
   - If VIIRS detects a fire at 13:30 and MODIS (Terra) detected it at 10:30, the system recognizes them as the **same propagating fire event** rather than two distinct incidents.
3. **Absence of Detection $\neq$ Extinction**:
   - Non-detection during a subsequent satellite overpass is **not** treated as definitive proof of fire extinction.
   - Cloud cover, high viewing angles, smoke plume attenuation, or orbital gaps frequently occlude active fires. A fire front is only marked extinguished when persistent non-detections accumulate across clean atmospheric passes or when user timeline scrubbing reaches historical intervals.

### 3. 4-Tier Confidence Engine & Visual Hierarchy
To convey data certainty to analysts, detections are classified into a 4-tier confidence hierarchy:
- **Tier 1: Dual-Confirmed (High Confidence, 95–100%)**
  - Confirmed by both MODIS and VIIRS within the coincidence window, or multiple independent satellite platforms.
  - Rendered with an **intense white-gold core** (`#fff0b3` to `#ffffff`) with active sonar radar pulse.
- **Tier 2: VIIRS Solo (Nominal / High Confidence, 75–90%)**
  - High-resolution $375\text{ m}$ active front detected by VIIRS (S-NPP, NOAA-20, NOAA-21).
  - Rendered with a **vivid orange core** (`#ff6a32`) with active radar pulse. Displayed by default alongside Tier 1.
- **Tier 3: MODIS Solo (Unverified / Lower Confidence, 30–55%)**
  - Coarse $1\text{ km}$ detection without high-resolution VIIRS confirmation.
  - Rendered with an **ochre/amber core** (`#d97706`), lower opacity, and no pulse rings to prevent false alarm distraction.
- **Tier 4: Put Out / Inactive (Historical, 20–25%)**
  - Historical detection that is no longer active in the latest satellite pass.
  - Rendered with a **muted pale salmon shade** (`#dfb7a2`), reduced opacity, and no pulse rings.

### 4. Interactive Timeline & Confidence Filtering
The frontend sidebar features:
- **Confidence Filter**: Scrub or toggle between `ALL` (all sensors), `VIIRS + DUAL` (default high-confidence operational view), and `DUAL ONLY` (isolated multi-satellite confirmations).
- **24-Hour Timeline Scrub**: Scrub back $0$ to $24$ hours to inspect historical fire progression and watch past fires fade into muted inactive tones.
- **Custom UTC Date/Time Range**: Query specific historical intervals across multi-day spans.

---

## The Bow-Tie Effect: Analysis & Mitigation

### What is the Bow-Tie Effect?
Both MODIS and VIIRS are scanning radiometers that image the Earth using a rotating double-sided mirror sweeping cross-track perpendicular to the spacecraft flight direction:
- At **nadir** (directly below the satellite), the line of sight is perpendicular to the Earth's surface, and the instantaneous field of view (IFOV) projects a compact footprint (e.g. $1 \times 1\text{ km}$ for MODIS, $375 \times 375\text{ m}$ for VIIRS).
- As the scan angle sweeps toward the **swath edge** (up to $\pm 55^\circ$ for MODIS, $\pm 56^\circ$ for VIIRS), two severe optical distortions occur:
  1. **Panoramic Distortion**: Slant distance from the satellite to Earth increases dramatically ($1 / \cos^2\theta$). The ground footprint expands both along the scan (cross-track) and along the orbit (along-track).
  2. **Scan Overlap**: Because the detector footprint widens along-track toward the swath edges, successive mirror scans physically overlap one another, resembling the shape of a bow-tie.

### How Big of a Problem is the Bow-Tie Effect?

| Metric | MODIS (Terra / Aqua) | VIIRS (S-NPP / NOAA-20 / NOAA-21) |
| :--- | :--- | :--- |
| **Nadir Spatial Resolution** | $1.0\text{ km} \times 1.0\text{ km}$ ($1\text{ km}^2$) | $0.375\text{ km} \times 0.375\text{ km}$ ($0.14\text{ km}^2$) |
| **Swath-Edge Pixel Growth** | Up to $\sim 4.8\text{ km}$ (cross-track) $\times 2.0\text{ km}$ (along-track) | Constrained to $\sim 0.75\text{ km} \times 0.75\text{ km}$ |
| **Swath-Edge Pixel Area Expansion** | **Up to $9.6\times - 10\times$ ($\approx 10\text{ km}^2$ per pixel)** | **Only $\sim 2\times$ ($\approx 0.3\text{ km}^2$ per pixel)** |
| **Consecutive Scan Overlap** | Up to **$50\%$ overlap** between consecutive swaths at edge | Overlap is dynamically deleted onboard |
| **Duplicate Detections** | **High**: A single fire at swath edge is frequently detected twice by adjacent scans | **Virtually Zero**: Onboard deletion eliminates duplicate edge samples |

#### In MODIS:
The bow-tie effect is a **major geometric distortion**. At swath edges, a single active fire front can be reported in two adjacent scans with coordinates separated by 2–4 km. Furthermore, radiant flux calculations from a $10\text{ km}^2$ distorted pixel smear the apparent fire area by a factor of 10.

#### In VIIRS:
VIIRS was engineered specifically to solve the bow-tie effect using **onboard pixel aggregation**:
1. **Dynamic Pixel Aggregation**:
   - From nadir to $31.7^\circ$: $3 \times 1$ aggregation (combining 3 sub-pixels).
   - From $31.7^\circ$ to $44.8^\circ$: $2 \times 1$ aggregation.
   - From $44.8^\circ$ to edge ($56.3^\circ$): $1 \times 1$ sample (unaggregated).
2. **Onboard Bow-Tie Deletion**:
   - VIIRS algorithmically deletes overlapping pixel samples in the edge zones, preventing identical geographic targets from appearing in multiple scan records.

### How Our Engine Harmonizes Away Bow-Tie Artifacts
1. **VIIRS Coordinate Precedence**: When MODIS and VIIRS overlap, our spatial engine locks onto the VIIRS coordinate, taking advantage of VIIRS's flat resolution and bow-tie correction.
2. **Spatial-Temporal Deduplication**: Near the swath edges where MODIS generates duplicate detections across overlapping scans, our geodesic deduplication filters out redundant records within the same observation pass.
3. **Observation Preservation**: Raw footprint extents and sensor angles are preserved in the fire event history, allowing downstream spread models to weight observations according to scan angle and footprint eccentricity.

---

## Fire Event Tracking & Machine Learning Prediction Architecture

### Event Reconstruction (`lib/tracker.js`)
Individual hotspot detections across passes are grouped into persistent, spatio-temporal fire events:
- **Deterministic Event IDs**: Generated as `fire_${latTag}_${lonTag}_${firstAcquired}` so events maintain persistent identity across page reloads and temporal scrubs.
- **Observation History**: Every event retains the complete chronological sequence of MODIS and VIIRS passes, including satellite platform, raw FRP, confidence, and timestamps.
- **Footprint Convex Polygons**: Spatial footprints computed from observation clusters for spatial spread visualization.

### Prediction Slot Architecture
To ensure seamless integration with ML spread and risk models without frontend breakage, every fire event is initialized with a structured, standardized prediction slot:
```json
{
  "eventId": "fire_31.520N_074.358E_1763118000000",
  "detectionConfidence": 92,
  "trackingConfidence": 88,
  "observations": [...],
  "prediction": null
}
```
When predictive models are connected, `prediction` will be populated with:
- **Model 1 (Persistence)**: Probability of fire remaining active over 6h, 12h, and 24h windows ($P_{\text{active}}$).
- **Model 2 (Expansion / Spread)**: Vector field of projected fire front expansion (direction, speed in km/h, and 12h projected polygon).
- **Model 3 (Additional Area / Smoke Dispersion)**: Predicted new burned area ($\text{km}^2$) and downwind particulate dispersion.

The visual layers and event pipelines are already built to consume this slot immediately once enabled.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# MODIS & VIIRS Multi-Sensor Harmonization System

This document outlines the architecture, mathematical principles, and operational workflow of the multi-sensor satellite fire harmonization system implemented in this platform.

---

## 1. System Overview & The Core Challenge

Satellite wildfire tracking relies primarily on two sensor suites operated by NASA and NOAA:
1. **MODIS (Moderate Resolution Imaging Spectroradiometer)**:
   - Flying onboard **Terra** (~10:30 AM local solar time morning pass) and **Aqua** (~13:30 PM afternoon pass).
   - Nominal nadir spatial resolution: **1 km**.
2. **VIIRS (Visible Infrared Imaging Radiometer Suite)**:
   - Flying onboard **S-NPP**, **NOAA-20**, and **NOAA-21** (~13:30 PM afternoon pass, near-coincident with Aqua).
   - High-resolution active fire band (I-Band 375m) spatial resolution: **375 m**.

### Why Naive Harmonization Fails
A common naive suggestion is to subdivide a single $1\text{ km} \times 1\text{ km}$ MODIS pixel into a $3 \times 3$ grid of nine $350\text{ m}$ sub-pixels and display those. **This system explicitly rejects artificial sub-pixel splitting** for critical physical and scientific reasons:
- **Radiometric Reality**: An active fire covering just $100\text{ m}^2$ (0.01% of a $1\text{ km}^2$ MODIS footprint) emits enough Fire Radiative Power (FRP) to trigger a 1 km MODIS detection. Decomposing that detection into 9 separate points creates **8 artificial "ghost fires"** where no thermal anomaly exists.
- **Surface Area Distortion**: It inflates active fire counts and calculated burned acreage by up to $900\%$.
- **The Physical Approach**: Instead of synthesizing phantom geometry, the system treats MODIS as an uncertainty footprint and leverages coincident VIIRS passes to **naturally resolve and anchor** the true fire front to high-accuracy 375m coordinates.

---

## 2. Multi-Sensor Fusion Pipeline (`lib/harmonization.js`)

```
                 NASA FIRMS Telemetry Stream
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
      MODIS (1 km)                        VIIRS (375 m)
     Terra & Aqua                     S-NPP, NOAA-20/21
            │                                   │
            └─────────────────┬─────────────────┘
                              ▼
                 Geodesic Distance Matching
              (Haversine threshold: 1.0 km)
                              │
                              ▼
                  Temporal Coincidence Gate
              (Overpass window: ±4 hours)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    [Spatial Overlap]                   [No Coincidence]
VIIRS anchors coordinates           Retained as solo detection
MODIS preserved in `matches`        Tier 2 (VIIRS) or Tier 3 (MODIS)
Assigned Tier 1 (Dual-Confirmed)
```

### 1. Spatial Coordinate Anchoring
- **Haversine Distance**: When a VIIRS detection falls within $1.0\text{ km}$ of a MODIS detection, they are identified as the same physical fire front.
- **Resolution Pinning**: The event is pinned to the **$375\text{ m}$ VIIRS coordinates**, eliminating the positional ambiguity of MODIS's coarse pixel.
- **Zero Data Loss**: The overlapping MODIS observation is not discarded from the analytical record. Its raw coordinates, FRP, acquisition timestamp, satellite platform, and detection confidence are preserved in `point.matches` and stored in the fire event's observation history.

### 2. Overpass Timing & Reading Delays
- **Terra (MODIS)** sweeps at ~10:30 AM local time, establishing the morning baseline.
- **Aqua (MODIS)** and **VIIRS (NOAA/SNPP)** sweep at ~13:30 PM local time during peak afternoon fire activity.
- The harmonization engine applies a **$\pm 4\text{-hour}$ coincidence window**. This captures the 3-hour orbital delta between Terra and Aqua/VIIRS, absorbs near-real-time (NRT) ground processing delays (1–3 hours), and prevents identical fire fronts from being split into duplicate events.

### 3. Absence of Detection $\neq$ Extinction
Non-detection by VIIRS following an earlier MODIS pass is **never** treated as automatic fire extinction:
- Cloud cover, high view angles (swath edges), heavy smoke attenuation, or orbital gaps frequently occlude active fires.
- A fire front is only marked as extinguished/inactive when persistent clear-sky passes confirm thermal absence or when scrubbing past historical intervals.

---

## 3. The 4-Tier Confidence Architecture

Every detection is classified into a rigorous 4-tier confidence hierarchy:

| Tier | Classification | Confidence Rating | Map Visual Core | Radar Pulse | Description |
| :---: | :--- | :---: | :--- | :---: | :--- |
| **Tier 1** | **Dual-Confirmed** | **95% – 100%** | Intense White-Gold (`#fff0b3` → `#ffffff`) | Yes | Coincident cross-satellite validation by both MODIS and VIIRS within the coincidence window. Highest analytical certainty. |
| **Tier 2** | **VIIRS Solo** | **75% – 90%** | Vivid Orange (`#ff6a32`) | Yes | High-resolution 375m active front detected by VIIRS (S-NPP, NOAA-20, NOAA-21). Default operational view alongside Tier 1. |
| **Tier 3** | **MODIS Solo** | **30% – 55%** | Ochre / Amber (`#d97706`) | No | Coarse 1km detection unconfirmed by high-resolution pass. Rendered with lower opacity and no pulse rings to minimize false alarm noise. |
| **Tier 4** | **Put Out / Inactive** | **20% – 25%** | Muted Pale Salmon (`#dfb7a2`) | No | Historical front present in earlier passes but absent in the latest satellite observations. |

---

## 4. Fire Event Reconstruction & Catering for the Prediction Workflow

### Deterministic Event Rebuilding (`lib/tracker.js`)
Individual point detections across passes are grouped into persistent spatio-temporal fire events:
- **Deterministic Event IDs**: Generated as `fire_${latTag}_${lonTag}_${firstAcquired}` so fire identities persist across browser reloads, filters, and timeline scrubs without requiring a heavy persistent database.
- **Observation History**: Every event retains the complete chronological sequence of passes:
  ```json
  "observations": [
    {
      "sensor": "MODIS",
      "satellite": "Terra",
      "latitude": 31.5204,
      "longitude": 74.3582,
      "frp": 45.2,
      "confidence": 78,
      "timestamp": "2026-11-14T05:30:00.000Z"
    },
    {
      "sensor": "VIIRS",
      "satellite": "NOAA-20",
      "latitude": 31.5218,
      "longitude": 74.3591,
      "frp": 82.6,
      "confidence": 95,
      "timestamp": "2026-11-14T08:15:00.000Z"
    }
  ]
  ```
- **Convex Bounding Footprints**: Spatial clusters generate footprint bounding polygons for spatial perimeter tracking.

### Seamless Machine Learning Integration (`prediction: null`)
To ensure that downstream predictive models connect cleanly without breaking existing frontend visualizers or data contracts, every fire event is structured with a standardized prediction slot:
```json
{
  "eventId": "fire_31.522N_074.359E_1763118000000",
  "detectionConfidence": 95,
  "trackingConfidence": 90,
  "footprint": { "type": "Polygon", "coordinates": [...] },
  "observations": [...],
  "prediction": null
}
```

When ML models are deployed, the `prediction` slot is populated directly:
1. **Model 1 (Persistence Probability)**:
   - Predicts the probability of the front remaining actively flaming over 6h, 12h, and 24h horizons:
     ```json
     "prediction": {
       "persistence": { "p6h": 0.88, "p12h": 0.65, "p24h": 0.32 }
     }
     ```
2. **Model 2 (Front Expansion & Spread Vector)**:
   - Provides propagation velocity ($\text{km/h}$), dominant spread bearing ($^\circ$), and 12-hour projected perimeter polygon:
     ```json
     "prediction": {
       "spread": {
         "speedKmH": 1.4,
         "headingDeg": 65,
         "projectedPerimeter": { "type": "Polygon", "coordinates": [...] }
       }
     }
     ```
3. **Model 3 (Additional Burn Area & Smoke Dispersion)**:
   - Estimated additional area burned ($\text{km}^2$) and downwind particulate concentration envelope.

Because the data pipelines (`lib/hotspots.js`, `lib/tracker.js`, and `app/components/globe/layers.js`) already consume this event structure, connecting the ML models requires zero schema modifications.

---

## 5. Bow-Tie Effect Mitigation

Both MODIS and VIIRS use cross-track scanning mirrors that suffer from panoramic distortion toward the swath edges ($\pm 55^\circ$):
- **MODIS**: Has no onboard bow-tie correction. At swath edges, pixel area expands up to **$10\times$** ($\approx 10\text{ km}^2$), causing consecutive scan lines to physically overlap by up to 50% and generating duplicate detections for the same fire.
- **VIIRS**: Solves this via onboard $3:1 \to 2:1 \to 1:1$ pixel aggregation and hardware deletion of overlapping edge samples, constraining pixel area expansion to only $\sim 2\times$.
- **Harmonization Mitigation**: When MODIS and VIIRS overlap, our engine anchors to VIIRS's geometrically stable coordinate and filters out swath-edge duplicate detections via geodesic clustering.

---

## 6. Frontend Controls & User Workflow

1. **Confidence Filter Slider**:
   - `ALL`: Displays all sensors (MODIS solo, VIIRS solo, Dual-confirmed).
   - `VIIRS + DUAL (DEFAULT)`: The high-accuracy operational view, filtering out coarse unverified MODIS noise.
   - `DUAL ONLY`: Isolates ultra-high confidence (95–100%) coincident multi-satellite confirmations.
2. **24-Hour Historical Scrub**:
   - Scrub $0$ to $24$ hours back.
   - Historical fires fade to lighter muted salmon (`#dfb7a2`), clearly distinguishing currently active burning fronts from extinguished/past fires.
3. **Date & Time Range Query**:
   - Query multi-day historical FIRMS data with minute-precision UTC start and end bounds.
4. **Global Country / Location Selector**:
   - Search and switch to any country across the globe with smooth 3D camera transitions and live FIRMS data loading.

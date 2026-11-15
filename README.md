# MODIS & VIIRS Fire Watch Platform

A 3D Mapbox geospatial platform and Next.js application that reconciles NASA FIRMS **MODIS (`~1 km`)** and **VIIRS (`~375 m`)** active fire detections across countries using a **Hybrid Two-Layer Harmonization Engine**, **three isolated 14-day fire-tracker workflows**, **Pakistan-calibrated VIIRS ML spread & hazard inference**, and **on-map `t0` hindcast validation (Actual vs. Predicted Spread)**.

---

## Getting Started

Run the Next.js development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Country views default to **3D terrain** (e.g. `PAK`) and load country geometry alongside NASA FIRMS thermal detections and tracked fire models.

### Core API Endpoints

- `GET /api/country?country=PAK` — Returns the target country polygon, focus bounding box, and metadata (substitute any supported ISO alpha-3 country code).
- `GET /api/hotspots?country=PAK[&date=YYYY-MM-DD&dayRange=N]` — Fetches the 14-day MODIS + VIIRS FIRMS archive/NRT feed inside country boundaries, runs Layer A + Layer B harmonization, executes isolated 14-day fire tracking for **Combined (`MODIS + VIIRS`)**, **VIIRS**, and **MODIS**, attaches VIIRS ML predictions, hazard ratings, and `t0` past-fire hindcasts, and returns both `<=12h` active views and `14d` lookback arrays. Refreshes automatically every 30 minutes or on demand.
- `POST /api/fire-models` — On-demand hazard and spread scoring via `/calculate_hazard` and `/predict_event` for selected fires, including `use_hindcast_snapshot: true` to evaluate past fires from their initial-pass (`t0`) state.

---

## Architecture & End-to-End Pipeline

```text
NASA FIRMS 14-Day Detections (MODIS Terra/Aqua + VIIRS S-NPP / NOAA-20 / NOAA-21)
  │  (chunked historical/NRT ingestion + UTC timestamp recovery via itemAcquiredMs)
  ▼
Country Mask & Dataset Reference Anchor (lib/hotspots.js)
  ├─ Anchors referenceEndMs to max detection timestamp in-country (cutoffRecentMs = referenceEndMs - 12h)
  │
  ├──► Three Independent 14-Day Tracker Runs (lib/fire-models.js -> Python /track_fires)
  │      ├─ 1. Combined Tab (MODIS + VIIRS)
  │      ├─ 2. VIIRS · ML Tab (VIIRS only)
  │      └─ 3. MODIS Tab (MODIS only)
  │      └─ Splits each run into recentFireEvents (<=12h) & pastFireEvents (>12h) + t0 hindcast snapshots
  │
  ├──► Layer A: 14-Day Statistical Harmonization (lib/statistical-harmonization.js)
  │      ├─ Cross-sensor filter (MODIS >= 30%, VIIRS nominal/high)
  │      ├─ Local solar hour & orbital drift tagging -> 1 km / 0.25° hotspot-cell-day bins
  │      ├─ Log-linear VIIRS -> MODIS-eq transfer fit (LOO-CV + 90% PI) + 14d median/IQR baseline
  │      └─ Empirical multi-pass confirmation rates & 95% Wilson CIs (Tiers 1–3)
  │
  ├──► Layer B: Geodesic Event Fusion (lib/harmonization.js + lib/hotspots.js)
  │      ├─ 1.0 km Haversine matching + VIIRS 375 m coordinate lock + ±4.0h / ±5.5h drift window
  │      ├─ Preserves Tier 4 (<30% MODIS / VIIRS l) in points (<=12h) & points14d (14d) for UI filtering
  │      └─ 13-element point tuple linking every raw hotspot directly to its fire_final ID
  │
  └──► Synchronized Mapbox 3D Globe & Sidebar HUD (Hero.jsx + TimelineControls.jsx + layers.js)
         ├─ 5-step Harmonization Filter, 24h orbital pass scrubber, & dataset-anchored UTC calendar
         ├─ Interactive 14-day Cividis baseline strip & RECENT (<=12H) / PAST FIRES (14D) scope switch
         └─ On-map & sidebar Past Fire Hindcast rings (Initial Pass t0 vs Actual vs Model Predicted Spread)
```

### Key Codebase Modules

| Layer / Role | Module | Responsibility |
| :--- | :--- | :--- |
| **FIRMS Ingestion** | [`lib/firms.js`](lib/firms.js) | Chunked 14-day FIRMS CSV retrieval, deterministic `thinToGrid`, and `itemAcquiredMs` UTC timestamp normalization |
| **Pipeline Orchestrator** | [`lib/hotspots.js`](lib/hotspots.js) | `getCountryHotspots`, dataset-anchored `referenceEndMs`, three-tab tracking, `buildCombinedHarmonizedPoints`, and `points` / `points14d` packaging |
| **Layer A Engine** | [`lib/statistical-harmonization.js`](lib/statistical-harmonization.js) | Cross-sensor filtering, `hotspot-cell-day` aggregation, transfer calibration + LOO-CV, 14-day baseline anomaly/percentile, Wilson CIs |
| **Layer B Fusion** | [`lib/harmonization.js`](lib/harmonization.js) | Geodesic `1 km` matching, `localSolarHour` / `classifyOverpassFamily`, drift-aware coincidence windows, ordinal tiering |
| **ML & Hindcasts** | [`lib/fire-models.js`](lib/fire-models.js) | `/track_fires`, `/predict_all`, `/predict_event`, `/calculate_hazard`, `filterRecent12Hours`, `buildHindcastSnapshot`, `attachViirsModelsToCombined` |
| **Client Filter Engine** | [`lib/hotspot-data.js`](lib/hotspot-data.js) | `pointMatchesTierFilter` across all 5 filter steps, 6h/12h orbital pass slicing, and `filterWindow` state emission (`classifyHotspots`) |
| **On-Demand API** | [`app/api/fire-models/route.js`](app/api/fire-models/route.js) | Proxies hazard and spread inference for clicked fires (`use_hindcast_snapshot` for `t0` past-fire scoring) |
| **Map & HUD UI** | [`Hero.jsx`](app/components/Hero.jsx), [`TimelineControls.jsx`](app/components/globe/TimelineControls.jsx), [`CountrySidebar.jsx`](app/components/globe/CountrySidebar.jsx), [`FireInspectorPanel.jsx`](app/components/globe/FireInspectorPanel.jsx), [`OnMapFireHud.jsx`](app/components/globe/OnMapFireHud.jsx), [`layers.js`](app/components/globe/layers.js) | Synchronized Mapbox sources/layers (`HOTSPOT_SOURCE`, `TRACKED_FIRES_SOURCE`, `PREDICTION_SOURCE`, `selected-fire-actual-*`), controls, Cividis strip, and `# Methods Note` CSV exports |

---

## Two-Layer MODIS–VIIRS Harmonization Strategy

### 1. Why Naive Spatial Alignment & Sub-Pixel Splitting Fail

| Sensor / Platform | Nominal Resolution | Nominal Local Solar Overpass | Key Measurement Differences |
| :--- | :--- | :--- | :--- |
| **MODIS Terra** | `~1 km` (nadir) | `~10:30 / 22:30` | Morning/night orbit; stretches up to `~2 km × 4.8 km` at swath edges |
| **MODIS Aqua** | `~1 km` (nadir) | `~13:30 / 01:30` (drifting later) | Afternoon orbit coincident with VIIRS, subject to late-afternoon orbital drift |
| **VIIRS (S-NPP, N20, N21)** | `~375 m` (I-band) | `~13:30 / 01:30` | Higher sensitivity to smaller/cooler fires; onboard bow-tie deletion |

Splitting a single `1 km` MODIS pixel into a `3 × 3` grid of synthetic sub-pixels (or scaling counts linearly by pixel area) is explicitly rejected:
1. A fire covering a fraction of a pixel can trigger a `1 km` MODIS detection, so subdividing it fabricates up to 8 phantom detections and inflates burned-area estimates by up to `900%`.
2. VIIRS's `375 m` I-band resolves sub-pixel flaming activity invisible to MODIS's `1 km` threshold, making raw count ratios non-linear across ecosystems and seasons.
3. Radiative power (FRP) sums differently between sensors due to differing sub-pixel background subtraction over different swath footprints.

---

### 2. Layer A: 14-Day Statistical Harmonization & Regional Baseline

Implemented in [`lib/statistical-harmonization.js`](lib/statistical-harmonization.js) (`buildHarmonizationReport`):

1. **Cross-Sensor Consistency Filter (`aggregateCellDays`)**: Retains `MODIS >= 30%` confidence and `VIIRS nominal/high` (`n`/`h`) detections for statistical baselines so noisy low-confidence triggers do not bias series fits.
2. **Local Solar Overpass & Orbital Drift Flagging**: Approximates local solar hour (`UTC hour + lon / 15`) per observation, classifying passes into `afternoon_1330`, `terra_morning`, or `night_offpeak` and flagging late orbital drift (`terra_morning` `< 9.25` or `> 11.75` solar hours; `afternoon_1330` Aqua `< 12.25` or `> 15.0`).
3. **Sensor-Neutral `hotspot-cell-day` Grid Binning**: Deduplicates daily detections into `1 km` (`0.009°`) cells (`modisCellDays`, `viirsCellDays`, `combinedCellDays`) and `0.25°` synoptic cells while accumulating `totalFrpSum`. This removes within-cell clustering inflation and MODIS swath-edge overlap.
4. **VIIRS → MODIS-Equivalent Transfer Calibration (`fitOverlapTransferFunction`)**: Fits a log-linear regression over co-active days in the window (regularized toward an empirical `0.34` VIIRS-to-MODIS prior when overlap days are sparse), reporting **Leave-One-Day-Out Cross-Validation (LOO-CV)** metrics (`MAE`, `RMSE`, `bias`, `r2`, `qualityFlag`) and **90% prediction intervals**.
5. **14-Day Rolling Baseline & Event Context**: Evaluates today's MODIS-equivalent activity against prior days in the 14-day window (`median`, `iqr`, `anomalyRatio`, `anomalyDelta`, empirical `percentile`), attaching a lightweight `context` object to fire events.

---

### 3. Layer B: Geodesic Event Fusion & Ordinal Confidence Tiers

Implemented in [`lib/harmonization.js`](lib/harmonization.js) and `buildCombinedHarmonizedPoints` in [`lib/hotspots.js`](lib/hotspots.js):

1. **Spatial Coordinate Precedence**: Matches VIIRS and MODIS observations within **`1.0 km`** geodesic distance (Haversine). When matched, the map locks onto the sharper `375 m` VIIRS coordinate while retaining matching coarse MODIS records inside `matches`.
2. **Drift-Aware Coincidence Window**: Uses a nominal **`±4.0 hours`** window that automatically expands to **`±5.5 hours`** when `adaptiveDrift: true` detects orbital drift.
3. **Absence of Detection $\neq$ Extinction**: Cloud cover, smoke plumes, high viewing angles, or overpass gaps can hide active fronts. Points and tracks retain extinction timestamps carefully rather than prematurely declaring single missed passes extinguished.
4. **Ordinal Confidence Hierarchy (`Tier 1 > Tier 2 > Tier 3 > Tier 4`)**: Replaces arbitrary synthetic percentages with strict ordinal tiers backed by **empirical multi-pass tracker confirmation rates (`n_passes >= 2`) and 95% Wilson confidence intervals (`computeEmpiricalTierRates`)**:
   - **Tier 1 (`Dual-Confirmed`)**: VIIRS and MODIS corroborated within `1.0 km` and the coincidence window.
   - **Tier 2 (`VIIRS Solo`)**: Unmatched cross-sensor consistent VIIRS (`nominal` / `high`).
   - **Tier 3 (`MODIS Solo`)**: Unmatched cross-sensor consistent MODIS (`>= 30%`).
   - **Tier 4 (`Low / Below Threshold`)**: VIIRS `l` or MODIS `< 30%` (`!isCrossSensorConsistent`), preserved in `points` and `points14d` so users can toggle them via the Harmonization Filter without polluting Layer A baselines.

---

## The Bow-Tie Effect: Analysis & Mitigation

Both MODIS and VIIRS are cross-track scanning radiometers whose footprint grows off-nadir toward swath edges ($\pm 55^\circ$–$56^\circ$):

| Metric | MODIS (`Terra` / `Aqua`) | VIIRS (`S-NPP` / `NOAA-20` / `NOAA-21`) |
| :--- | :--- | :--- |
| **Nadir Spatial Resolution** | $1.0\text{ km} \times 1.0\text{ km}$ ($1\text{ km}^2$) | $0.375\text{ km} \times 0.375\text{ km}$ ($0.14\text{ km}^2$) |
| **Swath-Edge Pixel Growth** | Up to $\sim 4.8\text{ km} \times 2.0\text{ km}$ | Constrained to $\sim 0.75\text{ km} \times 0.75\text{ km}$ |
| **Swath-Edge Area Expansion** | Up to $\sim 10\text{ km}^2$ per pixel | Only $\sim 2\times$ ($\approx 0.3\text{ km}^2$) |
| **Consecutive Scan Overlap** | Up to $50\%$ overlap at swath edges | Dynamically deleted onboard (`3×1` → `2×1` → `1×1` aggregation + bow-tie deletion) |

Our architecture neutralizes MODIS bow-tie distortion at both layers:
- **Layer A** collapses all overlapping MODIS edge samples falling inside the same `0.009°` / `0.25°` cell on a given day into one `hotspot-cell-day`.
- **Layer B** suppresses redundant overlapping coarse MODIS points within `1.0 km` of high-resolution bow-tie-corrected VIIRS coordinates while retaining raw sensor metadata inside `matches`.

---

## Three Tracker Tabs, Python ML Inference & Past Fire Hindcasts

As detailed in [`models_explained.md`](models_explained.md) and implemented in [`lib/fire-models.js`](lib/fire-models.js):

### 1. 14-Day Tracking & 12-Hour Active Workflow

1. All 14 days of country-masked detections are tracked across **three separate `POST /track_fires` (`mask: "deployment"`) runs** (clustering hotspots per 12-hour pass within `0.75 km` and linking multi-day fires across passes within `1 km / 2 days` for wildland or `0.75 km / 1 day` for crop/other):
   - **`combined` (`MODIS + VIIRS`)**: Tracks all harmonized events, attaching VIIRS ML forecasts and hazard ratings strictly onto combined events backed by VIIRS evidence (`attachViirsModelsToCombined`).
   - **`viirs` (`VIIRS · ML`)**: Tracks VIIRS-only events (`S-NPP`, `NOAA-20`, `NOAA-21`), feeding `fire_events` directly to `/predict_all`, `/predict_event`, and `/calculate_hazard`.
   - **`modis` (`MODIS`)**: Tracks MODIS-only events (`prediction: null`, `hazard: null`) so VIIRS-trained ML parameters are never extrapolated onto MODIS detections.
2. `filterRecent12Hours` partitions each run around `referenceEndMs` into **active/recent fires (`<= 12h`, `is_past: false`)** and **past fires (`> 12h`, `is_past: true`)**.
3. `buildCombinedHarmonizedPoints` outputs a **13-element tuple**:
   `[lon, lat, frp, sensor, countWeight, acquired, extinguished, evidence, finalTier, confidence, satellite, matches, fireId]`
   packaged as both `points` (`<=12h`, capped at `4,000`) and `points14d` (merged `14d` window capped at `12,000`, prioritizing `<=12h` points).

### 2. VIIRS-Calibrated ML Models & Hazard Scoring

For every VIIRS-evidenced fire, the backend computes:
- **Hazard Rating (`0–100`, `POST /calculate_hazard`)**: A relative index (not a probability) combining three fitted pillars: **Fire behaviour (`0.52`)** (FRP, area, duration), **Terrain & fuel (`0.33`)** (slope, land cover fuel, vegetation), and **Previous-day Weather (`0.15`)** (temperature, wind, humidity, soil moisture), mapped to **Low** (`< 19`), **Moderate** (`19–25`), **High** (`26–37`), **Very High** (`38–54`), and **Extreme** (`>= 55`). Missing NASA POWER factors are flagged transparently in `hazard_missing_factors`.
- **Model 1 — Persistence (`HistGradientBoostingClassifier`)**: Calibrated probability that the fire continues burning in the next **12–24 hours**.
- **Model 2 — Expansion (8-feature Logistic Regression)**: Probability that detected area grows by **$\ge 1\text{ km}^2$ and $\ge 25\%$** over 12–24 hours (capped at Model 1 persistence probability; alert threshold `0.0845`).
- **Model 3 — Additional Area Envelope**: Empirical 10th / median / 90th-percentile expansion area by fire type (**Crop**: `1.13 / 1.27 / 1.69 km²`; **Wildland**: `1.13 / 1.55 / 2.81 km²`; **Other**: `1.13 / 1.41 / 2.44 km²`), rendered isotropically around the centroid because directional spread is not predictable from hotspots alone.

### 3. Past Fire Hindcast: Actual Spread vs. Model Predicted Spread

To let users validate forecasts against observed history across the 14-day window:
1. **Initial-Pass (`t0`) Reconstruction (`buildHindcastSnapshot`)**: Rewinds each past/multi-pass fire to its earliest orbital pass (`t0`), creating an `earlyFireEvent` (`initialAreaKm2`, initial FRP/detection count) alongside the observed final outcome (`actualFinalAreaKm2`, `actualAddAreaKm2`, `persisted`, `expandedActual`).
2. **Batch & On-Demand Hindcast Scoring**: `buildViirsModelBundle` pre-scores up to 25 past fires from `t0` (`pastPredictionsGeoJson`), while [`app/api/fire-models/route.js`](app/api/fire-models/route.js) accepts `use_hindcast_snapshot: true` to score any remaining past fire on click via `/predict_event`.
3. **On-Map Spread Overlay ([`layers.js`](app/components/globe/layers.js))**: Selecting a past fire draws:
   - **Initial Pass (`t0`) Footprint** (`selected_current_footprint`)
   - **Observed Actual Spread** (`selected_actual_footprint` — a 36-sector radial geodesic perimeter hugging actual detections, styled via `selected-fire-actual-fill` in `#10b981` and `selected-fire-actual-line` in `#34d399`)
   - **Model Predicted Spread & 90% Bound** (`selected_predicted_footprint` and `selected_p90_footprint` evaluated from `t0`)

---

## Interactive Controls, HUD & Scientific Exports

- **5-Step Harmonization Filter (`pointMatchesTierFilter` in [`lib/hotspot-data.js`](lib/hotspot-data.js))**: Active across all three tabs (`ALL`, `MODERATE+` cross-sensor consistent `MODIS >= 30%` & `VIIRS n/h`, `VIIRS+DUAL` / `MODIS >= 65%`, `HIGH+DUAL` `VIIRS H` / `MODIS >= 80%` / `Tier 1`, and `DUAL ONLY` Tier 1 coincidences).
- **24-Hour Orbital Pass Scrubber & UTC Calendar ([`TimelineControls.jsx`](app/components/globe/TimelineControls.jsx))**: Scrub `0–24h` (`6h` orbital slice with `12h` fallback), choose presets (`6h`, `12h`, `24h`, `7d`, `14d`) or custom UTC ranges anchored to dataset `referenceTime` (filtering `points14d` locally when in window), or click any square on the **14-day Cividis heatmap** (`selectedDay`) to focus detections and tracked fires on that UTC day.
- **Synchronized Map & Sidebar State ([`Hero.jsx`](app/components/Hero.jsx), [`CountrySidebar.jsx`](app/components/globe/CountrySidebar.jsx))**: `eventMatchesFilter` keeps `HOTSPOT_SOURCE`, `TRACKED_FIRES_SOURCE`, `PREDICTION_SOURCE`, `sortedEvents`, and sidebar telemetry counts aligned in real time.
- **Inspector, On-Map HUD & CSV Exports ([`FireInspectorPanel.jsx`](app/components/globe/FireInspectorPanel.jsx), [`OnMapFireHud.jsx`](app/components/globe/OnMapFireHud.jsx))**:
  - Toggle between **`RECENT (≤12H)`** and **`PAST FIRES (14D)`** fires right in the sidebar or on-map HUD.
  - Inspect Layer A `14D REGIONAL CONTEXT`, empirical tier Wilson CIs, Model 1–3 forecasts or `t0` Actual vs. Predicted hindcast readouts, and Hazard factor drivers.
  - Export **Harmonized Hotspots CSV** and **14-Day MODIS-Equivalent Daily Series CSV**, each stamped with `# Methods Note` provenance headers.

---

## Additional Documentation

- [`harmonization.md`](harmonization.md) — Detailed technical specification for Layer A, Layer B, workflow isolation, filtering, and hindcasts.
- [`models_explained.md`](models_explained.md) — Full model training methodology, validation metrics, and backend JSON/GeoJSON schemas.

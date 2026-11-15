# MODIS & VIIRS Harmonization Architecture

This document defines how `modis-viirs` reconciles **MODIS (`~1 km`)** and **VIIRS (`~375 m`)** active fire detections across NASA FIRMS feeds, avoiding physical pixel-splitting distortions while supporting **regional trend comparability (Layer A)**, **real-time fire tracking & VIIRS Python ML inference (Layer B)**, **interactive timeline/tier filtering**, and **past-fire hindcast validation (`t0` predicted vs. actual spread)**.

---

## 1. Why Naive Spatial Alignment Fails

Splitting a `1 km` MODIS pixel into seven `375 m` VIIRS sub-pixels—or downscaling MODIS brightness temperature/FRP linearly by pixel area—introduces severe physical errors:

1. **Non-linear Detection Probability**: VIIRS's `~375 m` I-band resolves small, low-intensity, or cooler sub-pixel fires that remain below MODIS's `~1 km` detection threshold. Multiplying or dividing pixel counts ignores sensor sensitivity differences.
2. **MODIS Bow-Tie Growth**: Off-nadir MODIS scan geometry stretches ground pixels toward scan edges (`up to ~2 km × 5 km`), inflating apparent spatial overlap without uniform sub-pixel intensity.
3. **FRP Summation Bias**: VIIRS fire radiative power (FRP) sums differently than MODIS because sub-pixel background temperature subtraction differs by swath footprint.

---

## 2. Adopted Hybrid Two-Layer Strategy

Following an evaluation of the two-layer harmonization framework against the project's live **14-day FIRMS ingestion → tracker tabs → interactive 14-day/24h timeline & tier filtering → VIIRS-calibrated Python ML & hindcast** workflow:

- **Full archival 25-year Layer A** (`MODIS 2001+` vs `VIIRS 2012+`) cannot run directly inside FIRMS's rolling **14-day** API window.
- Instead, we run **Layer A over the 14-day ingested FIRMS window** (`lib/statistical-harmonization.js`) and fuse it with **Layer B operational fire tracking** (`lib/harmonization.js`), **interactive point + event synchronization** (`lib/hotspot-data.js`, `TimelineControls.jsx`, `Hero.jsx`), and **VIIRS-isolated Python ML forecasts & `t0` hindcasts** (`lib/fire-models.js`, `lib/hotspots.js`, `layers.js`).

```text
FIRMS 14-Day Detections (MODIS + VIIRS, dataset-anchored via itemAcquiredMs)
  │
  ├──► Layer A: Statistical & Baseline Engine (lib/statistical-harmonization.js)
  │      ├─ Cross-sensor consistency filter (MODIS >= 30%, VIIRS nominal/high)
  │      ├─ Solar-local overpass family & orbital drift detection (~13:30 Aqua/S-NPP/N20 vs Terra/night)
  │      ├─ Grid binning into 1 km (~0.009°) & 0.25° hotspot-cell-days
  │      ├─ Overlap transfer fit (log-linear VIIRS -> MODIS-eq + 0.34 empirical prior + LOO-CV + 90% PI)
  │      └─ 14d robust baseline (prior-day median, IQR, anomalyRatio, percentile -> event context)
  │
  ├──► Layer B: Operational Fire Fusion & Tracking (lib/harmonization.js + lib/fire-models.js)
  │      ├─ Separate 14-day tracker runs (combined, viirs, modis) -> recentFireEvents (<=12h) & pastFireEvents (>12h)
  │      ├─ Geodesic 1.0 km + adaptive ±4.0h / ±5.5h drift-aware coincidence matching
  │      ├─ Ordinal confidence tiers (Tier 1 > Tier 2 > Tier 3 > Tier 4) + 95% Wilson CIs
  │      ├─ 13-element harmonized points (<=12h points & 14d points14d linked via fireId)
  │      └─ VIIRS ML & Hazard isolated to VIIRS-evidenced fires (+ t0 hindcasts for past fires)
  │
  └──► Synchronized Map & HUD Filtering (TimelineControls.jsx + Hero.jsx + layers.js)
         ├─ 5-step Harmonization Filter (all / moderate+ / viirs+dual / high+dual / dual only)
         ├─ 24-hour scrubber, UTC calendar presets/ranges, & clickable 14-day Cividis day cells
         └─ On-map & sidebar Past Fire Hindcast comparison (Initial Pass t0 vs Actual vs Predicted Spread)
```

---

## 3. Layer A: 14-Day Regional Statistical Harmonization

Implemented in [`lib/statistical-harmonization.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/statistical-harmonization.js):

1. **Cross-Sensor Consistency Filtering (`aggregateCellDays`)**:
   - Retains `MODIS >= 30%` confidence and `VIIRS` `nominal` / `high` detections for statistical series construction (`low` or `<30%` detections are excluded from baseline regressions to prevent sensor noise bias while remaining preserved as **Tier 4** points in Layer B for interactive user filtering).
2. **Solar Overpass & Orbital Drift Classification (`localSolarHour`, `classifyOverpassFamily`)**:
   - Approximates local solar time (`UTC hour + lon / 15`), grouping passes into `afternoon_1330` (Aqua / Suomi NPP / NOAA-20), `morning_terra`, or `nighttime`, and flags late afternoon Aqua drift (`>14:15` local solar hour).
3. **Sensor-Neutral `hotspot-cell-day` Binning**:
   - Deduplicates same-day detections into `1 km` (`0.009°`) grid cells (`modisCellDays`, `viirsCellDays`, `combinedCellDays`) and `0.25°` synoptic cells so clustered `375 m` VIIRS fragments or swath overlaps are normalized per cell per UTC day.
4. **VIIRS → MODIS-Equivalent Transfer Calibration (`fitOverlapTransferFunction`)**:
   - Fits a log-linear regression on overlapping active days (`modisCellDays > 0 && viirsCellDays > 0`), blending toward an empirical `0.34` VIIRS-to-MODIS transfer prior under sparse sample sizes.
   - Computes **Leave-One-Day-Out Cross-Validation (LOO-CV)** metrics (`MAE`, `RMSE`, `bias`, `r2`, and `qualityFlag`) and **90% prediction intervals** (`[low, high]`).
5. **14-Day Baseline & Anomaly Context (`buildHarmonizationReport`)**:
   - Computes the baseline over prior days in the 14-day window (excluding the evaluated day): `median`, `iqr`, `anomalyRatio`, `anomalyDelta`, and empirical `percentile`.
   - Emits a lightweight `context` object (`{ modisEquivalent, median, iqr, anomalyRatio, percentile, unit, qualityFlag }`) attached onto Layer B fire events.

---

## 4. Layer B: Geodesic Fire Event Fusion & Ordinal Confidence

Implemented in [`lib/harmonization.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/harmonization.js) and [`lib/hotspots.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/hotspots.js):

1. **Adaptive Spatial–Temporal Coincidence (`harmonizeHotspots`)**:
   - Matches VIIRS and MODIS detections within **`1.0 km`** geodesic distance (Haversine) and nominal **`±4 hours`** (`4 * 3600 * 1000 ms`), automatically widening to **`±5.5 hours`** when `adaptiveDrift: true` detects afternoon orbital drift (`13:30` overpass offset).
2. **Ordinal Confidence Tiers (Replacing Arbitrary Fixed Percentages)**:
   - Ranks detections strictly as **`Tier 1 > Tier 2 > Tier 3 > Tier 4`** without claiming invented `95–100%` calibrated probabilities:
     - **Tier 1 (High Multi-Sensor)**: VIIRS + MODIS corroboration within the coincidence window (`finalTier = 1`).
     - **Tier 2 (High Single-Sensor)**: Nominal/High VIIRS (`n` / `h`) or high-confidence MODIS (`>= 80%`).
     - **Tier 3 (Moderate / Unconfirmed)**: Nominal MODIS `30–79%` confidence.
     - **Tier 4 (Low / Thermal Anomaly Risk)**: Low-confidence VIIRS (`l`) or MODIS `< 30%`, tagged via `!isCrossSensorConsistent(sensor, confidence)`.
   - **Empirical Validation (`computeEmpiricalTierRates`)**: Computes observed multi-pass tracker confirmation rates (`confirmed / total`) and **95% Wilson confidence intervals** directly from the 14-day tracker dataset, surfaced in `TimelineControls.jsx`.

---

## 5. Workflow Isolation: 14-Day Ingestion, Three Tracker Tabs & Python ML

Implemented across [`lib/firms.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/firms.js), [`lib/hotspots.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/hotspots.js), and [`lib/fire-models.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/fire-models.js):

- **Timestamp & Dataset Window Anchoring**:
  - `fetchDetections14Days` and `itemAcquiredMs` in [`lib/firms.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/firms.js) extract UTC timestamps cleanly across `item.acquired`, `item.trackerHotspot._acquired`, and `item.row[4]` so historical and NRT CSV chunks preserve true acquisition times.
  - `getCountryHotspots` in [`lib/hotspots.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/hotspots.js) anchors `referenceEndMs` to the maximum detection timestamp in `insideItems` (`cutoffRecentMs = referenceEndMs - 12h`), preventing wall-clock drift from emptying recent windows.
- **Full 14-Day Point Preservation & Event Linkage (`buildCombinedHarmonizedPoints`)**:
  - Harmonizes all 14 days of `insideItems`, preserves Tier 4 detections (`<30%` MODIS / VIIRS `l`) so interactive confidence scrubbing can show or hide them on demand, and links each point to its tracked `fire_final` ID via key, coordinate, or nearest-detection matching.
  - Outputs a **13-element point tuple**:
    `[lon, lat, frp, sensor, countWeight, acquired, extinguished, evidence, finalTier, confidence, satellite, matches, fireId]`
  - Emits both `points` (`<=12h`, up to `INSIDE_LIMIT = 4000`) and `points14d` (up to `POINTS_14D_LIMIT = 12000`), merged via `mergePointWindows` so `<=12h` points are prioritized and never thinned out.
- **Three Tracker Tabs & Recent vs. Past Split (`filterRecent12Hours`)**:
  - Every country fetch runs `trackFiresWithBackend(..., "deployment")` across all 14 days independently for `combined`, `viirs`, and `modis`, splitting outputs into `recentFireEvents` (`<=12h`, `is_past: false`) and `pastFireEvents` (`>12h`, `is_past: true`).
  - **`combined` (`MODIS + VIIRS`)**: Layer B geospatially harmonized detections + Layer A `harmonization` baseline + VIIRS-backed ML predictions and `0–100` hazard ratings matched onto VIIRS-evidenced combined events (`attachViirsModelsToCombined`).
  - **`viirs` (`VIIRS · ML`)**: VIIRS-only 14-day tracks with Python ML spread polygons (`predictionsGeoJson`), past-fire hindcast predictions (`pastPredictionsGeoJson`), and `0–100` hazard attribution, annotated with Layer A regional `context`.
  - **`modis` (`MODIS`)**: Pure MODIS tracker view (`prediction: null`, `hazard: null`) adhering to [`models_explained.md`](file:///Users/tariqmahmood/Projects/modis-viirs/models_explained.md) so VIIRS-trained ML weights are never extrapolated onto MODIS-only tracks.

---

## 6. Interactive Harmonization Filter, 24-Hour Scrubber & 14-Day Calendar

Implemented in [`lib/hotspot-data.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/hotspot-data.js), [`TimelineControls.jsx`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/globe/TimelineControls.jsx), [`Hero.jsx`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/Hero.jsx), and [`CountrySidebar.jsx`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/globe/CountrySidebar.jsx):

- **5-Step Harmonization Filter (`pointMatchesTierFilter`)** — active across all three tabs (`combined`, `viirs`, `modis`):
  - `0` (`all`): All detections across Tiers 1–4.
  - `1` (`moderate_plus`): Cross-sensor consistent subset (`MODIS >= 30%` & `VIIRS nominal/high`, excluding Tier 4).
  - `2` (`viirs_and_dual`): Non-low VIIRS 375 m detections, Tier 1 dual-confirmed detections, and `MODIS >= 65%` detections (`MODIS ≥65%` in the MODIS tab).
  - `3` (`high_and_dual`): High-confidence detections only (`VIIRS H`, `MODIS >= 80%`, and Tier 1 dual-confirmed).
  - `4` (`dual_only`): Tier 1 Dual-confirmed (`MODIS + VIIRS` within `1 km` & adaptive `±4–5.5 h` window).
- **24-Hour Scrubber & Orbital Pass Slicing (`classifyHotspots`)**:
  - Scrubs `hoursBack` across `0–24h` behind `referenceTime`, using a `6h` orbital pass slice (widening automatically to `12h` if a `6h` orbital gap yields zero detections) and counting distinct linked fire events alongside point totals.
- **Date & Time Calendar + Interactive 14-Day Cividis Cells**:
  - Anchors default form inputs and quick presets (`6h`, `12h`, `24h`, `7d`, `14d`) to `referenceTime`.
  - Filters `points14d` locally whenever the requested UTC interval overlaps the already-loaded 14-day window, only querying `/api/hotspots` remotely when the user jumps outside the loaded window.
  - Clicking any day square in the **14-day Cividis heatmap** toggles `selectedDay`, focusing both timeline controls and visible fires onto that UTC day.
- **Synchronized Map & Sidebar State**:
  - `Hero.jsx` filters tracked fires (`eventMatchesFilter`) in lockstep with `filterWindow`, `fireListScope`, and `selectedDay`, updating `HOTSPOT_SOURCE`, `TRACKED_FIRES_SOURCE`, `PREDICTION_SOURCE`, `sortedEvents`, and `CountrySidebar.jsx` live telemetry counts simultaneously.

---

## 7. Past Fire Hindcast: Actual Spread vs. Model Predicted Spread

Implemented across [`lib/fire-models.js`](file:///Users/tariqmahmood/Projects/modis-viirs/lib/fire-models.js), [`app/api/fire-models/route.js`](file:///Users/tariqmahmood/Projects/modis-viirs/app/api/fire-models/route.js), [`layers.js`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/globe/layers.js), [`FireInspectorPanel.jsx`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/globe/FireInspectorPanel.jsx), and [`OnMapFireHud.jsx`](file:///Users/tariqmahmood/Projects/modis-viirs/app/components/globe/OnMapFireHud.jsx):

1. **Initial-Pass (`t0`) Snapshot Reconstruction (`buildHindcastSnapshot`)**:
   - Rewinds each multi-pass or past fire to its earliest orbital pass (`t0`), synthesizing an `earlyFireEvent` (`initialAreaKm2`, initial FRP/detection counts) paired with the fire's observed final outcome (`actualFinalAreaKm2`, `actualAddAreaKm2`, `persisted`, `expandedActual`).
2. **Batch & On-Demand Hindcast Scoring**:
   - `buildViirsModelBundle` pre-scores up to 25 top past fires from their `t0` `earlyFireEvent` (`pastPredictionsGeoJson`, plus hazard attribution for multi-pass fires) and links them onto `combined` past fires in `attachViirsModelsToCombined`.
   - Selecting any unscored past fire triggers `/api/fire-models` with `use_hindcast_snapshot: true`, running `/predict_event` against `fireEvent.hindcast.earlyFireEvent`.
3. **On-Map Spread Comparison (`buildSelectedFireSpreadGeoJson` & `buildActualSpreadGeometry`)**:
   - **`selected_current_footprint`**: Initial Pass (`t0`) footprint (or current footprint for active fires).
   - **`selected_actual_footprint`**: 36-sector radial geodesic perimeter hugging the fire's observed detections (`selected-fire-actual-fill` in `#10b981`, `selected-fire-actual-line` in `#34d399`).
   - **`selected_predicted_footprint` & `selected_p90_footprint`**: Model 1–3 predicted spread (`12–24h`) and 90% spread bound evaluated from `t0`, rendered concurrently so users can inspect forecast accuracy directly against the observed perimeter.
4. **Scope Switching UI**:
   - `FireInspectorPanel.jsx` and `OnMapFireHud.jsx` provide `RECENT (≤12H)` vs `PAST FIRES (14D)` scope toggles (`.fire-scope-switch` / `.map-scope-switch`) and side-by-side **Actual Spread vs. Model Predicted Spread** comparison readouts.

---

## 8. UI Presentation, Exports & Scientific Transparency

- **`TimelineControls.jsx`**: Displays ordinal tier ranking (`Tier 1 > 2 > 3 > 4`), active tab confidence rules, and live empirical multi-pass confirmation percentages with 95% Wilson CIs on hover.
- **`FireInspectorPanel.jsx`**:
  - Renders the **Harmonized 14d Baseline (Layer A)** card with MODIS-equivalent activity + 90% PI, anomaly ratio/percentile vs 14-day median/IQR, the interactive **14-day Cividis heatmap strip** (dashed outlines flag extrapolated/uncertain days; clicking a day filters the map), transfer factor & LOO-CV diagnostics, and **CSV exports** (raw harmonized hotspots and 14-day MODIS-eq daily series stamped with `# Methods Note` metadata headers).
  - **Selected Fire Inspector** presents the Layer A `14D REGIONAL CONTEXT` pill, tracker pass history, VIIRS ML spread forecasts or `t0` hindcast accuracy comparison, and hazard feature drivers.
- **`OnMapFireHud.jsx`**: Surfaces active fire hazard rating, spread rings legend (`Initial Pass (t0)` / `Current Spread`, `Actual Spread`, `Predicted Spread` / `12–24h Spread`, `90% Bound`, `Pass Trail`), and `14d Baseline` regional context directly on the map canvas.

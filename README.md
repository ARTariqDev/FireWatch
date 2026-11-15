# MODIS & VIIRS Fire Watch Platform

A 3D Mapbox geospatial platform and Next.js application that reconciles NASA FIRMS **MODIS (`~1 km`)** and **VIIRS (`~375 m`)** active fire detections into a **Two-Pipe Architecture**:

- **Pipe A — 3-Pillar Single Source of Truth (SSOT) Harmonization (`SSOT · HARMONIZED`)**: Reconciles operational lifecycle asymmetry (`2000–2026`), optical lens & elliptical `GIFOV` geometry (`scan × track`, `375 m` vs. `1 km`, MODIS bow-tie distortion), non-additive FRP reconciliation, 3-regime temporal ($\Delta t$) deduplication, overpass-aware MODIS false-alarm gating, `LOO-CV` statistical calibration, and an interactive **`14D DAILY SSOT` + `2001–2026 MONTH×YEAR`** Fire Activity Calendar with CSV exports.
- **Pipe B — Isolated 14-Day Fire Tracking, VIIRS ML Prediction & `t0` Hindcasts**: Preserves three independent 14-day tracker runs (`SSOT · HARMONIZED`, `VIIRS · ML`, `MODIS`), Pakistan-calibrated VIIRS Hazard (`0–100`) and spread models (Models 1–3), and on-map **`t0` Past-Fire Hindcast Validation (Initial Pass vs. Actual vs. Model Predicted Spread)**.

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

Open [http://localhost:3000](http://localhost:3000) in your browser. Country views default to **3D terrain** (e.g. `PAK`) and load country boundaries alongside NASA FIRMS thermal detections, SSOT harmonized layers, tracked fire models, and the Fire Activity Calendar.

### Core API Endpoints

- `GET /api/country?country=PAK` — Returns the target country polygon, focus bounding box, and metadata (substitute any supported ISO alpha-3 country code).
- `GET /api/hotspots?country=PAK[&date=YYYY-MM-DD&dayRange=N]` — Fetches the 14-day MODIS + VIIRS FIRMS archive/NRT feed inside country boundaries (`scan × track` footprints + UTC acquisition timestamps), executes Pipe A (3-Pillar SSOT reconciliation + `2001–2026` Month × Year climatology) and Pipe B (three isolated `POST /track_fires` runs for `combined`, `viirs`, and `modis`, VIIRS ML spread/hazard inference, and `t0` past-fire hindcasts), and returns both `<=12h` active views and `14d` lookback arrays. Refreshes automatically every 30 minutes or on demand.
- `POST /api/fire-models` — On-demand hazard and spread scoring via `/calculate_hazard` and `/predict_event` for selected fires, including `use_hindcast_snapshot: true` to evaluate past fires from their initial-pass (`t0`) state.

---

## Architecture & End-to-End Pipeline

```text
NASA FIRMS 14-Day Detections (MODIS Terra/Aqua + VIIRS S-NPP / NOAA-20 / NOAA-21)
  │  (chunked NRT/archive ingestion, UTC itemAcquiredMs normalization, & scan × track km footprints)
  ▼
Country Mask & Dataset Reference Anchor (lib/hotspots.js)
  ├─ Anchors referenceEndMs to max detection timestamp in-country (cutoffRecentMs = referenceEndMs - 12h)
  │
  ├──► PIPE B: Three Independent 14-Day Tracker Runs (lib/fire-models.js -> Python /track_fires)
  │      ├─ 1. SSOT · HARMONIZED Tab (combined MODIS + VIIRS, attaches VIIRS ML + per-fire .ssot provenance)
  │      ├─ 2. VIIRS · ML Tab (VIIRS only -> Hazard 0–100 + Models 1–3 + t0 Hindcasts)
  │      └─ 3. MODIS Tab (MODIS only; VIIRS ML intentionally disabled)
  │      └─ Partitions each run into recentFireEvents (<=12h) & pastFireEvents (>12h) + t0 snapshots
  │
  ├──► PIPE A (Physical & Temporal SSOT): 3-Pillar Reconciliation (lib/harmonization.js)
  │      ├─ Pillar 2: Elliptical GIFOV (scan × track + 0.25 km uncertainty via isInsideGifovEllipse)
  │      ├─ Pillar 3: 3-Regime Δt gating (coincident_dual <=90m/3h, diurnal_bridged <=5.5h @ 0.5 km/h,
  │      │             sub_resolution_viirs, modis_gap_fill, demoted_modis_anomaly, low_conf_*)
  │      ├─ Non-additive FRP diagnostics (ssotFrpSum, frpRatio = FRP_M / Σ FRP_V) & MODIS dup suppression
  │      └─ Outputs 14-element point tuple: indices 0..12 preserved (fireId @ 12) + SSOT meta @ index 13
  │
  ├──► PIPE A (Statistical & Climatological): Transfer & 2001–2026 Calendar (lib/statistical-harmonization.js)
  │      ├─ Cross-sensor filter (MODIS >= 30%, VIIRS n/h), local solar hour, & orbital drift detection
  │      ├─ 1 km (0.009°) & 0.25° hotspot-cell-day bins + canonical ssotFrpSum + daily regime counts
  │      ├─ Log-linear VIIRS -> MODIS-eq calibration (LOO-CV MAE/RMSE/Bias + 90% PI) + 14d baseline
  │      └─ buildMonthlyClimatologySeries: 2001–2026 Month×Year (modis_era + overlap_era, live FIRMS overlay)
  │
  └──► Synchronized Mapbox 3D Globe, Sidebar HUD & Calendar (Hero.jsx + FireActivityCalendar.jsx + layers.js)
         ├─ Tier-aware Mapbox styling (Tier 3 amber GIFOV halo hotspots-modis-footprint, Tier 4 0.42 dimmed)
         ├─ 5-step Harmonization Filter, 24h orbital pass scrubber, & synced YYYY-MM-DD..YYYY-MM-DD range filter
         ├─ Fire Activity Calendar (14D DAILY SSOT + 2001–26 MONTH×YEAR) + Dual # Methods Note CSV exports
         └─ On-map & sidebar Past Fire Hindcast rings (Initial Pass t0 vs Actual vs Model Predicted Spread)
```

### Key Codebase Modules

| Layer / Role | Module | Responsibility |
| :--- | :--- | :--- |
| **FIRMS Ingestion** | [`lib/firms.js`](lib/firms.js) | Chunked 14-day FIRMS CSV retrieval, deterministic `thinToGrid`, `itemAcquiredMs` UTC normalization, and `scan` × `track` footprint extraction (`[8, 9]` / `[7, 8]`) |
| **Pipeline Orchestrator** | [`lib/hotspots.js`](lib/hotspots.js) | `getCountryHotspots`, `referenceEndMs` anchoring, three-tab tracking, `buildCombinedHarmonizedPoints` (14-element tuple with `meta` at index `13`), per-fire `.ssot` provenance, and `points` / `points14d` packaging |
| **SSOT Physical Fusion** | [`lib/harmonization.js`](lib/harmonization.js) | `isInsideGifovEllipse` (`scan × track` containment), `harmonizeHotspotsWithDiagnostics` (3-regime $\Delta t$ reconciliation, overpass-aware MODIS false-alarm demotion, non-additive `frpRatio`), `localSolarHour`, and `classifyOverpassFamily` |
| **SSOT Statistical Engine** | [`lib/statistical-harmonization.js`](lib/statistical-harmonization.js) | Cross-sensor filtering, `hotspot-cell-day` (`0.009°` & `0.25°`) aggregation with `ssotFrpSum`, transfer calibration + `LOO-CV`, `buildMonthlyClimatologySeries` (`2001–2026` Month × Year + `isObservedFirms` live cells), and 95% Wilson CIs |
| **Pipe B ML & Hindcasts** | [`lib/fire-models.js`](lib/fire-models.js) | `/track_fires`, `/predict_all`, `/predict_event`, `/calculate_hazard`, `filterRecent12Hours`, `buildHindcastSnapshot`, and `attachViirsModelsToCombined` |
| **Client Filter Engine** | [`lib/hotspot-data.js`](lib/hotspot-data.js) | `pointMatchesTierFilter` across all 5 filter steps, 6h/12h orbital pass slicing, and `classifyHotspots` (`filterWindow` state emission) |
| **On-Demand API** | [`app/api/fire-models/route.js`](app/api/fire-models/route.js) | Proxies hazard and spread inference for clicked fires (`use_hindcast_snapshot: true` for `t0` past-fire scoring) |
| **Map Layers & Styling** | [`app/components/globe/layers.js`](app/components/globe/layers.js) | Unpacks `point[13]` `meta`, renders `hotspots-modis-footprint` amber halos (Tier 3), excludes Tier 4 from `pulseFilter` & dims opacity (`0.42`), plus tracked/predicted/actual `t0` spread layers |
| **Activity Calendar & CSV** | [`app/components/globe/FireActivityCalendar.jsx`](app/components/globe/FireActivityCalendar.jsx) | Interactive `14D DAILY SSOT` + `2001–26 MONTH×YEAR` heatmap, multi-day & `Shift+click` range selection, 4 metrics (`MODIS-EQ`, `FRP`, `ANOM`, `SSOT`/`ERA`), and dual `# Methods Note` CSV exports |
| **Globe HUD & Controls** | [`Hero.jsx`](app/components/Hero.jsx), [`CountrySidebar.jsx`](app/components/globe/CountrySidebar.jsx), [`FireInspectorPanel.jsx`](app/components/globe/FireInspectorPanel.jsx), [`TimelineControls.jsx`](app/components/globe/TimelineControls.jsx), [`OnMapFireHud.jsx`](app/components/globe/OnMapFireHud.jsx), [`hud.css`](app/components/globe/hud.css) | `SSOT · HARMONIZED` default tab, `.ssot-regime-strip`, `.inspector-ssot-pill`, bidirectional `YYYY-MM-DD..YYYY-MM-DD` date-range sync, and on-map spread cards |

---

## Pipe A: 3-Pillar Single Source of Truth (SSOT) Harmonization Strategy

Why boolean splitting (`VIIRS only`, `MODIS only`, `MODIS + VIIRS`) and naive pixel subdivision fail:
1. A fire covering only a small fraction of a pixel can trigger a `1 km` MODIS detection, so subdividing `1 km` MODIS pixels into synthetic `375 m` cells invents phantom fires and inflates burned area up to `900%`.
2. Counting raw co-located MODIS (`1 km`) and VIIRS (`375 m`) points or summing their FRP double-counts the exact same thermal anomaly.
3. Uncoordinated MODIS (`~10:30` Terra & drifting `~13:30+` Aqua) vs. VIIRS (`~13:30` S-NPP/N20/N21) overpasses turn real diurnal fire persistence (`~3h` apart) into apparent disagreement unless time delays are explicitly modeled.

Our Pipe A SSOT engine resolves all three physics asymmetries:

### Pillar 1 — Operational Lifecycle Asymmetry (`2000–2026` & Climatology)

| Sensor / Platform | Nominal Nadir Resolution | Local Solar Overpass | Operational Lifecycle Role |
| :--- | :--- | :--- | :--- |
| **MODIS Terra** | `~1 km` (`~2 × 4.8 km` edge) | `~10:30 / 22:30` | Morning/night anchor since `2000`; bridges morning starts before afternoon VIIRS passes |
| **MODIS Aqua** | `~1 km` (`~2 × 4.8 km` edge) | `~13:30 / 01:30` (drifting) | Afternoon archive continuity since `2002`; orbital drift flagged automatically |
| **VIIRS (S-NPP, N20, N21)** | `~375 m` (`~0.75 × 0.75 km` edge) | `~13:30 / 01:30` | Sub-resolution sensitivity & onboard bow-tie deletion since `2012` |

- **Cross-Sensor Statistical Baseline (`aggregateCellDays`)**: Filters to `MODIS >= 30%` confidence and `VIIRS nominal/high` (`n`/`h`), deduplicates into `0.009°` (`~1 km`) and `0.25°` `hotspot-cell-day` bins, records canonical `ssotFrpSum` (eliminating dual-sensor FRP double-counting), and tracks daily SSOT regime counts (`coincidentDual`, `diurnalBridged`, `subResolutionViirs`, `modisGapFill`, `demotedAnomalies`).
- **Transfer Calibration & Validation (`fitOverlapTransferFunction`)**: Calibrates `VIIRS -> MODIS-equivalent` cell-days via log-linear regression regularized toward the empirical `0.34` prior, reporting **LOO-CV** `MAE`, `RMSE`, `bias`, `r2`, `qualityFlag`, and **90% prediction intervals**.
- **2001–2026 Month × Year Climatology (`buildMonthlyClimatologySeries`)**: Separates **`modis_era` (`2001–2011`)** and **`overlap_era` (`2012–2026`)**, overlays live/queried FIRMS cells (`isObservedFirms: true`) onto the regional historical curve, and computes out-of-sample monthly `median`, `iqr`, `anomalyRatio`, `percentile`, `topMonths`, and `topYears`.

### Pillar 2 — Optical Lens, Elliptical `GIFOV` Geometry & Bow-Tie Mitigation

1. **Actual `scan × track` Elliptical Containment (`isInsideGifovEllipse`)**: Rather than a fixed `1.0 km` circle, MODIS–VIIRS matching evaluates whether the `375 m` VIIRS point lies inside the actual off-nadir MODIS elliptical Ground Instantaneous Field of View (`semi-axis = 0.5 × scan/track + 0.25 km` geolocation uncertainty), neutralizing MODIS swath-edge stretching (`~4.8 km × 2.0 km`, `50%` consecutive scan overlap) and complementing VIIRS onboard bow-tie deletion (`3×1` → `2×1` → `1×1`).
2. **Spatial Lock & MODIS Suppression**: Any VIIRS pixels falling inside a corroborating MODIS `GIFOV` lock the SSOT spatial geometry to the sharper `375 m` VIIRS coordinates (`Tier 1`) and suppress the redundant `1 km` MODIS container centroid (`suppressedModisDuplicates`), storing corroborated MODIS metadata inside `matches`.
3. **Non-Additive FRP Reconciliation**: Overlapping sensors measure radiative power across different background apertures; SSOT never adds co-located MODIS + VIIRS FRP together. It reports VIIRS/canonical `ssotFrpSum` alongside the diagnostic ratio **`frpRatio = FRP_M / Σ FRP_V`**.
4. **Footprint Halo Rendering (`layers.js`)**: Tier 3 MODIS Gap-Fill nodes keep their true `footprintKm` and render with an amber halo (`hotspots-modis-footprint`) scaled by footprint width rather than masquerading as crisp `375 m` detections.

### Pillar 3 — Time Delays ($\Delta t$) & Overpass-Aware False-Alarm Gating

Implemented in `harmonizeHotspotsWithDiagnostics` ([`lib/harmonization.js`](lib/harmonization.js)):

| Regime | Gate Condition | SSOT Decision & Tier |
| :--- | :--- | :--- |
| **Regime A — `coincident_dual`** | Within MODIS `GIFOV` and `\|Δt\| ≤ 90 min` nominal (`≤ 3 h` under orbital drift) | **Tier 1 (Dual-Confirmed)**: Promoted to `375 m` VIIRS coordinates; `1 km` MODIS parent suppressed; `frpRatio` recorded |
| **Regime B — `diurnal_bridged`** | `90 min < \|Δt\| ≤ 5.5 h` within kinematic spread distance (`GIFOV + 0.5 km/h × Δt`) | **Tier 1 (Diurnal Bridged `t0+Δt`)**: Links Terra morning (`~10:30` LT) and afternoon VIIRS (`~13:30` LT); anchors initial ignition timestamp `t0` while locking `375 m` spatial coordinate to VIIRS |
| **Regime C — `sub_resolution_viirs`** | Solo VIIRS (`n`/`h`), no MODIS corroboration | **Tier 2 (VIIRS 375m Solo)**: Retained as small/cool/under-canopy active front missed by `1 km` MODIS |
| **Regime C — `modis_gap_fill`** | Solo MODIS (`>= 30%`), no VIIRS overpass within `±60 min` & `35 km` | **Tier 3 (MODIS 1km Gap-Fill)**: Preserved to capture fast agricultural burns or cloud gaps between VIIRS passes |
| **Regime C — `demoted_modis_anomaly`** | Solo MODIS uncorroborated while a VIIRS overpass covered within `±60 min` & `35 km` | **Tier 4 (Demoted / Low-Conf)**: Retained in `points` / `points14d` for full transparency, excluded from `pulseFilter`, dimmed to `0.42` opacity |
| **Low-Confidence Filter (`low_conf_*`)** | `MODIS < 30%` or `VIIRS l` | **Tier 4 (Below Cross-Sensor Threshold)**: Toggleable in the Harmonization Filter without polluting Layer A calibration |

---

## Pipe B: Three Tracker Tabs, VIIRS ML Models & Past-Fire `t0` Hindcasts

As detailed in [`models_explained.md`](models_explained.md) and orchestrated in [`lib/fire-models.js`](lib/fire-models.js) + [`lib/hotspots.js`](lib/hotspots.js):

1. **Three Isolated 14-Day Tracker Runs (`POST /track_fires`, `mask: "deployment"`)**:
   - **`SSOT · HARMONIZED` (`combined`)**: Tracks unified events, attaches VIIRS ML forecasts strictly to VIIRS-backed events (`attachViirsModelsToCombined`), and attaches `.ssot` event provenance (`primaryRegime`, `regimes`, `modisCorroboratedCount`, `frpRatio`, `scanMaxKm`).
   - **`VIIRS · ML` (`viirs`)**: Pure `S-NPP` / `NOAA-20` / `NOAA-21` track powering `/predict_all`, `/predict_event`, and `/calculate_hazard`.
   - **`MODIS` (`modis`)**: Pure Terra/Aqua track (`prediction: null`, `hazard: null`) so VIIRS-trained ML weights are never misapplied to `1 km` MODIS centroids.
2. **14-Element SSOT Point Tuple (`buildCombinedHarmonizedPoints`)**:
   - Indices `0..12` remain fully backwards-compatible: `[lon, lat, frp, sensor, countWeight, acquired, extinguished, evidence, finalTier, confidence, satellite, matches, fireId]`, with trailing SSOT diagnostics appended at index `13`: `meta = { scan, track, footprintKm, regime, frpRatio, overpassFamily }`.
   - Packaged as `points` (`<=12h`, capped at `4,000`) and `points14d` (merged `14d`, capped at `12,000`).
3. **VIIRS-Calibrated Hazard Rating & Spread Models (12–24h)**:
   - **Hazard Rating (`0–100`)**: Composite of **Fire behaviour (`0.52`)**, **Terrain & fuel (`0.33`)**, and **Previous-day Weather (`0.15`)** across five bands (**Low** `< 19`, **Moderate** `19–25`, **High** `26–37`, **Very High** `38–54`, **Extreme** `>= 55`).
   - **Model 1 — Persistence (`HistGradientBoostingClassifier`)** · **Model 2 — Expansion** (`>= 1 km²` and `>= 25%`, `P >= 0.0845` alert threshold) · **Model 3 — Additional Area Envelope** (10th / median / 90th-percentile isotropic growth by fire type).
4. **Past Fire Hindcast (`buildHindcastSnapshot` & `layers.js`)**:
   - Rewinds past/multi-pass fires (`>12h`) to their earliest pass (`t0`), scores `use_hindcast_snapshot: true` via `/predict_event`, and renders **Initial Pass (`t0`)**, **Observed Actual Spread** (`selected-fire-actual-fill` / `selected-fire-actual-line`), and **Model Predicted Spread + 90% Bound** directly on the 3D globe.

---

## Interactive Fire Activity Calendar View, Filters & CSV Exports

Implemented in [`app/components/globe/FireActivityCalendar.jsx`](app/components/globe/FireActivityCalendar.jsx), [`FireInspectorPanel.jsx`](app/components/globe/FireInspectorPanel.jsx), and [`TimelineControls.jsx`](app/components/globe/TimelineControls.jsx):

- **Two Synchronized Calendar Views**:
  - **`14D DAILY SSOT`**: 7-column interactive grid showing day-of-week headers, orbital drift flags, single-day click filtering, **`Shift+click` date-range selection**, **`✓ MULTI-DAY`** toggle, and quick presets (`All 14d`, `Active`, `Clear ×`). Date selections synchronize bi-directionally with `TimelineControls` using `"YYYY-MM-DD..YYYY-MM-DD"` intervals so map hotspots and tracked fires filter live.
  - **`2001–26 MONTH×YEAR`**: Scrollable 26-year heatmap (`modis_era` `2001–2011` and `overlap_era` `2012–2026`) with era filters (`2001–26`, `2012+ Overlap`, `2001–11 MODIS`), `Peak≥P80` preset, clickable year rows and month columns, a pinned **`MED`** historical baseline row, and green borders distinguishing live/queried FIRMS cells (`isObservedFirms`) from seasonal regional baseline cells.
- **Four Scientific Metric Modes**:
  - `MODIS-EQ` (Cividis scale) · `FRP` (MW) · `ANOM` (diverging blue–slate–amber–red vs. median) · `SSOT` / `ERA` (3-regime daily breakdown bar or historical sensor-era key), paired with a live **Selection Summary** strip (`SCOPE`, `MODIS-EQ SUM`, `PEAK PERIOD`, `TOTAL FRP / DET`).
- **Dual Scientific CSV Exports (with `# Methods Note` Provenance Headers)**:
  - **`↓ Export Selected Calendar CSV`**: Exports selected (or all) `14D DAILY SSOT` rows (`modis_equivalent`, `pi90_lower`, `pi90_upper`, `ssot_frp_mw`, `coincident_dual`, `diurnal_bridged`, `sub_resolution_viirs`, `modis_gap_fill`, `demoted_anomalies`, `drift_detected`) or selected `2001–26 MONTH×YEAR` cells (`era`, `data_provenance`, `historical_month_median`, `anomaly_ratio`, `percentile`).
  - **`↓ Export Selected Hotspots CSV`**: Exports canonical SSOT detections filtered to the active calendar selection (`ssot_tier`, `ssot_regime`, `scan_km`, `track_km`, `frp_ratio_modis_viirs`, `matched_corroborations`, `overpass_family`, `fire_final`).

---

## Additional Documentation

- [`harmonization.md`](harmonization.md) — Full 3-Pillar SSOT specification, `GIFOV` math, 3-regime $\Delta t$ reconciliation, and Pipe A / Pipe B separation design.
- [`models_explained.md`](models_explained.md) — Model training methodology, validation metrics, and backend JSON/GeoJSON schemas.

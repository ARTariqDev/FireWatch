# MODIS & VIIRS Scientific Harmonization Architecture: Single Source of Truth (SSOT) Strategy

This document defines the scientific methodology and operational workflow for reconciling **MODIS (`~1000 m`)** and **VIIRS (`~375 m`)** thermal active-fire detections into an authoritative **Harmonized Single Source of Truth (SSOT) Default Map View**, while preserving the dual-pipe architecture required by our **Python ML spread models, `0–100` hazard ratings, and `t0` hindcast validation**.

---

## 1. Why Venn-Diagram Sensor Views (`VIIRS && !MODIS`, `!VIIRS && MODIS`, `MODIS + VIIRS`) Are Not Harmonization

Showing three mutually disconnected or naively merged sensor slices (`VIIRS-only`, `MODIS-only`, and `MODIS ∪ VIIRS`) does not harmonize the two sensors:

1. **Intersection (`VIIRS ∩ MODIS`) discards valid fires**: Requiring both sensors to trigger simultaneously drops roughly `70–85%` of real smaller, cooler, or freshly ignited fires that fall below MODIS's `~1 km` detection threshold (`375 m` VIIRS sensitivity advantage) as well as morning Terra fires occurring hours away from VIIRS passes.
2. **Naive Union (`VIIRS ∪ MODIS`) corrupts geometry and counts**: Rendering both sensors on the same canvas without radiometric and footprint reconciliation double-counts active fire fronts (`MODIS` swath overlaps + `MODIS–VIIRS` same-fire duplicates), mixes incompatible spatial footprints (`0.14 km²` vs `1.0–9.6 km²`), and inflates Fire Radiative Power (`MW`) when coarse and fine pixels are summed together.
3. **Splitting coarse MODIS pixels (`1 km → 3×3` grid) is physically invalid**: Because a small flaming front covering only `100–500 m²` can saturate or trigger an entire `1 km` MODIS pixel, subdividing a MODIS footprint fabricates up to 8 phantom fires and inflates burned area by up to `900%`.

**Scientific Harmonization Goal:** Derive a single canonical **Harmonized SSOT Default Map View** where every active fire front is represented once at the highest physically justifiable spatial precision (`375 m` when VIIRS observes it; calibrated footprint uncertainty when only MODIS observes it), with sensor-origin bias removed across **Lifecycle**, **Optical Lens Physics**, and **Orbital Time Delays**.

---

## 2. Pillar 1: Operational Lifecycle & Constellation Asymmetry (`2000 → 2026+`)

A valid harmonization model cannot treat all 5 spacecraft as symmetric peers; they occupy fundamentally different phases of their mission lifecycles:

| Platform / Sensor | Launch / Era | Operational Status & Orbit Drift | Primary Role in Harmonized SSOT |
| :--- | :--- | :--- | :--- |
| **MODIS Terra** (`EOS AM-1`) | Dec 1999 (`FIRMS Nov 2000+`) | **End-of-mission drift:** Morning plane drifting earlier (`< 10:30` solar local time); aging optics & wide bow-tie edges | **Diurnal Morning Gap-Filler & Precursor Node (`t0`)** — captures morning ignitions missed between afternoon/night VIIRS passes |
| **MODIS Aqua** (`EOS PM-1`) | May 2002 (`FIRMS Jul 2002+`) | **End-of-mission drift:** Afternoon plane drifting past `> 14:15–15:00` local solar time; widening temporal lag behind VIIRS | **Afternoon Cross-Corroborator** — upgrades coincident VIIRS detections to **Tier 1 Multi-Sensor Confirmed** |
| **VIIRS Suomi-NPP** | Oct 2011 (`FIRMS 2012+`) | Operational primary/secondary afternoon (`~13:30 / 01:30`); onboard bow-tie deletion | **Primary Reference Anchor** (`375 m` centroid, FRP, and ML model physics) |
| **VIIRS NOAA-20 (`JPSS-1`)** | Nov 2017 | Operational `~50 min` out-of-phase with S-NPP; controlled station-keeping (`~13:30 / 01:30`) | **Primary Reference Anchor** & gap eliminator across nadir/edge swaths |
| **VIIRS NOAA-21 (`JPSS-2`)** | Nov 2022 | Operational modern primary afternoon (`~13:30 / 01:30`); phased swath coverage | **Primary Reference Anchor** |

### Lifecycle Role Hierarchy

- **VIIRS is the Geometric & Radiometric Reference Frame**: Whenever VIIRS has overpass coverage over a burning area, its `375 m` I-band centroids, `0.14 km²` cell area, and summed FRP define the canonical fire geometry on the SSOT map.
- **MODIS is a Bayesian Corroborator & Temporal Gap-Filler**: Co-located MODIS corroboration boosts confidence in VIIRS detections (confirming the anomaly is real across independent instruments/wavelengths), while solo MODIS detections are retained **only** where/when VIIRS has diurnal or swath gaps (or gated by quality checks when VIIRS observed the same swath with zero detections).

---

## 3. Pillar 2: Optical / Lens Physics (`375 m` vs `1000 m`) & Scan-Angle Footprint Geometry

### 1. Ground Instantaneous Field of View (`GIFOV`) & The Bow-Tie Distortion

MODIS (`±55°` cross-track scan) and VIIRS (`±56°` scan) do not sample pixels as fixed squares:

| Optical Metric | MODIS (`M/B` `1000 m` Thermal Bands) | VIIRS (`I4/I5` `375 m` Imagery Bands) |
| :--- | :--- | :--- |
| **Nadir Pixel Footprint** | `1.0 km × 1.0 km` (`1.0 km²`) | `0.375 km × 0.375 km` (`0.14 km²`) |
| **Pixel Aggregation Scheme** | Unaggregated across swath (`1×1`) | Dynamic onboard aggregation (`3×1` `< 31.7°` → `2×1` `31.7°–44.8°` → `1×1` edge) |
| **Swath-Edge Pixel Growth** | Expands to **`~4.8 km × 2.0 km` (`~9.6–10 km²`)** via panoramic `1/cos²θ` stretch | Bounded to **`~0.75 km × 0.75 km` (`~0.30 km²`)** |
| **Adjacent Scan Bow-Tie Overlap** | Up to **`50%` overlap** at edge (same fire detected twice across scans) | **Deleted onboard** prior to downlink |
| **Minimum Detectable Fire** | Needs larger / hotter sub-pixel flaming fraction (`~1000 m` cell integration) | Detects cooler, smaller, smoldering, or fragmented fronts (`375 m` integration) |

### 2. Point-in-Ellipse Sub-Footprint Containment (Replacing Fixed Radius-Only Matching)

A `1000 m` nadir (or `4.8 × 2.0 km` swath-edge) MODIS detection physically encloses **$N \ge 1$** (often `3–20+`) `375 m` VIIRS pixels. Using a constant `1.0 km` circle misses matches near MODIS swath edges (`scan > 2.0 km`). Instead, spatial matching uses each observation's FIRMS `scan` and `track` dimensions to test **elliptical GIFOV overlap** (falling back to `1.0 km` geodesic distance when `scan`/`track` metadata is absent, as currently implemented in `lib/harmonization.js`):

$$\frac{\Delta x_{\text{scan}}^2}{\left(0.5 \cdot \text{scan}_M + 0.5 \cdot \text{scan}_V + \sigma_{\text{geo}}\right)^2} + \frac{\Delta y_{\text{track}}^2}{\left(0.5 \cdot \text{track}_M + 0.5 \cdot \text{track}_V + \sigma_{\text{geo}}\right)^2} \le 1$$

Where:
- $\Delta x_{\text{scan}}, \Delta y_{\text{track}}$ are East–West and North–South metric displacements rotated/scaled at pixel latitude ($\sigma_{\text{geo}} \approx 0.25\text{ km}$ geolocation uncertainty).
- **Many-to-One Sub-Footprint Suppression**: Every VIIRS detection enclosed inside a MODIS footprint links to that MODIS observation (`matches`), locking the visual centroid and active perimeter exclusively to the `375 m` VIIRS constellation while suppressing duplicate coarse MODIS pins.

### 3. Radiometric Reconciliation (`FRP_M` vs `Σ FRP_V`)

- **Never add MODIS + VIIRS FRP** ($\text{FRP}_{\text{total}} \neq \text{FRP}_M + \sum \text{FRP}_V$): When both sensors observe the same fire within the coincidence window, summing them double-counts the fire's radiative output.
- **Canonical Intensity Assignment**:
  - When VIIRS observes the fire front ($N \ge 1$ matched pixels): canonical intensity $= \sum_{i=1}^N \text{FRP}_{V,i}$, while retaining $\text{FRP}_M$ and ratio $\rho = \text{FRP}_M / \sum \text{FRP}_V$ as a cross-sensor radiometric audit diagnostic.
  - When only MODIS observes the pass (Gap-Fill regime): canonical intensity $= \text{FRP}_M$, annotated with coarse footprint provenance.

---

## 4. Pillar 3: Orbital Time Delays ($\Delta t$), Diurnal Cycle & 3-Regime Fusion

Matching MODIS and VIIRS requires separating **simultaneous redundant sensing** from **true fire growth across hours** while accounting for end-of-life Terra/Aqua orbital drift (`localSolarHour` & `classifyOverpassFamily` in `lib/harmonization.js`):

### Regime 1: Coincident / Near-Simultaneous Pass ($\Delta t \le 90\text{ min}$, or $\le 3.0\text{ h}$ with Aqua Drift)

Both constellations observed essentially the same atmospheric and diurnal burning state:

- **`VIIRS && MODIS` → Dual-Sensor Confirmed Front (`Tier 1`)**:
  - Suppress the coarse MODIS marker on the SSOT map.
  - Render the `375 m` VIIRS point(s)/perimeter with boosted multi-sensor certainty (**Tier 1**), attaching MODIS scan angle, confidence, and $\text{FRP}_M$ into `matches`.
- **`VIIRS && !MODIS` → Valid Sub-Resolution Active Fire (`Tier 2` / `Tier 4`)**:
  - Physically expected: fires `< 1 km` or lower temperature fall below MODIS's radiometric trigger threshold (`~4 µm` saturation/contrast) yet trigger `375 m` VIIRS I4.
  - **Retained unconditionally** in the SSOT map (confidence-filtered by user tier slider).
- **`!VIIRS && MODIS` → Overpass-Aware Disambiguation**:
  - Check whether VIIRS (`S-NPP`, `NOAA-20`, `NOAA-21`) actually had cloud-free swath overlap at that location within $\pm 60\text{ min}$.
  - If VIIRS **did not** pass over that swath (orbital gap/edge trim), retain MODIS as a **Gap-Fill Active Zone**.
  - If VIIRS **did** pass over the exact swath within $\pm 60\text{ min}$ and detected **zero** `375 m` hotspots, treat isolated low-confidence (`< 50%`) or extreme off-nadir (`scan > 2.5 km`) MODIS pixels as likely sunglint, bow-tie smearing, or warm-soil false positives (demoted below Tier 2 unless corroborated on a subsequent pass).

### Regime 2: Diurnal Sequential Bridging ($\Delta t \in (1.5\text{ h}, 5.5\text{ h}]$, e.g., Morning Terra → Afternoon VIIRS)

Terra (~09:30–10:30 local) observes an earlier diurnal phase than VIIRS (~13:30 local), during which wind and fuel moisture changes can shift a fire front by $1\text{–}3\text{ km}$:

- **Kinematic Linking Radius**:
  $$R_{\text{match}}(\Delta t) = r_{\text{footprint}}(\theta_M, \theta_V) + v_{\text{spread}} \cdot |\Delta t|$$
  (with typical spread rate $v_{\text{spread}} \approx 0.4\text{–}0.6\text{ km/h}$ capped by our adaptive drift window up to $\Delta t \le 5.5\text{ h}$).
- **Trajectory Treatment in SSOT**: Rather than counting morning MODIS and afternoon VIIRS as two separate fires (naive union) or hiding the morning pass completely, Terra is linked to the same **`fire_final` fire trajectory** as its **Precursor Node (`t0` early pass)**. The SSOT map displays the latest `375 m` VIIRS front as the active perimeter while preserving Terra's timestamp in `first_detection_utc`, pass trail, and duration metrics.

### Regime 3: Inter-Pass / Unobserved Gap Filling ($\Delta t > 5.5\text{ h}$ & Night/Day Gaps)

When cloud cover, heavy smoke, or orbital gaps prevent VIIRS detections for `> 5.5 h`:
- Cross-sensor consistent solo MODIS detections (`confidence >= 30%`, ideally `scan <= 3.0 km`) fill the diurnal gap in the SSOT map as **Coarse MODIS Footprint Uncertainty Nodes** (`Tier 3`), displayed with muted coarse-footprint styling (distinct from crisp `375 m` VIIRS fronts) until VIIRS re-acquires the fire.

---

## 5. Harmonized SSOT Default Map View & End-to-End Workflow

To turn the strategy above into the **Single Source of Truth Default Map View** (while keeping `VIIRS` and `MODIS` tabs available as raw-sensor diagnostics):

```text
NASA FIRMS 14-Day Feed (MODIS Terra/Aqua + VIIRS S-NPP / NOAA-20 / NOAA-21)
  │  (chunked retrieval + itemAcquiredMs UTC anchor; country boundary mask)
  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ PIPE A: HARMONIZED SINGLE SOURCE OF TRUTH (SSOT) ENGINE — DEFAULT VIEW    │
│                                                                           │
│  1. Lifecycle & Metadata Normalizer                                       │
│     ├─ Extract localSolarHour, classifyOverpassFamily, scan, track, FRP   │
│     └─ Detect Terra (<09:25/>11:75) & Aqua (<12:25/>15:00) orbital drift  │
│                                                                           │
│  2. Three-Regime Optical & Temporal Reconciliation (Layer B)              │
│     ├─ Regime 1 (Δt <= 90m / drift <= 3h): Point-in-GIFOV suppression,    │
│     │    Tier 1 boost on dual lock, VIIRS-free MODIS false-alarm gating   │
│     ├─ Regime 2 (Δt 1.5–5.5h): Kinematic bridge links Terra t0 -> VIIRS   │
│     └─ Regime 3 (Δt > 5.5h / gap): MODIS >= 30% Coarse Uncertainty Nodes  │
│                                                                           │
│  3. Regional Statistical Calibration (Layer A)                            │
│     ├─ MODIS >= 30% + VIIRS n/h -> 1 km / 0.25° hotspot-cell-day bins     │
│     └─ VIIRS -> MODIS-eq transfer + 90% PI + 14d median/IQR context       │
│                                                                           │
│  4. Unified SSOT Tracker & Point Packaging                                │
│     ├─ Canonical detections -> recent <=12h (points) & 14d (points14d)    │
│     └─ Unified fire_events annotated with Tier 1–4 + 95% Wilson CIs       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │
                                    ▼   Matched by spatial/temporal overlap
                                        (attachViirsModelsToCombined)
┌───────────────────────────────────────────────────────────────────────────┐
│ PIPE B: VIIRS 375M PYTHON ML & HINDCAST ENGINE — PRESERVED UNCHANGED      │
│                                                                           │
│  1. Isolated VIIRS-only /track_fires (mask="deployment") across 14 days   │
│     └─ Clean 0.14 km² pixel area & pure 375 m cluster geometry            │
│  2. Model 1 (Persistence), Model 2 (Expansion), Model 3 (Add Area),       │
│     & 3-Pillar Hazard Rating (0–100) via /predict_all & /calculate_hazard │
│  3. Past-Fire t0 Hindcast Engine (buildHindcastSnapshot):                 │
│     └─ Reconstructs t0 earlyFireEvent -> Actual vs Predicted Spread rings │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   SINGLE SOURCE OF TRUTH DEFAULT MAP (MODIS+VIIRS SSOT + VIIRS ML Models)
```

### Operational Map Representation on the SSOT Default View

Every marker and fire perimeter rendered on the default SSOT tab carries explicit sensor provenance without visual duplication:
- **Tier 1 (`Dual-Confirmed`, `VIIRS + MODIS`)**: Anchored to `375 m` VIIRS centroid; white-gold high-priority pulse; tooltip lists both VIIRS `375 m` FRP and corroborated MODIS platform/$\Delta t$.
- **Tier 2 (`VIIRS Active Front`, `VIIRS && !MODIS`)**: Valid sub-resolution `375 m` fire; vivid orange pulse; full ML spread & hazard enabled.
- **Tier 3 (`MODIS Diurnal / Gap-Fill`, `!VIIRS && MODIS` consistent)**: Coarse uncorroborated `1 km` detection bridging Terra morning or VIIRS swath gaps; muted ochre/amber footprint ring (no synthetic `375 m` splitting; no extrapolated ML spread).
- **Tier 4 (`Low-Confidence Anomaly`, MODIS `< 30%` / VIIRS `l`)**: Excluded from Layer A regressions and hidden under `MODERATE+` / stricter Harmonization Filter levels, inspectable on demand under `ALL`.

---

## 6. Preserving the Existing Architecture for ML Predictions, Hazard & Hindcasts

Our Python ML pipeline (`POST /track_fires`, `/predict_all`, `/predict_event`, `/calculate_hazard` documented in [`models_explained.md`](models_explained.md)) **must remain cleanly isolated from raw MODIS inputs** even while the default map displays the **Harmonized SSOT (MODIS + VIIRS)** view:

1. **Why ML Inputs Must Stay Pure VIIRS (`375 m`)**:
   - All 464,791 training snapshots in Model 1 (`Persistence`), Model 2 (`Expansion`), Model 3 (`Added Area`), and the fitted **3-pillar Hazard score (`Fire behaviour 0.52`, `Terrain & fuel 0.33`, `Weather 0.15`)** are calibrated strictly to **VIIRS NOAA-20 / Suomi-NPP** cluster physics where `area_km2 = distinct_375m_cells × 0.140625 km²`.
   - Injecting `1 km` or `4.8 × 2.0 km` MODIS detections directly into `/track_fires` for ML scoring alters cluster linkage radii (`0.75 km` / `1.0 km`), corrupts FRP sums, distorts pass counts, and biases growth probability features.
2. **How the Dual-Pipe Architecture Preserves Both Truths**:
   - **Pipe A (SSOT Harmonized Map)** ensures the user's **Default View (`MODIS + VIIRS Harmonized`)** omits nothing that Terra morning or MODIS gap-fill saw, never double-counts coincident detections, reconciles `375 m` vs `1000 m` lenses accurately, and tracks multi-day harmonized fire lifecycles across 14 days (`<= 12h` active vs `> 12h` past).
   - **Pipe B (VIIRS 375 m ML & Hindcast Engine)** runs in parallel on raw VIIRS detections (`viirsHotspots14d`), computes Model 1–3 forecasts, `0–100` hazard scores, and `t0` hindcasts (`buildHindcastSnapshot`), and joins them onto matching SSOT fires via `attachViirsModelsToCombined` in [`lib/fire-models.js`](lib/fire-models.js).
   - **Strict Uncertainty Boundaries**:
     - If an SSOT fire has VIIRS evidence (`Direct VIIRS` or `Dual-Confirmed Tier 1`), it carries authoritative ML predictions (`12–24h` Spread + 90% Bound), Hazard ratings, and `t0` Actual vs. Predicted hindcasts.
     - If an SSOT fire is **MODIS Gap-Fill Only (`Tier 3`)**, ML spread polygons and hazard scores intentionally remain `null` (with clear UI provenance labeling) until the next VIIRS overpass acquires the event.
3. **Diagnostic Tabs & Existing Interactive Features Preserved**:
   - `combined` serves as the **Harmonized SSOT Default View**; `viirs` (`VIIRS · ML`) and `modis` (`MODIS`) remain inspectable sensor diagnostic tabs.
   - All existing controls — **5-step Harmonization Filter** (`pointMatchesTierFilter`), **24-hour orbital pass scrubber**, **dataset-anchored UTC calendar & clickable 14-day Cividis strip**, **`RECENT (≤12H)` / `PAST FIRES (14D)` scope toggle**, **36-sector emerald Actual vs. Predicted Spread map overlay (`selected-fire-actual-fill` / `selected-fire-actual-line`)**, and **`# Methods Note` CSV exports** — continue operating without breaking changes.

---

## 7. Implementation Roadmap (Current Baseline → Full Optical/Temporal SSOT Upgrade)

| Component | Currently Implemented in Codebase | Next Upgrade for Full SSOT Spec |
| :--- | :--- | :--- |
| **Time-Delay Classification** | `±4.0 h` baseline / `±5.5 h` adaptive drift window (`lib/harmonization.js`) | Split into 3 explicit regimes: $\Delta t \le 90\text{ min}$ (coincident), $1.5\text{–}5.5\text{ h}$ (kinematic Terra→VIIRS precursor bridge), $> 5.5\text{ h}$ (coarse gap-fill) |
| **Optical / Lens Geometry** | `1.0 km` Haversine centroid distance matching + VIIRS coordinate lock (`harmonizeHotspots`) | Use FIRMS `scan` × `track` elliptical `GIFOV` containment so swath-edge `4.8 × 2.0 km` MODIS bow-tie pixels suppress enclosed `375 m` duplicates |
| **MODIS False-Alarm Gating** | Retains all `>= 30%` unmatched MODIS (`Tier 3`); tags `< 30%` as `Tier 4` (`lib/hotspots.js`) | Cross-check unmatched MODIS timestamps/coords against active VIIRS swath passes; demote `MODIS-only` `< 50%` or `scan > 2.5 km` when VIIRS passed concurrently with zero detections |
| **Map Provenance & UI** | `MODIS + VIIRS`, `VIIRS · ML`, `MODIS` tabs + Layer A 14d baseline + Wilson CIs + Hindcasts | Label `combined` default view explicitly as **Harmonized SSOT**, render Tier 3 solo MODIS as dashed `scan × track` footprint boxes rather than crisp dots, and expose $\text{FRP}_M / \sum\text{FRP}_V$ ratio in inspector |
| **ML / Hindcast Preservation** | `viirs` isolated ML pipe joined via `attachViirsModelsToCombined` + `t0` hindcasts | **Preserved verbatim** — Pipe B continues reading pure VIIRS `375 m` streams so Model 1–3, Hazard scores, and hindcasts remain physically calibrated |

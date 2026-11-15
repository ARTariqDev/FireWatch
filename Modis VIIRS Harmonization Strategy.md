# MODIS & VIIRS Hotspot Harmonization System

This document describes how the platform harmonizes MODIS and VIIRS active-fire detections into **one consistent hotspot time series (2000 to present)** and how that series powers a **burning activity calendar**, anomaly analysis, and a live fire-event view.

The system has two layers:

| Layer | Purpose | Operates on | Time span |
| :--- | :--- | :--- | :--- |
| **A. Statistical harmonization (core)** | Make MODIS-era and VIIRS-era counts comparable so the sensor of origin no longer matters | Aggregated counts per grid cell and time unit | 2000 to present |
| **B. Event fusion (complement)** | Show a current fire with high-resolution geometry and compare it with the historical baseline | Individual detections | Near-real-time, last 24 h to multi-day |

Layer A is what makes historical comparisons valid. Layer B is a visualization and tracking aid built on top of it.

---

## 1. The Core Challenge

NASA FIRMS provides two active-fire records that cannot be compared directly:

| Sensor / platform | FIRMS record starts | Nominal resolution | Local overpass (original) |
| :--- | :--- | :--- | :--- |
| MODIS Terra | Nov 2000 | 1 km | ~10:30 / 22:30 |
| MODIS Aqua | Jul 2002 | 1 km | ~13:30 / 01:30 |
| VIIRS S-NPP | 2012 | 375 m (I-band) | ~13:30 / 01:30 |
| VIIRS NOAA-20 | 2018 | 375 m | ~13:30 / 01:30 |
| VIIRS NOAA-21 | 2023 | 375 m | ~13:30 / 01:30 |

(Verify exact archive start dates against FIRMS when ingesting.)

Four things make raw counts non-comparable:

1. **Sensitivity.** The 375 m I-band detects smaller and cooler fires than MODIS, so raw VIIRS counts are much higher for the same burning.
2. **Resolution.** One MODIS detection can correspond to many VIIRS detections, and the ratio is not constant.
3. **Sampling.** Overpass times, number of satellites, and swath geometry differ, and Terra and Aqua have drifted from their original overpass times in recent years, shifting diurnal sampling.
4. **Coverage gaps.** Before 2012 there is no VIIRS, so point-level matching cannot help for the first 12 years of the record.

### Why we do not split MODIS pixels
Subdividing a 1 km MODIS pixel into a 3 x 3 grid of sub-pixels is rejected. A fire of a few hundred square metres can trigger a 1 km detection, so splitting creates up to eight artificial "ghost fires" and inflates counts and burned area by up to 900%. MODIS is treated as an uncertainty footprint, never as synthetic geometry.

### Why point matching alone is not harmonization
Matching VIIRS and MODIS detections within 1 km and 4 h (Layer B) removes duplicates only where both sensors observed the fire. Solo MODIS and solo VIIRS detections remain separate, and nothing converts a 2005 MODIS count into the same unit as a 2024 VIIRS count. **Harmonization is a statistical problem, so Layer A solves it statistically.**

---

## 2. Layer A: Statistical Harmonization Pipeline

```
          FIRMS archive (MODIS C6.1, VIIRS S-NPP / NOAA-20 / NOAA-21)
                                 │
                                 ▼
              1. Filter for cross-sensor consistency
        (quality flags, daytime/common overpasses, fire type)
                                 │
                                 ▼
              2. Aggregate to common grid and time unit
       (0.25° cell, or 1 km cell-day; hotspot-cell-days per month)
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
     MODIS-only era (2000-2011)        Overlap era (2012 to ~2022-24)
                 │                               │
                 │                  3. Fit transfer function
                 │              VIIRS counts  ->  MODIS-equivalent
                 │            (by region/biome, month/season)
                 │                               │
                 │                  4. Validate (hold-out years/regions)
                 └───────────────┬───────────────┘
                                 ▼
              5. Harmonized series in one reference unit
                  + uncertainty (prediction intervals)
                                 │
                                 ▼
          6. Calendar, climatology (median), anomalies, CSV export
```

### 2.1 Step 1: Filter for cross-sensor consistency
- Use comparable confidence criteria. MODIS confidence (0-100%) and VIIRS confidence (low / nominal / high) are not equivalent, so the default is MODIS confidence >= 30% and VIIRS nominal + high, with sensitivity analysis on the threshold.
- Keep **daytime** detections from the ~13:30 overpass family for the primary series (Aqua, S-NPP, NOAA-20, NOAA-21). Terra and nighttime detections are available as optional secondary series.
- Exclude non-vegetation-fire types where flagged (volcano, offshore, static sources such as gas flares and industrial sites), and optionally mask persistent static hotspots.
- Account for overpass drift: record the actual acquisition local time of each detection and stratify or flag periods where Terra/Aqua drifted far from nominal times, instead of assuming fixed 10:30 / 13:30 passes.

### 2.2 Step 2: Aggregate to a common grid and unit
The base counting unit is the **hotspot-cell-day**: a distinct grid cell with at least one detection on a given day.

- Grid: **0.25 degree cells** for regional statistics (fixed across all sensors), with a **1 km MODIS-grid** option for fine AOIs.
- VIIRS detections are binned to the same grid, so many 375 m detections inside one cell-day collapse to one count. This removes most of the resolution gap and the duplicate detections caused by MODIS bow-tie overlap at swath edges.
- Temporal unit: day, rolled up to **month** for the calendar.
- Also retain **FRP sums** per cell-month as a second, intensity-based metric. FRP is generally less sensor-dependent than counts and is a useful cross-check.

### 2.3 Step 3: Fit the transfer function on the overlap period
Overlap period: **2012 to the end of the stable MODIS record** (S-NPP onward, with NOAA-20/21 added for VIIRS continuity).

- Reference unit (configurable): **"MODIS-equivalent hotspots"** by default, since it covers the longest record. A "VIIRS-equivalent" unit is offered for users who prefer the modern scale.
- Model: a count regression of MODIS cell-month counts on VIIRS cell-month counts, for example a negative binomial GLM on `log(1 + count)`, with **region/biome and month-of-year terms**, since the relationship varies with fire size distribution, vegetation, and season.
- Alternative or cross-check: **quantile mapping** of VIIRS monthly distributions onto MODIS distributions within each region and month.
- Multiple VIIRS satellites are first pooled or cross-calibrated against each other (S-NPP vs NOAA-20 vs NOAA-21) so that adding a satellite does not create a step change.
- Output: a calibrated series and a **prediction interval** for every harmonized value (for example bootstrap over years).

### 2.4 Step 4: Validation (required, shown in the app)
- **Leave-one-year-out cross-validation:** fit without year Y, predict MODIS-equivalent counts for Y from VIIRS, and compare with observed MODIS.
- **Leave-one-region-out:** fit excluding a region or biome and test on it, to show how well the transfer generalizes.
- Report bias, MAE/RMSE, rank correlation, and interval coverage per region and season.
- Flag regions where the transfer function is weak (very low counts, cloud-dominated, mostly small agricultural fires) so users see lower-confidence harmonization instead of false precision.
- Cross-check against an independent quantity where available (for example burned-area products or FRP totals).

### 2.5 Step 5: Assemble the harmonized series
- 2000/2002-2011: observed MODIS (filtered, aggregated).
- Overlap period: observed MODIS and calibrated VIIRS agree by construction, and the two are shown side by side for transparency.
- After MODIS retirement: calibrated VIIRS (S-NPP, NOAA-20, NOAA-21) expressed in the reference unit.
- Every value carries `source` (observed / calibrated), `sensorMix`, and an uncertainty interval, so the sensor of origin does not matter for analysis but remains traceable.

### 2.6 What "Absence of detection" means
A month with zero detections is not proof of no burning. Cloud, smoke, high view angles, and orbital gaps hide fires. The pipeline stores **valid-observation coverage** (number of clear-sky overpasses) per cell-month so counts can be normalized or flagged when sampling is poor.

---

## 3. Burning Activity Calendar and Analytics

All products are computed from the harmonized series.

### 3.1 Calendar (month x year heatmap)
- Rows: years (2000/2002 to present). Columns: months.
- Cell value: harmonized hotspot count for the selected AOI.
- Color ramp: perceptually uniform and colorblind-safe (**viridis** or **cividis**), with a numeric legend and a pattern or outline for cells whose uncertainty is high.
- Toggle between counts, FRP sum, and anomaly view.

### 3.2 Historical comparison and anomalies
- **Climatology:** per-month **median** (and IQR) across a baseline period, by default all complete prior years, excluding the year being evaluated.
- **Anomaly:** `count / median` (ratio) and `count - median` (absolute), plus **percentile rank** against the same month in other years.
- Anomaly ramp: diverging, colorblind-safe (for example blue-white-orange), centered on the median.
- "Current month vs historical median" headline card for emergency managers, with the uncertainty interval from harmonization.
- Ranking views: highest-activity months and years in the AOI.

### 3.3 Area of interest and queries
- Draw a polygon or rectangle on the map, enter lat/lon bounds, or search by country or admin region.
- Date-range selector (minimum one month, up to the full record).
- Aggregations: daily, monthly, annual; seasonal profiles; multi-year trend with uncertainty.

### 3.4 Exports
- **CSV of hotspots** detected in the search (original detections with sensor, satellite, lat/lon, acquisition time, FRP, confidence, and the filter flags applied).
- **CSV of the harmonized monthly series** (counts, interval bounds, source, anomaly, percentile).
- PNG/SVG of the calendar and charts, plus a methods note embedded in each export (reference unit, thresholds, baseline period).

---

## 4. Layer B: Event Fusion and Tiering (complement)

Layer B is the near-real-time fire-event viewer. It does **not** harmonize history; it shows a live fire with VIIRS-anchored geometry and places it against the Layer A baseline ("this fire's region this month vs the historical median").

```
                 NASA FIRMS Telemetry Stream
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
      MODIS (1 km)                        VIIRS (375 m)
            └─────────────────┬─────────────────┘
                              ▼
                 Geodesic Distance Matching
              (Haversine threshold: 1.0 km)
                              │
                              ▼
                  Temporal Coincidence Gate
              (Overpass window: +/-4 hours)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
    [Spatial Overlap]                   [No Coincidence]
VIIRS anchors coordinates           Retained as solo detection
MODIS preserved in `matches`        Tier 2 (VIIRS) or Tier 3 (MODIS)
Assigned Tier 1 (Dual-Confirmed)
```

### 4.1 Spatial anchoring
- When a VIIRS detection falls within 1.0 km of a MODIS detection and inside the time window, they are treated as one fire front, pinned to the 375 m VIIRS coordinates.
- The MODIS observation is never discarded; its coordinates, FRP, timestamp, platform, and confidence are kept in `point.matches` and the event's observation history.
- The +/-4 h window covers the Terra-to-Aqua/VIIRS orbital offset and NRT processing delays. Because Terra and Aqua have drifted, the window should be **derived from actual acquisition times**, not fixed nominal passes, and widened when the drift requires it.

### 4.2 Confidence tiers
| Tier | Classification | Map core | Pulse | Basis |
| :---: | :--- | :--- | :---: | :--- |
| 1 | Dual-Confirmed | White-gold (`#fff0b3` to `#ffffff`) | Yes | Coincident MODIS + VIIRS detection |
| 2 | VIIRS Solo | Vivid orange (`#ff6a32`) | Yes | 375 m detection only |
| 3 | MODIS Solo | Ochre (`#d97706`) | No | 1 km detection, unconfirmed at high resolution |
| 4 | Put Out / Inactive | Pale salmon (`#dfb7a2`) | No | Present in earlier passes, absent in latest clear-sky observations |

**Confidence percentages are empirical, not assigned.** Earlier drafts used fixed ranges (95-100%, 75-90%, 30-55%, 20-25%). Those are replaced by values derived from data: for each tier, the **observed rate of confirmation** in the next independent overpass (or agreement with a reference such as burned-area or ground reports), reported with a confidence interval and re-estimated by region. Until calibrated, tiers are labeled as an **ordinal ranking** (1 > 2 > 3 > 4), not as probabilities.

### 4.3 Event reconstruction and ML slot
- Deterministic event IDs (`fire_${latTag}_${lonTag}_${firstAcquired}`) keep identities stable across reloads and timeline scrubs.
- Each event keeps its chronological `observations` array (sensor, satellite, lat/lon, FRP, confidence, timestamp) and a convex footprint polygon.
- `prediction: null` remains the standardized slot for future models (persistence probabilities at 6/12/24 h, spread vector and projected perimeter, additional burn area and smoke dispersion), so no schema change is needed when they ship.
- New field: `context` with the AOI's harmonized monthly count, climatological median, and percentile, linking Layer B to Layer A.

```json
{
  "eventId": "fire_31.522N_074.359E_1763118000000",
  "detectionTier": 1,
  "observations": [ "..." ],
  "footprint": { "type": "Polygon", "coordinates": [ "..." ] },
  "context": { "monthCount": 412, "median": 260, "percentile": 88, "unit": "MODIS-equivalent" },
  "prediction": null
}
```

### 4.4 Bow-tie effect
MODIS swath-edge pixels grow up to about 10x in area (no onboard correction) and consecutive scans overlap, producing duplicate detections. VIIRS limits growth to about 2x through onboard aggregation and deletion of overlapping samples. Layer B anchors to VIIRS geometry where available and clusters duplicates geodesically. Layer A avoids the problem for counting by using hotspot-cell-days, so duplicates inside a cell-day count once.

---

## 5. Frontend Workflow

1. **Select region:** draw an AOI, enter lat/lon, or pick a country.
2. **Select period:** date range (monthly or annual granularity for the calendar).
3. **View calendar:** month x year heatmap with a choice of count, FRP, or anomaly.
4. **Compare:** current month vs historical median, percentile, ranking of top months and years, with uncertainty shown.
5. **Inspect live fires (Layer B):** confidence-tier filter (`ALL`, `VIIRS + DUAL` default, `DUAL ONLY`), 24-hour historical scrub, and minute-precision UTC range queries.
6. **Export:** hotspot CSV, harmonized series CSV, and chart images, each with a methods note.

---

## 6. Assumptions, Limitations, and Validation Summary

- Harmonized values are **estimates in a reference unit**, not observed counts. Uncertainty is shown wherever values are calibrated.
- The transfer function is only as good as the 2012-onward overlap; regions with very sparse fires or heavy cloud cover will have wider intervals.
- Terra/Aqua orbital drift and the planned end of the MODIS missions are handled by recording acquisition times, stratifying by local overpass time, and relying on calibrated VIIRS for continuity.
- Counts are sensitive to filter choices (confidence thresholds, fire types, static-source masking); defaults are documented and adjustable, and sensitivity results are reported.
- Hotspots include agricultural burning, land clearing, and some industrial sources, so counts reflect **burning activity**, not only wildfires.
- No claim of detection absence implies fire absence (see section 2.6).

### Implementation map
| Component | Responsibility |
| :--- | :--- |
| `lib/aggregate.js` (new) | Filtering, grid binning, hotspot-cell-day and monthly aggregation, coverage counts |
| `lib/calibration.js` (new) | Transfer-function fit, quantile mapping, prediction intervals, cross-validation |
| `lib/climatology.js` (new) | Medians, IQR, anomalies, percentile ranks |
| `lib/harmonization.js` | Layer B point matching and tiering (existing) |
| `lib/tracker.js` | Event reconstruction (existing) |
| `lib/hotspots.js`, `app/components/globe/layers.js` | Data contract and rendering (existing) |
| `app/components/calendar/` (new) | Heatmap calendar, anomaly view, AOI and date controls, exports |

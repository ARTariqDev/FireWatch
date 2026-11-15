# How the Fire Watch models work

A plain-language guide to the tracker, the hazard rating and the three prediction models.
All numbers come from the project's own evaluation reports (`data/v2/models/report.txt`,
`report_persist_no_cloud.txt`) and configuration files.

---

## 1. The tracker: turning hotspots into fires

A satellite does not see "fires". It sees **hotspots**: individual hot pixels (375 m wide for VIIRS, 1 km for
MODIS). The tracker groups hotspots that belong together into **fire events**.

**Steps**

1. **Clean the input.** Remove low-confidence VIIRS hotspots, duplicates, and known permanent heat sources
   (factories, gas flares, brick kilns) using a static-source mask.
2. **Group by satellite pass.** Time is cut into 12-hour windows (one daytime and one night-time pass).
3. **Cluster within a pass.** Hotspots within **0.75 km** of each other in the same pass form one cluster.
4. **Link clusters to existing fires.** A cluster joins an active fire if it is close enough:
   - wildland (forest, shrub, grass): within **1 km**, and the fire was seen in the last **2 days**;
   - other land (crops, urban, bare): within **0.75 km**, and seen in the last **1 day**.

   Otherwise it starts a new fire.
5. **Merge.** If a cluster touches two or more fires, they are merged into the **oldest** one.
6. **Summarise each fire.** For example:
   - number of hotspots and passes;
   - duration;
   - centre point;
   - total fire radiative power (FRP);
   - **detected area**: the number of distinct 375 m cells × 0.14 km²;
   - land-cover mix and dominant fire type (wildland / crop / other);
   - province;
   - which satellites saw it.

**Things to know**

- The tracker only uses what came *before* each pass (it never looks into the future), so it behaves the same
  live as it did in training.
- The tracker groups detections from both sensors. Before detections are sent to the tracker, MODIS and
  VIIRS FRP values are normalized to a common scale. MODIS's larger pixels can still change grouping, detected
  area and duration when the sensors are combined.
- Fire IDs (`fire_final`) are only valid within one tracking run.

### 1.1 Using the tracker from the frontend

The backend never downloads satellite data. The frontend fetches FIRMS hotspots, sends them to
`POST /track_fires`, and gets the fires back already clustered.

**Make two separate calls.**

| Purpose | Send | Use the result for |
|---|---|---|
| **A. Map and predictions** | VIIRS + MODIS hotspots, with FRP normalized to a common scale before tracking | Drawing fires on the map and `/predict_event`, `/predict_all` |
| **B. Hazard analysis** | VIIRS-only hotspots (NOAA-20, Suomi-NPP) | `/calculate_hazard` |

The prediction models were trained using both MODIS and VIIRS data, with FRP normalized to a common scale
before the hotspots were sent to the clustering algorithm. Use the same preprocessing and mixed-sensor input
approach for predictions. The hazard methodology retains its separate VIIRS-only input workflow. Fire IDs
differ between the two tracking runs; the backend does not match fires across runs.

**Request**

```json
{"hotspots": [ { "latitude": 28.04177, "longitude": 68.03681, "acq_date": "2025-05-15", "acq_time": 754,
                 "frp": 6.21, "confidence": "n", "daynight": "D", "satellite": "N20", "instrument": "VIIRS" },
               "..." ],
 "mask": "deployment"}
```

- **Required for each hotspot:**
  - `latitude`, `longitude`;
  - `acq_date` (`YYYY-MM-DD`);
  - `acq_time` (HHMM, UTC, e.g. `754` = 07:54);
  - `frp`, `confidence`, `daynight`.
- **Also send `satellite` and `instrument`,** exactly as FIRMS gives them. They tell the tracker which satellite
  each hotspot came from:

  | `instrument` | `satellite` | Shown as |
  |---|---|---|
  | `VIIRS` | `N20` | `VIIRS_NOAA20` |
  | `VIIRS` | `N` or `1` | `VIIRS_SNPP` |
  | `VIIRS` | `N21` | `VIIRS_NOAA21` |
  | `MODIS` | `Terra` / `T` | `MODIS_TERRA` |
  | `MODIS` | `Aqua` / `A` | `MODIS_AQUA` |

- **Other FIRMS columns** (e.g. `bright_ti4`, `scan`) are optional. They are kept and returned with each detection.
- **Normalize FRP before tracking.** MODIS and VIIRS FRP values are brought to a common scale before the
  hotspots are sent to the clustering algorithm. VIIRS confidence is `l`/`n`/`h`, and `l` (low) is removed by
  the tracker. MODIS confidence is a number and is kept as it is.
- **`mask`:** use `"deployment"` for live data. It removes known permanent heat sources (factories, flares,
  kilns). `null` uses the evaluation mask from training.

**Response: what to draw**

- **`geojson`:** one Point per fire, at the centre of its hotspots, ready to add as a Mapbox GeoJSON source.
  Each feature's `id` is the fire ID. Its properties hold the summary for popups: hotspots, passes, area, FRP,
  fire type, province, satellites, first and last detection.
- **`fire_events[i].detections`:** the individual hotspots of each fire, each with `fire_final`. Use these to draw
  the hotspots as dots coloured by fire.
- **`fire_events[i].fire`:** the full fire summary. From call B, send it as-is to hazard and prediction.

See section 4.1 for every field.


**Practical tips**

- **Send only what you show.** Use the last 1–3 days, inside Pakistan's bounding box. Responses are
  gzip-compressed automatically, but very busy multi-day requests are large.
- **Speed:** tracking 15,637 hotspots (three days of VIIRS) took about 10 s on the deployed API. Show a loading
  state while it runs.
- **Send all detections of the run as context.** In call B, nearby-fire features use them.
- **Keep calls consistent.** Fires near the edge of the time window can look shorter or smaller than they really
  are, because earlier hotspots were not sent. Use the same window for both calls.

---

## 2. Hazard rating: how dangerous is this fire itself?

A simple weighted score from **0 to 100**, independent of the prediction models. It describes the fire and its
surroundings. It does **not** consider people, buildings or roads.

**Three pillars**

| Pillar | Weight | Factors |
|---|---|---|
| Fire behaviour | 0.52 | FRP of the latest pass, detected area, duration |
| Weather (previous day) | 0.15 | Max temperature, wind speed, humidity (lower = worse), soil moisture (drier = worse) |
| Terrain and fuel | 0.33 | Slope, fuel type (from land cover), amount of vegetation |

**How it is calculated**

1. Each factor is scaled to 0–1 between fixed limits. For example:
   - FRP: 1 to 100 MW, on a log scale;
   - area: 0.14 to 4 km²;
   - duration: 0 to 72 hours;
   - temperature: 10 to 40 °C;
   - wind: 0 to 40 km/h.
2. Factors are averaged inside each pillar, then the pillars are combined with the weights above, giving a
   score from 0 to 100.
3. The score is turned into a rating:

   | Score | Rating |
   |---|---|
   | below 19 | Low |
   | 19–25 | Moderate |
   | 26–37 | High |
   | 38–54 | Very High |
   | 55 and above | Extreme |

**Where the weights and cutoffs came from**

- **Weights:** fitted on 2019–2024 Pakistan fires to best separate fires that later grew (at least doubled
  *and* grew by ≥ 0.5 km² within 72 h). Each pillar has a minimum weight of 0.15.
- **Cutoffs:** the 50th, 80th, 95th and 99th percentiles of 2019–2024 scores. So "High" means "in roughly the
  top 20% of Pakistan fires of that period".

**Things to know**

- It is a **relative index, not a probability**, and not a measure of risk to people or property.
- Missing inputs are listed in `hazard_missing_factors` (data quality `partial`). They are never filled in with
  guesses.
- Weather comes from NASA POWER, which publishes a few days late. Older weather is flagged `stale_weather`.

---

## 3. The three prediction models

### What one training example is

One example = **one tracked fire at one 12-hour satellite pass** (a "snapshot"). Its features use only
information available at that moment. The answer ("label") is what happened in the **next 12–24 hours**.

- **Data:** Pakistan fires 2019–2025 from MODIS and VIIRS. FRP values were normalized to a common scale
  before detections were sent to the clustering algorithm. The updated snapshot count is not stated here.
- **Evaluation note:** the performance figures below come from the evaluation reports named at the top of this
  document. They should not be treated as scores for the updated mixed-sensor models unless those reports were
  regenerated using the updated training and test pipeline.
- **Features (inputs):**
  - fire size, FRP and number of hotspots;
  - growth over the last 24 h;
  - how long there has been fire nearby;
  - hotspots within 5 km in the last 24 h and 7 days;
  - day or night;
  - previous-day weather: temperature, humidity, vapour-pressure deficit, wind, rain, days since rain, soil
    moisture;
  - terrain: elevation, slope, aspect, relative height;
  - land cover around the fire;
  - time of year.
- **Uncertain cases removed ("censored"):** if the fire might have been hidden, we can't tell whether it truly
  stopped, so those snapshots were left out of training. That covers:
  - heavy cloud (≥ 80%);
  - a satellite data gap;
  - the fire reappearing in the same place a little later.

### How training and testing were done

- **Development years 2019–2024:** used to build and tune the models.
  - Snapshots were split into **5 groups by fire** (nearby fires in the same week stay together), so the model
    was always tested on fires it had never seen.
  - Thresholds and calibration were chosen here only.
- **Test year 2025:** kept aside and used **once** for the final scores below.
- **Geographic checks:** each province was left out in turn, and 1° map blocks were left out, to see how well
  the models handle unfamiliar areas.
- **Deployed models:** after testing, the deployed models were refitted on all labelled years (2019–2025).

**How to read the scores.** *PR-AUC* measures how well a model ranks the real cases above the others. Compare it
to the *base rate* (how common the event is): a model that guesses randomly scores about the base rate.

### Model 1: Persistence (will the fire still be burning in 12–24 h?)

- **Type:** gradient boosting (scikit-learn `HistGradientBoostingClassifier`, 41 features), followed by
  calibration so that "0.3" really means about a 30% chance.
- **Cloud cover:** removed as a feature, because NASA does not provide it for live dates.
- **2025 test:**
  - PR-AUC **0.488**, versus a base rate of **0.112**: about 4× better than guessing.
  - The simpler logistic regression scored 0.426.
  - At its best-balance threshold, about **43%** of "will persist" calls were right, and it caught about **56%**
    of fires that did persist.

### Model 2: Expansion (will the detected area grow by ≥ 1 km² **and** ≥ 25% in 12–24 h?)

- **Type:** logistic regression using 8 inputs:
  - fire area, FRP, nearby hotspots and age of nearby activity;
  - dryness of the air (vapour-pressure deficit) and wind;
  - share of wildland and slope.
- **Why logistic:** gradient boosting was not clearly better (development PR-AUC 0.086 vs 0.109), so the simpler
  model was kept.
- **Training data:** only **543** of 289,788 development snapshots expanded. It is a rare event.
- **2025 test:**
  - PR-AUC **0.108**, versus a base rate of **0.004**: much better than guessing, but still weak in absolute terms.
  - At the alert threshold (**0.0845**, chosen on development data), about **15%** of alerts were right, and it
    caught about **21%** of real expansions.
- **Capped:** the expansion probability is never higher than the persistence probability.

### Model 3: Additional area (if it expands, by how much?)

- **Type:** statistical, not machine learning. It uses the typical extra area of past expanding fires of the
  same type:

  | Fire type | Low (10%) | Typical (median) | High (90%) |
  |---|---|---|---|
  | Crop | 1.13 km² | 1.27 km² | 1.69 km² |
  | Wildland | 1.13 km² | 1.55 km² | 2.81 km² |
  | Other | 1.13 km² | 1.41 km² | 2.44 km² |

- **Why statistical:** a machine-learning model was tested and was not clearly better. On 2025 it was slightly
  worse (log error 0.296 vs 0.279).
- **2025 test:** the 10–90% range contained the true value about **90%** of the time.
- **Shown on the map:** only when expansion is likely. The map shape is an **approximate circle** grown evenly in
  all directions; no tested method could predict the *direction* of spread.

---

## 4. Output formats

What each operation returns. The examples are real outputs for VIIRS NOAA-20 + Suomi-NPP detections of
15–17 May 2025 (fire 41 is a small crop fire in Sindh; fire 1341 is a shrub/grass fire in Punjab).

| API endpoint | Python function | Returns |
|---|---|---|
| `POST /track_fires` | `standalone_tracker.track_fires(hotspots, mask)` | `geojson` + `fire_events` |
| `POST /calculate_hazard` | `fire_hazard.calculate_hazard(fire_event, environment)` | one flat object |
| `POST /predict_event` | `api.Predictor().predict_event(fire_event)` | GeoJSON FeatureCollection |
| `POST /predict_all` | `api.Predictor().predict_all(fires, detections)` | GeoJSON FeatureCollection |

### 4.1 Tracker: `track_fires`

The API returns `{"geojson": {...}, "fire_events": [...]}`. The Python function returns the same two parts as a
tuple `(geojson, fire_events)`.

**`geojson`**: one Point per fire, at the mean location of its hotspots, for the map.

```json
{"type": "FeatureCollection",
 "features": [{"type": "Feature", "id": 41,
               "geometry": {"type": "Point", "coordinates": [68.037242, 28.041694]},
               "properties": {"fire_final": 41, "n_det": 5, "n_passes": 1,
                              "first_detection_utc": "2025-05-15T07:32Z", "last_detection_utc": "2025-05-15T09:12Z",
                              "duration_h": 0, "area_km2": 0.5625, "frp_sum": 31.13, "fire_type": "crop",
                              "province": "Sindh", "satellites": ["VIIRS_NOAA20", "VIIRS_SNPP"], "merges_in": 0}}],
 "metadata": {"n_fires": 5116, "n_detections_in": 15637, "n_detections_tracked": 10145,
              "note": "Points are mean detection locations of tracked fires, not perimeters. fire_final ids are valid within this run only."}}
```

**`fire_events`**: a list of `{"fire": {...}, "detections": [...]}`, one per fire. Pass these to the hazard and
prediction operations.

`fire` fields:

| Field | Meaning |
|---|---|
| `fire_final` | Fire ID (valid within this run only) |
| `lat`, `lon` | Mean location of the fire's hotspots |
| `n_det`, `n_passes` | Number of hotspots / satellite passes |
| `first_pass`, `last_pass` | First and latest 12-hour pass number |
| `first_detection_utc`, `last_detection_utc` | First and latest detection time |
| `duration_h` | Hours between first and latest pass |
| `area_km2` | Detected area (distinct 375 m cells × 0.14 km²) |
| `frp_sum` | Total fire radiative power of all hotspots (MW) |
| `lc_forest`, `lc_shrub_grass`, `lc_crop`, `lc_urban`, `lc_bare_other`, `lc_water` | Land-cover mix under the fire (%) |
| `fire_type` | Dominant land cover: `forest`, `shrub_grass`, `crop`, `urban`, `bare_other`, `water` |
| `province` | Pakistan province, or `outside_pakistan` |
| `satellites` | Which satellites saw it (for display only) |
| `max_gap_passes` | Longest gap between detections (passes) |
| `merges_in` | How many other fires were merged into this one |

`detections` fields: every original FIRMS column you sent (`latitude`, `longitude`, `acq_date`, `acq_time`,
`frp`, `confidence`, `bright_ti4`, ...), plus:

| Field | Meaning |
|---|---|
| `lat`, `lon` | Location |
| `pass_id` | 12-hour pass number |
| `fire_final` | The fire it belongs to |
| `satellite_id` / `sat` | e.g. `VIIRS_NOAA20`, `VIIRS_SNPP`, `MODIS_AQUA` |
| `acq_datetime_utc` | Detection time |
| `province` | Province of the hotspot |
| `fire_id_at_detection` | Fire ID at the time of detection, before later merges |

### 4.2 Hazard: `calculate_hazard`

One flat object per fire:

```json
{"fire_id": 41, "hazard_score": 32, "hazard_rating": "High",
 "hazard_score_kind": "relative_index_not_probability", "hazard_weighting": "outcome_g2_floor15_arith_v2",
 "hazard_pillar_fire_behaviour": 0.3869, "hazard_pillar_weather": 0.7607, "hazard_pillar_terrain_fuel": 0.0069,
 "hf_frp_mw_value": 31.13, "hf_frp_mw_score": 0.7466,
 "hf_area_km2_value": 0.5625, "hf_area_km2_score": 0.4141,
 "hf_duration_h_value": 0, "hf_duration_h_score": 0.0,
 "hf_temperature_c_value": 47.03, "hf_temperature_c_score": 1.0,
 "hf_wind_kmh_value": 8.64, "hf_wind_kmh_score": 0.216,
 "hf_humidity_pct_value": 13.89, "hf_humidity_pct_score": 0.9568,
 "hf_soil_moisture_value": 0.13, "hf_soil_moisture_score": 0.87,
 "hf_slope_deg_value": 0.0, "hf_slope_deg_score": 0.0,
 "hf_fuel_type_value": 0.0146, "hf_fuel_type_score": 0.0146,
 "hf_vegetation_pct_value": 0.6, "hf_vegetation_pct_score": 0.006,
 "hazard_top_factors": "frp_mw, area_km2, temperature_c", "hazard_missing_factors": "",
 "environment_date": "2025-05-14", "weather_age_days": 0.0, "data_quality": "ok"}
```

| Field | Meaning |
|---|---|
| `hazard_score` | 0–100 relative index |
| `hazard_rating` | `Low`, `Moderate`, `High`, `Very High`, `Extreme` |
| `hazard_pillar_*` | Pillar scores (0–1) |
| `hf_<factor>_value` | Raw input value (FRP in MW, temperature in °C, wind in km/h, humidity in %, slope in degrees, ...) |
| `hf_<factor>_score` | That factor scaled to 0–1 (1 = most hazardous) |
| `hazard_top_factors` | The three factors contributing most |
| `hazard_missing_factors` | Factors that had no data (left out, not guessed) |
| `environment_date` | Date of the weather used (the day before the fire's latest pass) |
| `weather_age_days` | How much older than that the weather actually is (0 = as intended) |
| `data_quality` | `ok`, `partial` (some factors missing) or `stale_weather` |

### 4.3 Predictions: `predict_event` and `predict_all`

Both return a **GeoJSON FeatureCollection** that a map can draw directly. Every feature has `event_id` (= the
fire's `fire_final`) and a `role`:

| `role` | Geometry | When | Properties |
|---|---|---|---|
| `hotspot` | Point | Every hotspot of the fire | `frp_mw`, `observed_at` |
| `current_footprint` | Polygon | Always | `current_area_km2` |
| `predicted_footprint` | Polygon | Always | All prediction results (below) |
| `uncertainty_outer` | Polygon | Only if expansion is likely | `quantile` (0.9), `area_km2`: high-end (90%) extent |
| `growth_zone` | Polygon | Only if expansion is likely | Ring between current and predicted footprint |

`predicted_footprint` properties for an expanding fire:

```json
{"event_id": 1341, "role": "predicted_footprint", "geometry_kind": "approximate_potential_spread_footprint",
 "persistence_probability": 0.666667, "expansion_probability": 0.300028, "expansion_threshold": 0.0845,
 "prediction_status": "expansion_likely", "confidence": "NORMAL",
 "current_area_km2": 2.383963, "detected_area_km2": 2.109375,
 "predicted_additional_area_km2": 1.546875, "predicted_total_area_km2": 3.920414,
 "additional_area_p10_km2": 1.125, "additional_area_p90_km2": 2.8125,
 "center_lon": 72.851743, "center_lat": 32.775129, "shift_dx_km": 0.0, "shift_dy_km": 0.0, "direction_deg": null,
 "fire_type": "shrub_grass", "province": "Punjab",
 "data_quality": "ok", "imputed_features": "", "weather_age_days": 0,
 "data_source": "SP", "observed_at": "2025-05-15T21:58:00Z", "horizon": "12-24h", "model_version": "2.0.0"}
```

| Field | Meaning |
|---|---|
| `persistence_probability` | Model 1: chance the fire is still detected in 12–24 h (0–1) |
| `expansion_probability` | Model 2: chance it grows by ≥ 1 km² and ≥ 25% (0–1, never above persistence) |
| `expansion_threshold` | Alert threshold (0.0845) |
| `prediction_status` | `expansion_likely` (probability ≥ threshold), `expansion_unlikely`, or `low_confidence` (inputs had to be filled in, or the fire is outside Pakistan) |
| `confidence` | `NORMAL` or `LOW` |
| `current_area_km2` | Area of the drawn current footprint polygon |
| `detected_area_km2` | Tracker's detected area (375 m cells) |
| `predicted_additional_area_km2` | Model 3 typical extra area (0 when expansion is unlikely) |
| `predicted_total_area_km2` | Current + additional |
| `additional_area_p10_km2`, `additional_area_p90_km2` | Low / high extra area (only when expansion is likely, otherwise `null`) |
| `center_lon`, `center_lat` | Fire centre |
| `shift_dx_km`, `shift_dy_km`, `direction_deg` | Always 0 / `null`: growth is drawn evenly in all directions |
| `data_quality` | `ok`, `imputed` (some inputs filled with typical values) or `stale_weather` |
| `imputed_features` | Which inputs were filled in |
| `weather_age_days` | How many days older the weather is than intended |
| `data_source` | Echo of what the caller sent (e.g. `NRT`, `SP`) |
| `observed_at` | Time of the fire's latest detection |
| `horizon` | Always `12-24h` |

For a fire where expansion is unlikely (fire 41): `expansion_probability` 0.001,
`prediction_status: "expansion_unlikely"`, additional area 0, p10/p90 `null`, and no `uncertainty_outer` or
`growth_zone` features.

**`metadata`** (top level):

```json
{"generated_at": "2026-11-15T00:16:28+00:00", "model_version": "2.0.0", "status": "ok", "reason_code": null,
 "n_events": 1539}
```

- `predict_all` adds `invalid_events` when some fires were skipped:
  `[{"event_id": 287, "missing_fields": [], "null_fields": ["fire.area_km2"]}]`.
- On failure, `status` is `"failed"` and `features` is empty. `reason_code` is one of:
  - `BAD_INPUT`, with `missing_fields` / `null_fields`;
  - `NO_DETECTIONS`;
  - `OUT_OF_REGION`.

### 4.4 Errors from the API

Badly shaped requests get HTTP **422**:

```json
{"error": "BAD_INPUT", "detail": "missing required fire fields: ['lon', 'last_pass', ...]"}
```

This applies to missing tracker columns, missing hazard fields and malformed `context_detections`. Prediction
validation problems are returned with HTTP 200 inside `metadata`, as described above.

---

## 5. Limitations

1. **Pakistan, 2019–2025 only.** Performance elsewhere or in future years is uncertain.
2. **Satellites only look a few times a day.** Activity between passes is not seen.
3. **A tracked "fire" may not be one real fire.** Nearby separate burns can be joined, and one fire can be split.
4. **Clouds, smoke and data gaps** hide fires, so all outputs depend on what the satellite could see.
5. **Predictions are estimates, not certainties.** Expansion alerts are wrong more often than right.
6. **Coarse environmental data:**
   - weather is about 50 km per grid cell, daily, and a few days late;
   - land cover and terrain are static maps at about 370 m.
7. **Expansion is rare:** only about 0.4% of snapshots. This limits how well it can be learned.
8. **Hazard is relative.** It ranks fires against 2019–2024 Pakistan fires. It is not a probability and says
    nothing about exposure of people or property.
9. **NOAA-21** (same VIIRS instrument) was not in the training data.

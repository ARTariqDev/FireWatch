# harmoniztion strategy for mis viirs data


both apis retrun a confidence rating what we want to do is classify each entry based on confidene as in viirs isa moere axcurate righ and modis passes over first right ? and VIIRS second, viirs has more dense readings and hence more accurate

if a fire is detected by both satellites it is MOST confident
if modis dects one it viirs deoesnt the n it has low confidence


hence vome up with a hamroniztion strategy that take shti sinto account

Also we cants plit the pixel for modis can we?



---

## Proposed Harmonization & Multi-Sensor Fusion Strategy

### 1. The Core Question: Can We Split the MODIS Pixel?

**No, we should not split a single MODIS pixel into 9 artificial points.**

- **Physical Reality**: A thermal anomaly detection inside a $1\text{ km} \times 1\text{ km}$ MODIS pixel does not mean the entire $1\text{ km}^2$ footprint is flaming. A flaming front as small as $100\text{ m}^2$ (0.01% of the pixel area) can emit enough Fire Radiative Power (FRP) to trigger a 1 km MODIS detection.
- **The "Ghost Fire" Risk**: Decomposing 1 MODIS detection into 9 discrete 375m points creates 8 artificial "ghost fires" that do not exist, multiplying fire counts $9\times$ and exaggerating burned acreage.
- **The Sound Alternative**: Treat the MODIS detection as an **uncertainty footprint ($1\text{ km}$ circular bounding area)**. When VIIRS passes over, its 375m pixels **naturally resolve and sharpen** that footprint by pinpointing the exact sub-pixel coordinate where the fire front actually sits.

---

### 2. Satellite Overpass Schedule & Reading Time Delays

MODIS and VIIRS orbit in sun-synchronous paths with distinct local solar observation times:

```
00:00 UTC               06:00 UTC               12:00 UTC               18:00 UTC               24:00 UTC
───┼───────────────────────┼───────────────────────┼───────────────────────┼───────────────────────┼───
   │                       │                       │                       │
   ▼                       ▼                       ▼                       ▼
~01:30 Night            ~10:30 Morning          ~13:30 Afternoon        ~22:30 Evening
VIIRS + Aqua (MODIS)    Terra (MODIS)           VIIRS + Aqua (MODIS)    Terra (MODIS)
(Night thermal pass)    (First day scan)        (Coincident Peak Fire)  (Evening thermal pass)
```

1. **Terra (MODIS) passes FIRST (~10:30 AM local)**: Establishes the initial morning baseline as daytime temperatures climb and relative humidity drops.
2. **Aqua (MODIS) & VIIRS (NOAA-20 / SNPP) pass SECOND (~13:30 PM local)**: Pass during peak afternoon fire activity within **15 to 45 minutes** of each other.
3. **Operational Processing Latency (NRT Delay)**: NASA FIRMS Near Real-Time products carry an ingestion latency of **1 to 3 hours** between satellite observation and API availability.

---

### 3. The 4-Tier Unified Confidence Engine

Both APIs report confidence metrics:
- **MODIS**: An integer percentage `0% – 100%` (Low `<30%`, Nominal `30–80%`, High `>80%`).
- **VIIRS**: Categorical rating: `low` (`l`), `nominal` (`n`), `high` (`h`).

By cross-referencing spatial proximity ($r \le 1\text{ km}$) with reading time delays ($\Delta t$), we classify all thermal anomalies into four operational tiers:

```Next.js (Vercel)
      |
      | Request fire data
      ▼
Python Backend (Hugging Face)
      |
      ├── Fetch MODIS observations
      |
      ├── Fetch VIIRS observations
      |
      ├── Fetch VIIRS observations
      |
      ▼
Harmonise observations
      |
      ▼
Run fire tracker
      |
      ▼
Generate fire events
      |
      ▼
Run spread prediction models
      |
      ▼
Return GeoJSON
      |
      ▼
Next.js + Mapbox

The tracker would reconstruct fire events from the observations available at that time.
2. Do you need a database?

No.

You could have a Python function:
def get_fire_events():

    modis = fetch_modis()
    viirs = fetch_viirs()

    observations = harmonize(modis, viirs)

    fire_events = track_fires(observations)

    predictions = predict_spread(fire_events)

    return build_geojson(fire_events, predictions)

Every request runs the pipeline and returns the latest results.

The tracker doesn't need to remember anything between requests because it reconstructs events from the fetched observation history.
3. But there's one important consideration

You must fetch enough historical observations for the tracker to reconstruct existing fires.

Imagine:

    Monday: A fire is detected.
    Tuesday: Additional hotspots are detected.
    Wednesday: Your application fetches only Wednesday's observations.

If you only give the tracker Wednesday's observations, it won't know that Monday's and Tuesday's detections belong to the same fire.

Instead, fetch a rolling historical window, such as the previous 5–7 days, depending on your tracker configuration.

For longer-lasting fires, you may need a longer window or a way to retrieve older observations.

Also, if your tracker uses a five-day active window, the fetched history must be sufficient to support that rule.
4. The main disadvantage: computational cost

Running the entire pipeline every time someone opens the dashboard is inefficient.

For example, if 20 people open your dashboard, you could end up fetching satellite data and running the tracker 20 times.

I'd recommend:

    Fetch satellite data periodically (e.g. every three hours).
    Run harmonisation and tracking after each fetch.
    Cache the resulting GeoJSON.
    Let Next.js retrieve the cached result whenever someone opens the dashboard.

This does not require a database. You can use an in-memory cache or persistent file storage, depending on your hosting setup.
5. My recommendation

Start with this architecture:
Component	Responsibility
Next.js	Display fire events and predictions
Hugging Face / FastAPI	Fetch data, harmonise, track and predict
Fire tracker	Reconstruct fire events
ML models	Predict persistence, expansion and additional area
Cache	Store the latest generated GeoJSON

One distinction: Reconstructing events on every refresh is perfectly reasonable. However, event IDs must be reproducible across refreshes if you want users to follow the same fire over time.

You can generate deterministic IDs based on stable event characteristics, rather than assigning random IDs every time.

That is the approach I'd recommend for your current project: runtime tracking, no database, and periodic caching of the results.

      ▼
Harmonise observations
      |
      ▼
Run fire tracker
      |
      ▼
Generate fire events
      |
      ▼
Run spread prediction models
      |
      ▼
Return GeoJSON
      |
      ▼
Next.js + Mapbox

| Tier | Category | Trigger Condition | Spatial Representation | Role in Spread Prediction |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **DUAL-CONFIRMED** *(Highest, ~95–100%)* | Fire detected by **both** MODIS and VIIRS within a 4-hour window in the same 1 km footprint. | Precise **375m VIIRS coordinates**. Replaces coarse MODIS point. | **Verified Active Fire Front**. Primary anchor for computing fire spread velocity vectors. |
| **Tier 2** | **HIGH-RES SINGLE** *(High, ~80–90%)* | Detected by **VIIRS alone** with nominal or high native confidence. | Precise **375m VIIRS coordinate**. | **New Ignition / Early Front** detected by VIIRS's 375m sensitivity before MODIS could register it. |
| **Tier 3** | **UNVERIFIED COARSE** *(Medium, ~50–70%)* | Detected by **MODIS Terra** (10:30 AM) when VIIRS has not passed overhead yet. | **1 km footprint circle** with dashed/soft border. | **Early Warning**. Held as unverified until the 13:30 VIIRS overpass validates or refutes it. |
| **Tier 4** | **TRANSIENT / PUT OUT** *(Low, < 30%)* | Detected by MODIS at 10:30 AM, but **VIIRS detects nothing** at 13:30 PM under clear skies. | **Faded, lighter shade** (`extinguished = 1`, no pulse). | **Extinguished / Burned Out** (or transient agricultural flash burn / false alarm). |

---

### 4. Fire Spread & Trend Analysis Using Reading Time Delays

Because we preserve exact UTC acquisition timestamps ($t_{\text{modis}}$ and $t_{\text{viirs}}$), the 3-hour delay between Terra and VIIRS becomes an analytical advantage rather than an error:

1. **Fire Spread Velocity Vector ($\vec{v}$)**:
   $$\vec{v} = \frac{\vec{x}_{\text{viirs}} - \vec{x}_{\text{modis}}}{t_{\text{viirs}} - t_{\text{modis}}} \quad (\text{km/h or m/h})$$
   - $\vec{x}_{\text{modis}}$: Centroid at 10:30 AM
   - $\vec{x}_{\text{viirs}}$: Centroid at 13:30 PM
   - $\Delta t \approx 3.0\text{ hours}$
2. **Expansion Bearing ($\theta$)**: Computes forward azimuth in degrees to model direction of spread relative to local wind and topography.
3. **Fire Radiative Power Trend ($\Delta \text{FRP} / \Delta t$)**:
   - $\Delta \text{FRP} > 0$: Intensifying / accelerating fire front.
   - $\Delta \text{FRP} \le 0$: Smoldering or decaying front.

---

### 5. The Bow-Tie Effect: Impact & Mitigation

- **What It Is**: Both sensors sweep a rotating mirror perpendicular to the orbital path. At nadir (directly below), ground resolution is nominal ($1\text{ km}$ for MODIS, $375\text{ m}$ for VIIRS). At swath edges (scan angles up to $\pm 56^\circ$), slant-range distortion causes consecutive scans to flare out like a bow-tie.
- **Why It Severely Affects MODIS**:
  - A nominal $1\text{ km} \times 1\text{ km}$ pixel balloons to **$2\text{ km} \times 4.8\text{ km}$ ($\sim 9.6\text{ km}^2$)** at swath edges ($10\times$ area increase).
  - Consecutive scans overlap by 50%–70%, causing single fires to be detected **2 to 3 times** across consecutive lines, creating artificial duplicate fires offset by kilometers.
- **How VIIRS Solves It**:
  - Employs **onboard pixel aggregation** (3:1 at nadir, 2:1 mid-scan, 1:1 edge), constraining pixel growth to at most $375\text{ m} \times 750\text{ m}$ ($< 2\times$ area increase).
  - Employs **onboard bow-tie deletion**, discarding overlapping detector samples.
- **Our Harmonization Solution**:
  - In coincident passes, anchoring to VIIRS automatically eliminates MODIS bow-tie duplicates and positional smearing.
  - For standalone MODIS detections, spatial clustering collapses multi-scan duplicates into a single footprint.
 
#suggestions to integrate with firespread model and group related fires using a tracker:
**Yes, the direction is broadly aligned with what we're building for the spread-prediction model.** In fact, your harmonisation strategy and the fire tracker can complement each other very well.

However, I would make a few important adjustments before integrating them. Some parts of the proposed dashboard strategy are useful for visualisation but could introduce errors if we directly use them for model training.

The key is to distinguish between **detecting a fire, identifying observations belonging to the same fire, and predicting how that fire will spread.**

## 1. How the two systems should work together

I'd structure the pipeline like this:

```text
Next.js (Vercel)
      |
      | Request fire data
      ▼
Python Backend (Hugging Face)
      |
      ├── Fetch MODIS observations
      |
      ├── Fetch VIIRS observations
      |
      ▼
Harmonise observations
      |
      ▼
Run fire tracker
      |
      ▼
Generate fire events
      |
      ▼
Run spread prediction models
      |
      ▼
Return GeoJSON
      |
      ▼
Next.js + Mapbox
```

This means the tracker receives harmonised observations from both satellites and determines which observations belong to the same fire event.

The spread model then works with those fire events rather than individual satellite detections.

That is exactly what we want.

## 2. What I would change in your harmonisation strategy

### A. Don't automatically consider VIIRS more accurate

VIIRS has substantially finer nominal spatial resolution than MODIS (375 m versus approximately 1 km for the standard MODIS active-fire product).

This makes VIIRS better at resolving the location of smaller or spatially concentrated thermal anomalies.

However, finer resolution does not automatically mean every VIIRS detection is more reliable. Both sensors have their own detection limitations and confidence classifications.

I would therefore:

- Preserve each sensor's original confidence.
- Give VIIRS higher spatial-resolution priority when representing a matched detection.
- Avoid treating VIIRS as universally more reliable than MODIS.

### B. Dual detection should increase confidence, but not automatically guarantee it

Your idea of giving the highest confidence to detections identified by both satellites is reasonable.

However, the observations need to be matched carefully.

For example:

| MODIS | VIIRS | Suggested interpretation |
|---|---|---|
| Detected | Detected | Dual-sensor corroboration |
| Not detected | High-confidence detection | VIIRS-only detection |
| Not detected | Low-confidence detection | Lower-confidence VIIRS detection |
| High-confidence detection | Not detected | MODIS-only detection |
| Low-confidence detection | Not detected | Lower-confidence MODIS detection |

Importantly, a MODIS detection without a corresponding VIIRS detection should **not automatically be classified as extinguished**.

VIIRS might not have passed over that location, cloud cover might have interfered, or the fire might have changed between observations.

Absence of a detection is not necessarily evidence of absence of a fire.

### C. Don't discard MODIS coordinates after matching

Your proposal to anchor dual-confirmed detections to VIIRS coordinates makes sense for dashboard visualisation.

But for the model, preserve both observations.

For example:

```json
{
  "event_id": "fire_001",
  "observations": [
    {
      "sensor": "MODIS",
      "latitude": 31.50,
      "longitude": 74.30,
      "confidence": 85,
      "frp": 12.5,
      "timestamp": "..."
    },
    {
      "sensor": "VIIRS",
      "latitude": 31.501,
      "longitude": 74.302,
      "confidence": "h",
      "frp": 14.2,
      "timestamp": "..."
    }
  ],
  "detection_confidence": "dual_confirmed"
}
```

The coordinates and values above are illustrative.

Why preserve both?

Because the spread model might eventually benefit from knowing:
- How many observations were recorded.
- Which satellites detected the event.
- How FRP changed over time.
- Whether observations corroborated each other.
- How frequently the fire was detected.

If you replace MODIS with VIIRS completely, you lose potentially useful information.

---

## 3. Can the tracker identify related fires across both satellites?

Yes. This is where the tracker becomes particularly useful.

Consider this sequence:

1. MODIS detects a thermal anomaly.
2. VIIRS detects a nearby anomaly shortly afterwards.
3. VIIRS detects additional hotspots the following day.
4. MODIS detects another anomaly near the existing footprint.

The tracker can associate these observations with one fire event.

It should not matter whether an observation originated from MODIS or VIIRS. Both are observations of the same underlying phenomenon.

However, there is one important adjustment to our existing tracker:

**We need to account for the different spatial resolutions of the sensors when associating observations.**

A MODIS detection represents a much larger nominal pixel footprint than a VIIRS detection.

Consequently, using the same fixed point-to-point distance for both sensors can produce inappropriate associations.

I'd retain the actual observation coordinates and sensor footprint information, then account for footprint size when calculating spatial overlap or proximity.

Also, don't split a MODIS pixel into artificial VIIRS-sized detections. Your original reasoning is correct: that would manufacture observations that never existed.

---

## 4. One part I would NOT use for spread prediction: the velocity calculation

Your proposed formula:

\[
\vec{v}=\frac{\vec{x}_{VIIRS}-\vec{x}_{MODIS}}{\Delta t}
\]

is mathematically valid, but its interpretation is problematic.

A MODIS detection at 10:30 and a VIIRS detection at 13:30 do not necessarily represent the same fire front moving between two locations.

They could be:
- Two observations of the same stationary fire.
- Different portions of the same fire.
- Different hotspots within the same large event.
- Two independent nearby fires.

Therefore, calculating their coordinate difference and calling it fire-spread velocity could introduce misleading training data.

For our model, we should estimate expansion using changes in the **tracked fire footprint over time**, rather than the difference between individual MODIS and VIIRS detection coordinates.

That is much closer to what we want to predict.

---

## 5. How this connects to our three spread models

Remember our planned models:

| Model | What it predicts | How harmonisation helps |
|---|---|---|
| Model 1 | Probability that a fire persists | Multiple observations and sensor corroboration help establish event history. |
| Model 2 | Probability that a fire expands | More complete observations help establish whether the footprint is actually growing. |
| Model 3 | Amount of additional area if expansion occurs | A more reliable current footprint provides a better starting point for estimating additional area. |

The tracker should construct the same type of fire events for both historical training data and live dashboard data.

This is particularly important. If historical training uses one method of grouping detections while the dashboard uses another, the model will be trained on a different definition of a fire than the one it receives in production.

## 6. My recommended final architecture

I'd keep three separate concepts in the system:

| Component | What it measures |
|---|---|
| Detection confidence | How reliable is the satellite observation? |
| Tracking confidence | How confidently can we associate observations with the same fire event? |
| Prediction confidence | How reliable is the model's prediction, given the available data and its validation performance? |

These should never be treated as interchangeable.

For example, a fire could have:
- High detection confidence because both satellites detected it.
- Moderate tracking confidence because it was associated with a nearby event using an uncertain spatial match.
- Low prediction confidence because there is very little historical information about its development.

That is a perfectly valid combination.

---

### My conclusion

I would keep your MODIS–VIIRS harmonisation strategy, but make the following changes:

1. Preserve native sensor confidence rather than treating VIIRS as universally more accurate.
2. Give dual-sensor observations higher corroboration confidence.
3. Never interpret a missing detection as proof that a fire has extinguished.
4. Preserve both MODIS and VIIRS observations, even when using VIIRS coordinates for dashboard representation.
5. Feed both sensors into the same fire tracker.
6. Calculate spread from the evolution of tracked fire footprints, not differences between MODIS and VIIRS coordinates.
7. Keep detection, tracking and prediction confidence separate.

**Most importantly, we don't need two different fire-grouping systems.** The harmonisation layer prepares the observations, and the tracker groups them into fire events. Those exact same events can feed the dashboard and the spread-prediction models.

And you can do all of this without a database: periodically rebuild the events from the available observation history and generate a cached JSON/GeoJSON output.

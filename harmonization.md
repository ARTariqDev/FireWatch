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

```
                       ┌──────────────────────────────────────┐
                       │           MODIS Detection            │
                       │           (10:30 AM Terra)           │
                       └──────────────────┬───────────────────┘
                                          │
                               ~3-hour observation delay
                                          │
                                          ▼
                       ┌──────────────────────────────────────┐
                       │          VIIRS Overpass Scan         │
                       │         (13:30 PM NOAA-20)           │
                       └──────────────────┬───────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [ VIIRS Confirms Fire ]                       [ VIIRS Detects Nothing ]
                  │                                               │
                  ▼                                               ▼
     TIER 1: DUAL-CONFIRMED                          TIER 4: TRANSIENT / EXTINGUISHED
     • Confidence: 95% - 100%                        • Confidence: Low (< 30%)
     • Action: Anchor to VIIRS 375m coords           • Action: Mark as extinguished/cool
     • Significance: Active expanding front          • Significance: Fire put out or false alarm
```

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

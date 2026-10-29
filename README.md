# CU-BEMS Smart Building Analytics — Question B: Overcooling and Setpoint Opportunity

IS4001 Smart Building Analytics · Final project

This README documents the **Question B** pipeline for the CU-BEMS dataset (7-floor office
building, Bangkok, Jul 2018 – Dec 2019, 1-minute data):
*Are the office floors overcooled, and how much AC energy could setpoint changes save while
keeping zones within a comfort band?*

It follows the course decision chain:

```
Sense ──► Clean ──► Model ──► Detect ──► Visualise ──► Act
(Wk 2–3)  (Wk 3)   (Wk 4, 7)  (Wk 4, 7)   (Wk 6)      (Wk 10)
```

| Stage | Question it answers | Notebook / script (`notebooks/qn2/`) | Status |
|---|---|---|---|
| Clean | Is the data trustworthy and on one time base? | `cubems_prepare.ipynb` | Built |
| Model (energy) | How much AC should each zone normally use, given the weather, time and internal gains? | `qb_baseline_model.ipynb` | Built |
| Model (comfort) | Are occupants comfortable (PMV / PPD)? | `qb_comfort_pmv.ipynb` | Built |
| Model (setpoint) | How much AC does each zone save per °C warmer? | `qb_energy_per_degree.ipynb` | Built |
| Act | What setpoint raise does each zone get, and what does it save? | `qb_setpoint_sim.ipynb` | Built |
| Visualise | Dashboard for FM | `app/qb_dashboard.py` (Streamlit), `webapp/` (3D building view) | Built |
| Detect | When does AC use exceed normal, and is that overcooling? | `qb_detect_anomalies` | Planned |

Shared constants and functions (paths, PMV model, humidity conversions, setpoint simulation and
rule) live in `notebooks/qn2/qb_common.py`, so the notebooks, the dashboard and the web app compute
the same numbers. The Question A (after-hours energy) notebooks are in `notebooks/qn1*.ipynb` and
are not covered here.

---

## Quick start

```bash
pip install -r requirements.txt       # tested on Python 3.13
pip install pyarrow lightgbm          # optional: faster Parquet copies; LightGBM challenger
```

```
IS4001-G1T4/
├── data/qns2/
│   ├── 2018Floor1.csv ... 2019Floor7.csv   # the 14 raw CSVs (not committed; add them yourself)
│   ├── processed/           # Clean stage output
│   ├── baseline/            # energy baseline output
│   ├── comfort/             # PMV output
│   └── setpoint/            # energy-per-degree and setpoint simulation output
├── notebooks/qn2/
│   ├── cubems_prepare.ipynb
│   ├── qb_baseline_model.ipynb
│   ├── qb_comfort_pmv.ipynb
│   ├── qb_energy_per_degree.ipynb
│   ├── qb_setpoint_sim.ipynb
│   ├── qb_common.py
│   └── app/qb_dashboard.py
├── webapp/                  # FastAPI + React 3D building view (see webapp/README.md)
└── requirements.txt
```

1. Put the 14 raw CSVs directly in `data/qns2/`.
2. Run the notebooks from `notebooks/qn2/` in this order:
   `cubems_prepare` → `qb_baseline_model` → `qb_comfort_pmv` → `qb_energy_per_degree` → `qb_setpoint_sim`.
   The first run of `cubems_prepare` downloads weather from Open-Meteo; later runs use the cached file.
   `qb_baseline_model` fits every zone on Floors 2–7 in one run.
3. Dashboard: from the repository root, `streamlit run notebooks/qn2/app/qb_dashboard.py`.
4. 3D building view: see [webapp/README.md](webapp/README.md).

Thresholds are set in the **Settings** cell at the top of each notebook; comfort assumptions and
the setpoint rule thresholds are in `qb_common.py`.

The processed tables and the outputs read by the dashboard and web app are committed under
`data/qns2/`, so steps 3–4 work without re-running the notebooks. Bulky intermediate outputs
(Parquet copies, saved models, per-zone charts, most baseline CSVs) are git-ignored and are
re-created by running the notebooks.

---

## 1. Clean — `cubems_prepare.ipynb`

**Goal:** turn 14 raw, uncleaned 1-minute files into trustworthy, analysis-ready tables on a
common time base, with weather and holidays attached.

**Principle:** clean at the raw 1-minute level *before* averaging. Averaging first hides
problems instead of removing them (e.g. a 4,762 kW lighting spike becomes a plausible-looking
330 kW 15-minute average).

### 1.1 Fix structure (per raw file)

| # | Step | Rule | Why |
|---|---|---|---|
| 1 | Find files | Read year and floor from `{year}Floor{n}.csv` | Same treatment for every file |
| 2 | Parse timestamps | Unreadable `Date` values are dropped | They cannot be placed in time |
| 3 | Remove duplicates | Keep the first row per timestamp | Avoids double-counting energy |
| 4 | Sort | Chronological order | Needed for gap logic and averaging |
| 5 | Force numeric | Non-numeric readings become missing | Stray text breaks calculations |
| 6 | Complete the time grid | Re-index to every minute; missing minutes become empty rows | Makes gaps visible instead of hidden |
| 7 | Rename columns | `z1_AC1(kW)` → `z1_ac1_kw`, `z2_S1(degC)` → `z2_temp_c`, `(RH%)` → `_rh_pct`, `(lux)` → `_lux` | Consistent, code-friendly names |

### 1.2 Clean readings (1-minute level)

| # | Step | Rule | Why |
|---|---|---|---|
| 8 | Negative power | Power < 0 kW removed | Consumption cannot be negative |
| 9 | Power spikes | Power > max(3 × column 99.9th percentile, 10 kW) removed | Removes impossible values; the 10 kW floor protects rarely used units |
| 10 | Indoor temperature range | Outside 10–40 °C removed | Physically implausible indoors |
| 11 | Humidity range | Outside 0–100 % RH removed | Physically impossible |
| 12 | Lux range | Outside 0–100,000 lux removed | Light cannot be negative |
| 13 | Stuck sensors | Temperature or RH unchanged for ≥ 6 h removed | Frozen sensor; lux exempt (legitimately 0 all night) |
| 14 | Short gaps | Gaps ≤ 30 min linearly interpolated | Brief dropouts do not change the picture |
| 15 | Long gaps | Gaps > 30 min left missing | Avoids inventing data |

Long gaps are **not** filled with typical or median values, so the models only see measured
data. (The baseline model does fill missing *lighting and plug* inputs; see 2.1.)

### 1.3 Resample to a common time base

| # | Step | Rule |
|---|---|---|
| 16 | 15-minute tables | Mean of each 15-minute window (comfort and setpoint analysis) |
| 17 | Hourly tables | Mean of each hour; hourly mean kW = kWh in that hour (baseline model; matches hourly weather) |
| 18 | Coverage rule | A window is kept only if ≥ 67 % of its readings are present |

Values are labelled with the **start** of their window (10:00 = 10:00–10:59).

### 1.4 Derived columns and flags

| # | Column / flag | Definition |
|---|---|---|
| 19 | Idle AC units | Units averaging < 0.1 kW; listed in `reports/idle_units.csv`, kept in the data, excluded from totals |
| 20 | `zX_ac_total_kw` | Sum of the zone's active AC units; missing if any active unit is missing (baseline target) |
| 21 | `floor_ac_kw`, `floor_light_kw`, `floor_plug_kw`, `floor_total_kw` | Floor totals by end use, built the same way so they are never understated |
| 22 | `zX_humidity_ratio` | kg water / kg dry air from indoor T and RH (ASHRAE 55 limit: 0.012) |

### 1.5 Augment with external data

| # | Data | Source | Treatment |
|---|---|---|---|
| 23 | Hourly outdoor weather: temperature, RH, dew point, apparent temperature, cloud, wind, solar radiation, precipitation | [Open-Meteo historical API](https://open-meteo.com/) (ERA5-based), at 13.7367 N, 100.5323 E, local time (UTC+7) | Cached to `weather/openmeteo_bangkok_hourly.csv`. Solar and precipitation (preceding-hour totals) re-labelled to the hour they describe. Interpolated to 15 min (solar and precipitation held constant within the hour); averaged to match hourly building data. Adds cooling degree hours (`out_cdh`, base 24 °C) and daily cooling degree days |
| 24 | Thai public holidays and calendar | Python `holidays` package, to be cross-checked against the Bank of Thailand list; manual additions via `EXTRA_HOLIDAYS` | Adds `is_holiday`, `holiday_name`, `day_type` (workday/weekend/holiday), `is_workday`, `day_after_holiday`, `is_occupied` (workday 08:00–16:59, excluding the 12:00–12:59 lunch hour) |

Why augment: CU-BEMS has no outdoor weather (its temperature sensors are indoors), and AC load
depends on outdoor conditions. Holidays are needed so that empty-building days are not treated
as normal workdays.

### 1.6 Combine and verify

| # | Step | What it does |
|---|---|---|
| 25 | Join years | 2018 + 2019 → one continuous Jul 2018 – Dec 2019 table per floor |
| 26 | Timestamp check | Indoor lux must peak between 08:00 and 16:00 on each floor (confirms timestamps are local time and correctly aligned) |

### 1.7 Clean-stage outputs (`data/qns2/processed/`)

| File | Contents |
|---|---|
| `clean_15min/floor{n}_15min.csv` | Clean 15-min data + weather + calendar (comfort and setpoint input) |
| `clean_hourly/floor{n}_hourly.csv` | Clean hourly data + weather + calendar (**baseline model input**) |
| `all_floors_hourly.csv` | All floors side by side (`f1_`, `f2_` … prefixes) |
| `weather/openmeteo_bangkok_hourly.csv` | Weather download cache |
| `weather/daily_weather_cdd.csv` | Daily mean outdoor temperature and cooling degree days |
| `calendar/thai_holidays.csv` | Holiday list used (for cross-checking) |
| `reports/cleaning_log.csv` | Every rule applied, per file and column, with readings changed |
| `reports/data_quality.csv` | Missing % before/after cleaning and hourly; max before/after |
| `reports/file_summary.csv` | Bad, duplicate and missing timestamps per file |
| `reports/idle_units.csv` | Idle AC units |

`.parquet` copies are written alongside each CSV when `pyarrow` is installed (faster to reload,
keeps data types; not committed).

### 1.8 Known data-quality issues

| Issue | Where | Handling |
|---|---|---|
| Building-wide indoor sensor outage | All floors, ~12 Sep 2018 – 6 Mar 2019 | Comfort and setpoint analysis use Jul – mid-Sep 2018 and Mar – Dec 2019 only; energy baseline unaffected (uses power, gains + weather) |
| No environmental sensors | Floor 1 (all zones), zone 3 on Floors 3–7 | Excluded from comfort analysis. Floors 3–7 zone 3 also has no AC meter |
| Sensor but no AC meter | F2 z3 | Comfort only, no savings estimate (on the inspection list) |
| Long single-zone outages | e.g. F5 z2 (20 Jul – 27 Sep 2019), F3 z5 (from 21 Aug 2018, ahead of the building-wide outage) | Left missing; reported |
| Implausibly cold sensor | F5 z1 (office-hour median 16.1 °C, min ~11 °C) | Likely near a supply diffuser; on the inspection list, so no setpoint change is recommended |
| Idle AC units | 4 on Floor 2, 3 per floor on Floors 3–7, 2 on Floor 1 | Kept, flagged, excluded from totals |
| Short 2019 file | `2019Floor6.csv` ends 22 Oct 2019 13:27 | Floor 6 has no data after that date |

---

## 2. Model

Three models feed the setpoint simulation and the planned Detect stage: an **energy baseline**
(what AC use is normal?), a **comfort model** (are people comfortable?) and an **energy-per-degree
slope** (what does +1 °C save?).

### 2.1 Energy baseline — `qb_baseline_model.ipynb`

**Predicts:** normal hourly AC power (kW) per AC zone on Floors 2–7 (23 zones), given outdoor
weather, time and internal heat gains. It describes business as usual (overcooling included) —
it is a reference, not a target.

| Item | Choice | Reason |
|---|---|---|
| Floors | 2–7, every zone with an AC meter | Floor 1 has no zone sensors |
| Target | `zX_ac_total_kw`, hourly | One baseline per AC zone |
| Rows | Occupied workday hours only (`is_occupied`) | Overcooling only matters when people are present; holidays, weekends and nights belong to Question A |
| Rows dropped | Workday hours with whole-floor AC < 1 kW (closure or metering outage); the same non-zero reading ≥ 4 h in a row (stuck meter) | Not normal operation |
| Weather inputs | Outdoor temperature, RH, solar radiation; temperature 2 h earlier, mean of the previous 24 h, solar 1 h earlier | Weather drives cooling demand; the building stores heat |
| Internal gains | The zone's lighting and plug power (missing values filled with the training median for that hour and weekday) | Proxy for occupancy and equipment heat; not caused by the AC |
| Time inputs | Hour, day of week, day after a holiday, first two hours after a weekend or holiday | Operating schedule and morning pull-down |
| Not an input | Indoor temperature | It is caused by the AC (circular), and it is missing Sep 2018 – Mar 2019 |
| Train / validation / test | Train Jul 2018 – Jun 2019; the last 3 training months (Apr – Jun 2019) are the validation window; test Jul – Dec 2019 | Every modelling choice is made on validation; the test period is scored once |

**Models compared**

| Role | Model | Formula / features |
|---|---|---|
| Primary | Multiple linear regression (statsmodels OLS/WLS, Newey-West HAC errors) | `ac_kw ~ C(daypart):out_temp_c + cooling_hinge + temp_lag2 + temp_roll24 + out_rh_pct + out_solar_wm2 + solar_lag1 + light_kw + plug_kw + C(hour) + C(day_of_week) + day_after_holiday + startup_after_break` |
| Challenger | LightGBM (falls back to scikit-learn HistGradientBoosting) | Same inputs; captures curves and interactions |

- `C(daypart):out_temp_c` gives a separate temperature slope for morning (8–10), midday (11–13)
  and afternoon (14–16).
- `cooling_hinge` = max(0, outdoor temperature − change point): an ASHRAE change-point term. The
  change point is grid-searched (0.5 °C steps, 10th–90th percentile of training temperature).

Linear regression is the primary model because it is the standard method for energy baselines
(ASHRAE Guideline 14, IPMVP), each coefficient is meaningful to FM (e.g. kW per °C outdoors),
and it is hard to overfit.

**Drift handling (step changes).** A binary-segmentation search finds the date that best splits
each zone's training residuals into two levels; a shift above 10 % of mean AC power is flagged.
Three ways of handling drift are compared on the validation window: `none`, `regime` (a 0/1
indicator from the detected date, only if flagged) and `recency` (training hours weighted with a
120-day half-life).

**Model selection rule:** on the validation window, score = CV(RMSE) + |NMBE|. Linear regression
is used unless the challenger passes ASHRAE 14 there **and** beats the best linear score by ≥ 2
points. Model and drift handling are chosen per zone.

**Validation — ASHRAE Guideline 14 (test period)**

```
CV(RMSE) = sqrt( Σ(y − ŷ)² / (n − p) ) / ȳ × 100
NMBE     = Σ(y − ŷ) / ((n − p) · ȳ) × 100
```

| Level | CV(RMSE) | NMBE |
|---|---|---|
| Hourly | ≤ 30 % | within ±10 % |
| Monthly | ≤ 15 % | within ±5 % |

`p` = number of model parameters on training data; `p = 1` on the test period. The notebook also
reports a **rolling-origin** check (retrain on the previous 12 months, predict the next month), the
**fractional savings uncertainty** (FSU) of a 10 % saving at 68 % confidence (ASHRAE 14 asks
< 50 %), and the **AC kW per +1 °C outdoors** with Newey-West standard errors.

**Results (committed `summary_metrics.csv`):** 16 of 23 zones pass ASHRAE 14 hourly, 12 of 23
pass monthly, and all 23 could measure a 10 % saving (FSU < 50 %). Linear regression is chosen
for 20 zones, the challenger for 3.

**Outputs (`data/qns2/baseline/`)**

| File | Contents |
|---|---|
| `summary_metrics.csv` | One row per zone, Floors 2–7: chosen model, test CV(RMSE)/NMBE (hourly, daily, monthly), rolling-origin, FSU, change point, kW per °C (read by the dashboard and web app) |
| `settings.json` | Settings used for the run |
| `floor{n}/predictions_occupied_hours.csv` | Actual, predicted (both models), chosen model, **`resid`** (actual − predicted) for every normal occupied hour, plus inputs → **Detect input** |
| `floor{n}/metrics.csv` | CV(RMSE), NMBE, R², MAE for both models, train and test, per zone |
| `floor{n}/model_selection.csv` | Every candidate's validation score and which was chosen |
| `floor{n}/linear_coefficients.csv` | Coefficients, HAC standard errors, p-values |
| `floor{n}/temperature_effect.csv` | kW per +1 °C outdoors with HAC and ordinary standard errors |
| `floor{n}/step_change_check.csv` | Detected break date and size per zone |
| `floor{n}/rolling_origin.csv` | Monthly accuracy when retrained on the previous 12 months |
| `floor{n}/cleaning_log.csv` | Hours dropped (closures/outages, stuck meters) and gains imputed |
| `floor{n}/charts/floor{n}_{zone}_baseline.png` | Test weeks, actual vs predicted, monthly residuals |
| `floor{n}/models/floor{n}_{zone}_baseline.joblib` | Saved models |

Only `summary_metrics.csv` and `predictions_occupied_hours.csv` are committed.

### 2.2 Comfort model — PMV / PPD — `qb_comfort_pmv.ipynb`

**Computes:** a thermal comfort score for every office 15-minute period per zone (Floors 2–7),
using the ISO 7730 / ASHRAE 55 PMV model. PMV is implemented in `qb_common.pmv_ppd` (ISO 7730
Annex D algorithm); the notebook checks it against the ISO 7730 validation table (±0.02) and it was
checked against `pythermalcomfort` (max difference 0.006).

| PMV input | Source | Value |
|---|---|---|
| Air temperature | Measured: `zX_temp_c` | Per reading |
| Relative humidity | Measured: `zX_rh_pct` | Per reading |
| Mean radiant temperature | Assumed | = air temperature (only air temperature is measured) |
| Air speed | Assumed | 0.1 m/s |
| Metabolic rate | Assumed | 1.1 met (seated, typing) |
| Clothing | Assumed | 0.61 clo (trousers, long-sleeve shirt) |

**Comfort definition:** comfortable if **−0.5 ≤ PMV ≤ +0.5 (PPD ≤ 10 %)** — ISO 7730 Category B /
ASHRAE 55. Below −0.5 is *too cool*, above +0.5 *too warm*. Periods with RH > 65 % are flagged
*too humid* separately. At these assumptions PMV reaches −0.5 at about 23 °C (60 % RH).

| Design choice | Reason |
|---|---|
| PMV rather than adaptive comfort | The building is sealed and air-conditioned (Week 7, slides 15, 43) |
| Sensitivity grid: clothing 0.5 / 0.61 / 0.75 / 1.0 clo × activity 1.0 / 1.1 / 1.2 met | Clothing and activity are not recorded; tests how the too-cool share moves |
| Inspection list | Zones flagged if median office temperature < 18 °C or > 30 °C, daily mean temperature std < 0.3 °C, coverage < 50 %, or no AC meter. Flagged zones get no setpoint change until checked on site (currently F2 z3, F5 z1) |
| Months used | Jul – mid-Sep 2018, Mar – Dec 2019 (sensor outage) |

**Result (committed outputs):** 73.7 % of office time is too cool, 21.9 % comfortable and 4.3 %
too warm across all sensor zones. Most zones run at a median 19–22 °C.

**Outputs (`data/qns2/comfort/`):** `pmv_15min.csv` (per-period temperature, RH, AC kW, PMV, PPD,
comfort class, humid flag), `heatmap_zone_month.csv`, `zone_summary.csv`, `inspection_list.csv`,
`sensitivity_clo_met.csv`, `comfort_heatmap.png`.

### 2.3 Energy per degree — `qb_energy_per_degree.ipynb`

**Estimates:** AC kW saved per °C warmer, per zone, used to turn a setpoint change into kWh.

- Office hours in the sensor months, averaged to **one value per zone per day** (hour by hour, AC
  and room temperature drive each other).
- Per zone OLS: `ac_kw ~ zone_temp_c + out_temp_c + out_rh_pct + C(dow)`. The zone-temperature
  coefficient is the AC change for a zone kept 1 °C warmer on a day with the same weather.
- Fallback: if a zone's slope is not negative or has p > 0.05, the floor's pooled slope (scaled to
  the zone's mean AC) is used. Currently only F7 z5 uses the fallback.
- Moisture: `humidity ratio ~ zone_temp_c + out_dewpoint_c + C(dow)` gives how much the humidity
  ratio rises per °C warmer (the AC removes less water).

**Result:** median 6.9 % of a zone's AC saved per +1 °C (range 3.6–12.0 %), in line with the
commonly quoted 6–10 % per °C. This is observational data, not a controlled setpoint trial.

**Outputs (`data/qns2/setpoint/`):** `kw_per_degC.csv`, `energy_per_degree.png`.

---

## 3. Act — setpoint simulation and rule — `qb_setpoint_sim.ipynb`

**Main assumption:** zone air temperature follows the setpoint, so "+1 °C setpoint" = "+1 °C
measured zone temperature". The simulation (`qb_common.simulate_setpoint`) raises each 15-min
temperature by Δ, raises the humidity ratio by the zone's moisture slope, recomputes RH and PMV,
and saves `slope × Δ` kW, never more than the AC used in that period.

1. **Scenarios:** every zone with an AC meter at +1 °C and +2 °C over the whole sensor period.
2. **Rule-based setpoint** (`qb_common.recommend_raise`, per zone per month, needs ≥ 160 periods):
   - raise 1 °C at a time while > 25 % of office time is too cool;
   - roll back the last step if > 10 % would be too warm, or the share above 65 % RH would exceed
     max(10 %, today's share);
   - cap at +3 °C; zones on the inspection list are not changed.
3. **Ranking** of zones by annualised kWh saved (scaled to the 7,776 office 15-min periods in 2019).
4. **KPIs** before vs after the recommended changes.

**Result (committed `kpis.csv`):**

| KPI | Today | After | Change |
|---|---|---|---|
| AC energy per office hour (actual), Floors 2–7 | 366.0 kWh/h | 325.2 kWh/h | −11.1 % |
| AC energy per office hour (weather-normalised baseline) | 363.5 kWh/h | 323.0 kWh/h | −11.1 % |
| Too-cool office time (PMV < −0.5) | 73.7 % | 32.6 % | |
| Comfortable office time | 21.9 % | 60.3 % | |
| Too-warm office time (guardrail) | 4.3 % | 7.1 % | |
| Too-humid office time, RH > 65 % (guardrail) | 39.1 % | 28.6 % | |
| Peak 15-min cooling demand, office days | 663.4 kW | 627.5 kW | −5.4 % |

Estimated AC saved across Floors 2–7: about 86,000 kWh per year.

**Outputs (`data/qns2/setpoint/`):** `scenarios.csv`, `recommendations_monthly.csv`,
`recommendations_by_zone.csv`, `kpis.csv`, `savings_ranking.png`.

---

## 4. Visualise

- **Streamlit dashboard** — `streamlit run notebooks/qn2/app/qb_dashboard.py` (from the repo
  root): comfort heat map, energy model view and setpoint simulator. Reads the outputs above.
- **3D building view** — `webapp/` (FastAPI + React): colour zones by comfort or AC power, try a
  setpoint what-if (±5 °C, beyond ±3 °C is extrapolation), and replay an office day. See
  [webapp/README.md](webapp/README.md).

---

## 5. Detect *(planned: `qb_detect_anomalies`)*

**Goal:** find hours and periods when a zone used more AC than normal for the weather, and label
each one using comfort, so FM gets a triaged list — not a list of "faults".

**Input:** `baseline/floor{n}/predictions_occupied_hours.csv` (`resid` = actual − predicted AC kW,
hourly) joined to `comfort/pmv_15min.csv` (averaged to the hour) by timestamp and zone.

### 5.1 Anomaly types (Week 4 / Week 7)

| Type | Definition in this project | Method |
|---|---|---|
| **Point** | A single occupied hour with an extreme residual | Standardised residual \|r\| > 4 |
| **Collective** | A sustained run of above-normal AC use | EWMA control chart on residuals (5.2) |
| **Contextual** | Use that is abnormal *given its context*: above-normal AC while the zone is already too cool | Residual flag + PMV < −0.5 (5.3) |

### 5.2 EWMA control chart (collective anomalies)

Residuals are standardised per zone using the **training-period** residual mean and standard
deviation, then smoothed:

```
r_t   = (resid_t − mean_train) / sd_train
z_t   = λ · r_t + (1 − λ) · z_{t−1}          λ = 0.2
limit = L · sqrt( λ / (2 − λ) )              L = 3   (≈ 1.0 for λ = 0.2)
```

| Parameter | Value | Reason |
|---|---|---|
| λ (smoothing) | 0.2 | Standard choice; sensitive to small sustained shifts, not single noisy hours |
| L (limit width) | 3 | Conventional 3-sigma control limit |
| Sequence | Consecutive occupied hours per zone | Nights, weekends and holidays are excluded, so the chart runs across working hours |
| Event | `z_t` above the upper limit for ≥ 3 consecutive occupied hours | Avoids one-hour blips |
| Excess energy | Σ positive residuals during the event (kWh) | Sizes each event in kWh and baht |

Only the **upper** side is used for overcooling. Sustained negative runs (less AC than expected)
are reported separately as possible equipment problems or unusually low occupancy.

### 5.3 Comfort cross-check (contextual labelling)

Each event is labelled by its median PMV:

| AC use | Comfort | Label | Suggested FM action |
|---|---|---|---|
| Above normal | Too cool (PMV < −0.5) | **Candidate overcooling** | Raise setpoint in steps; re-check PMV |
| Above normal | Comfortable | Possibly justified load | Check occupancy or heat gains; no change |
| Above normal | Too warm (PMV > +0.5) | Ineffective cooling | Maintenance inspection |
| Normal | Out of band | Comfort-complaint risk | Review setpoint or airflow |

Labels are **candidate anomalies** for FM to confirm (`confirmed` / `false alarm` /
`needs inspection` in the dashboard), never confirmed faults.

### 5.4 Planned outputs

| File | Contents |
|---|---|
| `anomaly_events.csv` | One row per event: zone, start, end, hours, excess kWh, median PMV, label, anomaly type |
| `anomaly_hours.csv` | Hour-level residual, standardised residual, EWMA value, limit, flags |
| `charts/{zone}_ewma.png` | EWMA chart with limits and events shaded |

---

## 6. Assumptions and limitations

- **No occupancy data.** "Occupied" means workday 08:00–16:59 excluding the 12:00 lunch hour and
  Thai public holidays. Lighting and plug power are used as an occupancy proxy in the baseline.
- **Comfort is inferred, not surveyed.** No occupant feedback is available (Week 7, slide 27);
  clothing, activity, air speed and radiant temperature are assumed, and clothing/activity are
  tested in a sensitivity grid.
- **No setpoint data.** The dataset records temperatures reached, not setpoints. The simulation
  assumes zone temperature follows the setpoint; FM must confirm current setpoints before acting.
- **Energy per degree is observational**, from day-to-day variation, not a controlled trial.
- **Weather is reanalysis data** (~25 km grid), not an on-site station.
- **The baseline reflects past operation**, including any overcooling. Savings are measured
  against business as usual.
- **Anomalies are candidates**, not confirmed faults.

## 7. Data sources and credits

- CU-BEMS dataset: Pipattanasomporn et al. (2020), *Scientific Data*;
  [Kaggle](https://www.kaggle.com/datasets/claytonmiller/cubems-smart-building-energy-and-iaq-data/data).
- Weather: [Open-Meteo.com](https://open-meteo.com/), based on ECMWF ERA5 reanalysis (CC BY 4.0).
- Holidays: Python [`holidays`](https://pypi.org/project/holidays/) package, to be cross-checked
  against the Bank of Thailand holiday list.
- Standards: ASHRAE Guideline 14 (baseline accuracy), ASHRAE 55 / ISO 7730 (thermal comfort),
  IPMVP (measurement and verification).

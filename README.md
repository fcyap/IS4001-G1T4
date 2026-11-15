# Building comfort and energy view

A local proof of concept combining Question A's after-hours circuit audit with Question B's cooling comfort and setpoint savings.

The app opens on a **landing page**: the 3D building on its own, slowly turning, with one card per question, its headline
number and the recommended action. Pick a card to open that question on **Today**.

Inside, the top bar shows the two questions, then that question's own modes. The left panel summarises the whole building,
a floor, or a zone, depending on what you select. The right panel is a schematic 3D view of the building's seven floors.
The **Chamchuri 5** button (or Esc from the whole-building view) returns to the landing page.

**After-hours Waste** (Question A)
- **Today**: colour zones by mean after-hours circuit load. The panel shows preventable energy and cost and the circuit
  classification (preventable waste, critical standby or mixed). Selecting a zone shows its lighting and plug circuits;
  preventable circuits with a timer-like after-hours pattern (the K-Means Extended-Hours group) are flagged, because they
  may follow an operating rule, so facility managers can keep them on with an exception.
- **What-if simulation**: each circuit starts with the model's recommendation (Critical Standby: keep on 24/7; Preventable Waste: off after hours). Set the curfew hours for the building, a floor or a zone (off from 17:00–23:00 until 05:00–08:00), and choose whether weekends and public holidays are also off all day. In a zone, change any circuit to keep on 24/7, follow the curfew, or its own hours. Estimated energy and cost savings come from historical hourly circuit readings.

**Cooling Comfort** (Question B)
- **Today**: colour zones by % of office time too cool, % comfortable, mean PMV, or AC power.
- **Setpoint what-if**: apply the rule recommendation, or raise or lower every zone by the same amount (up to ±5 °C).
  - You can also override single zones, over the same ±5 °C range.
  - It shows the AC energy saved (or the extra AC a lower setpoint uses) and the comfort before and after.
  - Zones that break the comfort guardrail in any month pulse red: too warm or too humid after a raise,
    or colder than today (and above the rule's 25 % too-cool trigger) after a cut.
- **Replay a day**: step through one office day in 15-minute periods, as recorded or with the setpoint change applied.

Zone shapes are traced from Fig. 2 of the CU-BEMS paper (Pipattanasomporn et al., 2020): one plan for Floors 1-2,
another for Floors 3-7. The facade, stair towers and rooftop PV are schematic. The data is a historical replay, not a live feed.

## Run it

Every command below is run from the **repository root** (the folder that contains `webapp/`, `data/` and `requirements.txt`).
The data the app needs is already in the repository.

### 1. Install Python and Node (once)

You need **Python 3.11 or newer** (3.13 recommended) and **Node.js 18 or newer**. Check what you have:

```bash
python3 --version    # Windows: python --version
node --version
```

If either is missing or too old:
- **macOS:** `brew install python@3.13 node`. The `python3` that ships with macOS is 3.9, which is too old.
- **Windows:** install from [python.org](https://www.python.org/downloads/) (tick **Add python.exe to PATH**) and [nodejs.org](https://nodejs.org/).

### 2. Set up the project (once)

**macOS / Linux**

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd webapp/web && npm install && npm run build && cd ../..
```

**Windows (PowerShell)**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd webapp/web; npm install; npm run build; cd ../..
```

If PowerShell blocks `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then try again.

### 3. Start the app (every time)

**macOS / Linux**

```bash
source .venv/bin/activate
python -m webapp.api
```

**Windows (PowerShell)**

```powershell
.venv\Scripts\Activate.ps1
python -m webapp.api
```

Open **http://localhost:8000**. Press Ctrl+C in the terminal to stop it.
After pulling new frontend changes, run `npm run build` in `webapp/web` again before starting.

### Development, with hot reload

This starts the API on :8000 and Vite on :5173, and opens http://localhost:5173. Edits to the frontend show up straight away.

```bash
./webapp/run_dev.sh                                           # macOS / Linux
powershell -ExecutionPolicy Bypass -File webapp\run_dev.ps1   # Windows
```

### If it doesn't start

| What you see | What to do |
|---|---|
| `pip install` fails on pandas or numpy | Python is older than 3.11. Delete `.venv` and redo step 2 with a newer Python. |
| `No module named 'fastapi'` | The virtual environment isn't active. Run the activate line from step 3 first. |
| `Port 8000 is already in use` | The app is already running in another terminal. Stop it, or use `python -m webapp.api --port 8001`. |
| The page shows `{"detail":"Not Found"}` | The frontend isn't built. Run `npm install && npm run build` in `webapp/web`. |
| The page stays on *Loading building data…* | The API stopped with an error. Check the terminal where you started it. |
| `npm: command not found` | Install Node.js (step 1), then open a new terminal. |

**Deep links** for presenting. A bare URL opens the landing page:
- `?topic=afterhours`, `?topic=afterhours&floor=1`, `?topic=afterhours&mode=whatif` (the What-If Simulation)
- `?topic=comfort`
- `?mode=whatif&floor=4` (any link without `topic` opens Cooling Comfort)
- `?floor=7&zone=z4`
- `?mode=replay`
- `?view=plan&floor=6`

## Where the numbers come from

The API (`webapp/api`) reads Question A's circuit classification from `data/qn1_circuit_waste_and_classification.csv` and calculates monthly after-hours energy from `data/qn1_hourly_master_for_excel.csv`. Each row is one hour of mean kW; preventable energy is the saving from a curfew: all after-hours load on preventable lighting circuits (a curfew switches them fully off) and, for preventable plug circuits, the after-hours load above the dynamic P2.5 circuit baseload (the standby equipment stays powered), and cost applies the peak/off-peak tariff schedule plus `data/thai_holidays_18months.csv` (excluding VAT). The annual view sums the clean notebook training period, July 2018–June 2019, from those same hourly readings so its totals add up to the twelve displayed months. Missing meter readings remain unavailable, and partial months expose their coverage. The notebook's exported 18-month-normalized annual CSV values are not used for the web app's annual rollup because they do not add up to the month-specific series. The API also reads the CSVs the Question B notebooks write to `data/qns2/` and does not refit those source analyses.

The AC baseline (`qb_baseline_model`) is built at two levels:
- **Zone baselines** (`baseline/floor<N>/`) are for diagnosis. Several zones drift after mid-2019, with AC load moving between zones on the same floor.
- **Floor baselines** (`baseline/by_floor/floor<N>/`, whole-floor AC) are the ones to verify savings against, because that load shifting cancels in the floor total.

`baseline/ashrae14_compliance.csv` holds the ASHRAE Guideline 14 checks (hourly and monthly) for both levels, on the baseline period and the Jul–Dec 2019 test. The side panel's baseline badges and alerts, and the "AC Energy Against the Baseline" chart, read these. The chart uses the floor baseline for a floor and the sum of floor baselines for the building. The setpoint savings themselves come from the kW-per-°C slopes, not from the baseline.
Run the notebooks first: `cubems_prepare` → `qb_baseline_model` → `qb_comfort_pmv` → `qb_energy_per_degree` →
`qb_setpoint_sim`.

The what-if uses the same physics as `qb_common.simulate_setpoint`, vectorised over every zone:
- the zone air follows the setpoint;
- moisture rises by the zone's g/kg-per-°C slope;
- AC saved = kW-per-°C × raise, capped at the AC in use;
- a lower setpoint runs the same in reverse: the air cools, moisture falls, and the AC uses kW-per-°C more per degree,
  capped at the zone's highest metered AC power.

The slopes come from changes of a few degrees, so beyond 3 °C either way the figures are extrapolations, including the rule's own changes up to its ±5 °C cap.

The guardrail is checked month by month, like `recommend_raise`.

The API's rule mode reproduces `setpoint/kpis.csv`: too cool 73.7 → 32.6 %, comfortable 21.9 → 60.3 %.

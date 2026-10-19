# Question B building view

A local proof of concept for Question B (cooling comfort and setpoint savings). The left panel summarises
the whole building, a floor, or a zone, depending on what you select. The right panel is a schematic 3D view
of the building's seven floors.

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

You need Python 3.13 with `requirements.txt` installed, and Node 18 or later. Run from the repository root.

**Demo, one process.** This serves the built app and the API on http://localhost:8000:

```powershell
cd webapp/web; npm install; npm run build; cd ../..
python -m webapp.api
```

**Development, with hot reload.** This starts the API on :8000 and Vite on :5173:

```powershell
powershell -ExecutionPolicy Bypass -File webapp\run_dev.ps1
```

**Deep links** for presenting:
- `?mode=whatif&floor=4`
- `?floor=7&zone=z4`
- `?mode=replay`
- `?view=plan&floor=6`

## Where the numbers come from

The API (`webapp/api`) reads the CSVs the Question B notebooks write to `data/qns2/` and does not refit anything.
Run the notebooks first: `cubems_prepare` → `qb_baseline_model` → `qb_comfort_pmv` → `qb_energy_per_degree` →
`qb_setpoint_sim`.

The what-if uses the same physics as `qb_common.simulate_setpoint`, vectorised over every zone:
- the zone air follows the setpoint;
- moisture rises by the zone's g/kg-per-°C slope;
- AC saved = kW-per-°C × raise, capped at the AC in use;
- a lower setpoint runs the same in reverse: the air cools, moisture falls, and the AC uses kW-per-°C more per degree,
  capped at the zone's highest metered AC power.

The slopes come from changes of a few degrees, so beyond 3 °C either way (the rule's own cap) the figures are extrapolations.

The guardrail is checked month by month, like `recommend_raise`.

The API's rule mode reproduces `setpoint/kpis.csv`: too cool 73.7 → 32.6 %, comfortable 21.9 → 60.3 %.

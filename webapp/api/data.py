"""Loads the Question B outputs once and builds the zone registry used by the building view.

Everything here is read from the CSVs written by the notebooks in notebooks/qn2; nothing is
recomputed except what the what-if simulation needs (see sim.py).
"""
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

QN2_DIR = Path(__file__).resolve().parents[2] / "notebooks" / "qn2"
sys.path.insert(0, str(QN2_DIR))
import qb_common as qc  # noqa: E402

# Zones per floor in the raw CU-BEMS files (z1..zN). Floor 1 is the only floor without sensors.
ZONES_PER_FLOOR = {1: 4, 2: 4, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5}
FLOOR1_AC_ZONES = {"z2"}          # floor 1 has AC metered in z2 only (AC1-4), no temperature sensor


@dataclass
class Store:
    pmv: pd.DataFrame               # 15-min office periods, sensor zones, Floors 2-7
    heatmap: pd.DataFrame
    inspection: pd.DataFrame
    slopes: pd.DataFrame
    monthly: pd.DataFrame
    preds: pd.DataFrame             # hourly actual vs baseline, occupied hours
    registry: list[dict]
    months: list[str]
    office_days: list[str]


def _zone_registry(zone_summary, slopes, inspection, baseline) -> list[dict]:
    sensor = {(r.floor, r.zone) for r in zone_summary.itertuples()}
    slope = {(r.floor, r.zone): r for r in slopes.itertuples()}
    inspect = {(r.floor, r.zone): r.reason for r in inspection.itertuples()}
    base = {(r.floor, r.zone): r for r in baseline.itertuples()}
    out = []
    for floor, n in ZONES_PER_FLOOR.items():
        for k in range(1, n + 1):
            zone, key = f"z{k}", (floor, f"z{k}")
            has_sensor = key in sensor
            has_ac = key in slope or (floor == 1 and zone in FLOOR1_AC_ZONES)
            if has_sensor:
                status, note = "data", None
            elif floor == 1:
                status, note = "nodata", ("AC metered but no temperature sensor on Floor 1" if has_ac
                                          else "lighting and plugs only, no sensor")
            else:
                status, note = "nodata", "lighting and plugs only (no AC, no sensor)"
            b = base.get(key)
            s = slope.get(key)
            out.append({
                "id": f"F{floor}:{zone}", "floor": floor, "zone": zone,
                "status": status, "note": note,
                "has_sensor": has_sensor, "has_ac": has_ac, "simulated": key in slope,
                "inspect": inspect.get(key),
                "kw_per_c": None if s is None else round(float(s.saving_kw_per_c), 3),
                "kw_per_c_source": None if s is None else s.source,
                "pct_per_c": None if s is None else round(float(s.saving_pct_per_c), 2),
                "moisture_per_c": None if s is None else round(float(s.moisture_g_per_kg_per_c), 3),
                "baseline": None if b is None else {
                    "model": b.chosen_model, "cv_rmse_pct": float(b.cv_rmse_pct),
                    "nmbe_pct": float(b.nmbe_pct), "r2": float(b.r2),
                    "passes": bool(b.passes_ashrae14)},
            })
    return out


def load() -> Store:
    pmv = pd.read_csv(qc.COMFORT_DIR / "pmv_15min.csv", parse_dates=["timestamp"])
    pmv = pmv.sort_values(["floor", "zone", "timestamp"]).reset_index(drop=True)
    heatmap = pd.read_csv(qc.COMFORT_DIR / "heatmap_zone_month.csv")
    zone_summary = pd.read_csv(qc.COMFORT_DIR / "zone_summary.csv")
    inspection = pd.read_csv(qc.COMFORT_DIR / "inspection_list.csv")
    slopes = pd.read_csv(qc.SETPOINT_DIR / "kw_per_degC.csv")
    monthly = pd.read_csv(qc.SETPOINT_DIR / "recommendations_monthly.csv")
    baseline = pd.read_csv(qc.BASELINE_DIR / "summary_metrics.csv")
    preds = pd.concat(
        pd.read_csv(qc.BASELINE_DIR / f"floor{f}" / "predictions_occupied_hours.csv",
                    parse_dates=["timestamp"],
                    usecols=["timestamp", "zone", "split", "ac_kw", "pred_chosen"]).assign(floor=f)
        for f in qc.FLOORS if (qc.BASELINE_DIR / f"floor{f}" / "predictions_occupied_hours.csv").exists())

    days = pmv.groupby(pmv["timestamp"].dt.date)["zone"].count()
    office_days = [d.isoformat() for d, n in days.items() if n >= 200]   # most zones reporting
    return Store(
        pmv=pmv, heatmap=heatmap, inspection=inspection, slopes=slopes, monthly=monthly, preds=preds,
        registry=_zone_registry(zone_summary, slopes, inspection, baseline),
        months=sorted(pmv["month"].unique()), office_days=office_days)


def records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list of dicts (NaN -> None)."""
    return df.replace({np.nan: None}).to_dict(orient="records")

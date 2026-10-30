"""Loads Question A and Question B outputs once for the building view.

Question B reads the CSVs written by notebooks/qn2. Question A combines its audit summary with
hourly circuit readings and tariff periods to provide month-specific energy and cost opportunities.
The what-if logic lives in sim.py and the frontend.
"""
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

QN2_DIR = Path(__file__).resolve().parents[2] / "notebooks" / "qn2"
QA_PATH = Path(__file__).resolve().parents[2] / "data" / "qn1_circuit_waste_and_classification.csv"
QA_HOURLY_PATH = Path(__file__).resolve().parents[2] / "data" / "qn1_hourly_master_for_excel.csv"
QA_HOLIDAYS_PATH = Path(__file__).resolve().parents[2] / "data" / "thai_holidays_18months.csv"
QA_DYNAMIC_PATH = Path(__file__).resolve().parents[2] / "data" / "qn1_dynamic_baseload_matrix.csv"
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
    energy_audit: list[dict]
    afterhours_timing: dict[str, list[dict]]
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


def _energy_audit() -> list[dict]:
    """Normalize Question A circuits and calculate observed monthly opportunities."""
    circuits = pd.read_csv(QA_PATH)
    hourly = pd.read_csv(QA_HOURLY_PATH, parse_dates=["Date"])
    hourly["month"] = hourly["Date"].dt.strftime("%Y-%m")
    hourly["dow"] = hourly["Date"].dt.dayofweek
    hourly["hr"] = hourly["Date"].dt.hour
    holidays = set(pd.to_datetime(pd.read_csv(QA_HOLIDAYS_PATH)["Date"]).dt.date)
    dates = hourly["Date"]
    is_wkday = (dates.dt.dayofweek < 5) & (~dates.dt.date.isin(holidays))
    hourly["is_peak"] = is_wkday & (dates.dt.hour >= 9) & (dates.dt.hour < 22)
    hourly["tariff_thb_per_kwh"] = np.where(hourly["is_peak"], 4.3297, 2.5849)
    circuits["floor"] = circuits["Floor"].astype(str).str.extract(r"(\d+)", expand=False).astype(int)
    circuits["zone"] = circuits["Zone_Col"].astype(str).str.extract(r"^(z\d+)_", expand=False)
    circuits = circuits.dropna(subset=["zone"])
    hourly_by_month = list(hourly.groupby("month", sort=True))
    annual_months = {f"{year}-{month:02d}" for year, month in [(2018, m) for m in range(7, 13)] + [(2019, m) for m in range(1, 7)]}

    dynamic_matrix = (
        pd.read_csv(QA_DYNAMIC_PATH).set_index(["DayOfWeek", "Hour"])
        if QA_DYNAMIC_PATH.exists()
        else None
    )
    dyn_dict = (
        {col: dynamic_matrix[col].to_dict() for col in dynamic_matrix.columns}
        if dynamic_matrix is not None
        else {}
    )

    grouped = []
    for (floor, zone), rows in circuits.groupby(["floor", "zone"], sort=True):
        items = []
        for row in rows.itertuples():
            is_preventable = row.Classification == "Preventable Waste"
            c_dict = dyn_dict.get(row.Circuit_ID, {})
            month_values = {}
            for month, frame in hourly_by_month:
                unoccupied = frame.loc[frame["Is_Unoccupied"], row.Circuit_ID]
                observed = unoccupied.dropna()
                if is_preventable and c_dict:
                    sub_frame = frame.loc[observed.index]
                    base_vals = [c_dict.get((d, h), float(row.Baseload_kW)) for d, h in zip(sub_frame["dow"], sub_frame["hr"])]
                    excess = pd.Series((observed.values - np.array(base_vals)).clip(min=0.0), index=observed.index)
                elif is_preventable:
                    excess = (observed - float(row.Baseload_kW)).clip(lower=0)
                else:
                    excess = observed.iloc[0:0]
                monthly_kwh = float(excess.sum())  # each row is one hour of mean kW
                monthly_cost = float((excess * frame.loc[excess.index, "tariff_thb_per_kwh"]).sum())
                monthly_mean = observed.mean()
                month_values[month] = {
                    "surplus_kwh": round(monthly_kwh, 2) if len(observed) else None,
                    "cost_thb": round(monthly_cost, 2) if len(observed) else None,
                    "unocc_mean_kw": round(float(monthly_mean), 3) if pd.notna(monthly_mean) else None,
                    "unocc_hours": int(len(observed)),
                    "expected_unocc_hours": int(len(unoccupied)),
                }
            annual_periods = [month_values[m] for m in sorted(annual_months) if m in month_values]
            annual_hours = sum(period["unocc_hours"] for period in annual_periods)
            annual_expected_hours = sum(period["expected_unocc_hours"] for period in annual_periods)
            annual_surplus = sum(period["surplus_kwh"] or 0 for period in annual_periods)
            annual_cost = sum(period["cost_thb"] or 0 for period in annual_periods)
            annual_load_kwh = sum((period["unocc_mean_kw"] or 0) * period["unocc_hours"] for period in annual_periods)
            unocc_mean = round(annual_load_kwh / annual_hours, 3) if annual_hours else 0.0

            cid = str(row.Circuit_ID)
            ratio = round(float(getattr(row, "Unocc_to_Occ_Ratio", 0.0)), 2)
            cv = round(float(getattr(row, "OffHours_CV", 0.0)), 2)

            items.append({
                "circuit_id": cid,
                "type": str(row.Type),
                "classification": str(row.Classification),
                "unocc_to_occ_ratio": ratio,
                "offhours_cv": cv,
                "unocc_mean_kw": unocc_mean if annual_hours else None,
                "annual_unocc_hours": annual_hours,
                "annual_expected_unocc_hours": annual_expected_hours,
                "baseload_kw": float(row.Baseload_kW),
                "annual_surplus_kwh": round(annual_surplus, 2),
                "annual_cost_thb": round(annual_cost, 2),
                "monthly": month_values,
            })
        preventable = [item for item in items if item["classification"] == "Preventable Waste"]
        critical = [item for item in items if item["classification"] == "Critical Standby"]
        label = "Mixed" if preventable and critical else "Preventable Waste" if preventable else "Critical Standby"
        months = sorted({month for item in items for month in item["monthly"]})
        monthly = {}
        for month in months:
            periods = [item["monthly"][month] for item in items]
            preventable_periods = [item["monthly"][month] for item in preventable]
            total_expected = sum(p["expected_unocc_hours"] for p in periods)
            total_observed = sum(p["unocc_hours"] for p in periods)
            energy_expected = sum(p["expected_unocc_hours"] for p in preventable_periods)
            energy_observed = sum(p["unocc_hours"] for p in preventable_periods)
            load_values = [p["unocc_mean_kw"] for p in periods if p["unocc_mean_kw"] is not None]
            load = sum(load_values) if load_values else None
            monthly[month] = {
                "surplus_kwh": round(sum(p["surplus_kwh"] or 0 for p in preventable_periods), 2) if not preventable or energy_observed else None,
                "cost_thb": round(sum(p["cost_thb"] or 0 for p in preventable_periods), 2) if not preventable or energy_observed else None,
                "unocc_mean_kw": round(load, 3) if load is not None else None,
                "unocc_hours": total_observed,
                "expected_unocc_hours": total_expected,
                "energy_coverage_pct": round(100 * energy_observed / energy_expected, 1) if energy_expected else 100.0,
                "load_coverage_pct": round(100 * total_observed / total_expected, 1) if total_expected else 100.0,
            }
        grouped.append({
            "id": f"F{floor}:{zone}", "floor": int(floor), "zone": str(zone),
            "classification": label,
            "circuit_count": len(items),
            "preventable_count": len(preventable),
            "critical_count": len(critical),
            "annual_surplus_kwh": round(sum(item["annual_surplus_kwh"] for item in preventable), 2),
            "annual_cost_thb": round(sum(item["annual_cost_thb"] for item in preventable), 2),
            "unocc_mean_kw": round(sum(item["unocc_mean_kw"] or 0 for item in items), 3) if any(item["unocc_mean_kw"] is not None for item in items) else None,
            "annual_unocc_hours": sum(item["annual_unocc_hours"] for item in items),
            "annual_expected_unocc_hours": sum(item["annual_expected_unocc_hours"] for item in items),
            "annual_energy_coverage_pct": round(100 * sum(item["annual_unocc_hours"] for item in preventable) / sum(item["annual_expected_unocc_hours"] for item in preventable), 1) if preventable and sum(item["annual_expected_unocc_hours"] for item in preventable) else 100.0,
            "annual_load_coverage_pct": round(100 * sum(item["annual_unocc_hours"] for item in items) / max(sum(item["annual_expected_unocc_hours"] for item in items), 1), 1),
            "monthly": monthly,
            "circuits": items,
        })
    return grouped


def _afterhours_timing() -> dict[str, list[dict]]:
    """Estimate preventable savings at weekday shutdown times from 17:00 through 06:00."""
    circuits = pd.read_csv(QA_PATH)
    hourly = pd.read_csv(QA_HOURLY_PATH, parse_dates=["Date"])
    dynamic = pd.read_csv(QA_DYNAMIC_PATH).set_index(["DayOfWeek", "Hour"])
    dynamic = {col: dynamic[col].to_dict() for col in dynamic.columns}
    circuits["floor"] = circuits["Floor"].astype(str).str.extract(r"(\d+)", expand=False).astype(int)
    circuits["zone"] = circuits["Zone_Col"].astype(str).str.extract(r"^(z\d+)_", expand=False)
    circuits = circuits[circuits["zone"].notna()]
    annual_months = {f"{year}-{month:02d}" for year, months in [(2018, range(7, 13)), (2019, range(1, 7))] for month in months}
    hourly["month"] = hourly["Date"].dt.strftime("%Y-%m")
    hourly["dow"] = hourly["Date"].dt.dayofweek
    hourly["hr"] = hourly["Date"].dt.hour
    workdays = hourly.assign(_date=hourly["Date"].dt.date).groupby("_date")["Is_Occupied"].max().to_dict()
    is_workday = hourly["Date"].dt.date.map(workdays).to_numpy(dtype=bool)
    is_unoccupied = hourly["Is_Unoccupied"].to_numpy(dtype=bool)
    hours = hourly["hr"].to_numpy()
    months = hourly["month"].to_numpy()
    dates = hourly["Date"]
    holidays = set(pd.to_datetime(pd.read_csv(QA_HOLIDAYS_PATH)["Date"]).dt.date)
    peak = ((dates.dt.dayofweek.to_numpy() < 5) & (~dates.dt.date.isin(holidays))
            & (hours >= 9) & (hours < 22))
    rates = np.where(peak, 4.3297, 2.5849)
    circuit_loads = []
    for row in circuits.itertuples():
        column = str(row.Circuit_ID)
        if column not in hourly:
            continue
        observed = hourly[column].to_numpy(dtype=float)
        if row.Classification == "Preventable Waste":
            bases = np.array([dynamic.get(column, {}).get((int(d), int(h)), float(row.Baseload_kW))
                              for d, h in zip(hourly["dow"], hours)])
            excess = np.where(np.isfinite(observed), np.maximum(observed - bases, 0), 0)
        else:
            excess = np.zeros_like(observed)
        circuit_loads.append((int(row.floor), str(row.zone), column, row.Classification == "Preventable Waste", observed, excess))

    result: dict[str, list[dict]] = {"building": []}
    for floor, zone_count in ZONES_PER_FLOOR.items():
        result[f"F{floor}"] = []
        for zone_number in range(1, zone_count + 1):
            result[f"F{floor}:z{zone_number}"] = []
    for item in circuit_loads:
        result[f"circuit:{item[2]}"] = []

    combinations = []
    # start_hour: 17 to 23; end_hour: 5 to 8
    for s_hr in range(17, 24):
        for e_hr in range(5, 9):
            combinations.append((s_hr, e_hr, s_hr))
    # Legacy cutoffs 24..30 with end_hour = 8
    for c_hr in range(24, 31):
        combinations.append((c_hr, 8, c_hr))

    for start_hour, end_hour, cutoff_hour in combinations:
        if start_hour < 24:
            weekday_schedule = (hours >= start_hour) | (hours < end_hour)
        else:
            # Cutoffs 24–30 mean midnight through 06:00 on the following day.
            weekday_schedule = (hours >= start_hour - 24) & (hours < end_hour)
        selected = is_unoccupied & (~is_workday | weekday_schedule)
        monthly_totals: dict[str, dict[str, list[float]]] = {
            key: {month: [0.0, 0.0, 0.0, 0.0, 0.0] for month in sorted(set(months))} for key in result
        }
        annual_totals: dict[str, list[float]] = {key: [0.0, 0.0, 0.0, 0.0, 0.0] for key in result}
        for floor, zone, circuit_id, preventable, observed, excess in circuit_loads:
            scopes = ("building", f"F{floor}", f"F{floor}:{zone}", f"circuit:{circuit_id}")
            for month in monthly_totals["building"]:
                month_mask = months == month
                observed_mask = is_unoccupied & month_mask & np.isfinite(observed)
                hours_count = int(observed_mask.sum())
                current_kw = float(observed[observed_mask].sum()) / hours_count if hours_count else 0.0
                saved_mask = selected & month_mask & np.isfinite(observed)
                energy = float(excess[saved_mask].sum())
                cost = float((excess[saved_mask] * rates[saved_mask]).sum())
                projected_kw = current_kw - energy / hours_count if hours_count else 0.0
                for scope in scopes:
                    totals = monthly_totals[scope][month]
                    totals[0] += energy
                    totals[1] += cost
                    totals[2] += current_kw
                    totals[3] += projected_kw
                    totals[4] += current_kw if preventable else 0.0
            annual_mask = np.isin(months, list(annual_months))
            observed_mask = is_unoccupied & annual_mask & np.isfinite(observed)
            hours_count = int(observed_mask.sum())
            current_kw = float(observed[observed_mask].sum()) / hours_count if hours_count else 0.0
            saved_mask = selected & annual_mask & np.isfinite(observed)
            energy = float(excess[saved_mask].sum())
            cost = float((excess[saved_mask] * rates[saved_mask]).sum())
            projected_kw = current_kw - energy / hours_count if hours_count else 0.0
            for scope in scopes:
                totals = annual_totals[scope]
                totals[0] += energy
                totals[1] += cost
                totals[2] += current_kw
                totals[3] += projected_kw
                totals[4] += current_kw if preventable else 0.0
        for scope, by_month in monthly_totals.items():
            annual = annual_totals[scope]
            result[scope].append({
                "cutoff_hour": cutoff_hour,
                "start_hour": start_hour if start_hour < 24 else start_hour - 24,
                "end_hour": end_hour,
                "annual_kwh": round(annual[0], 2),
                "annual_cost_thb": round(annual[1], 2),
                "annual_load_kw": round(annual[2], 3),
                "annual_projected_load_kw": round(annual[3], 3),
                "annual_preventable_load_kw": round(annual[4], 3),
                "monthly": {m: {"kwh": round(v[0], 2), "cost_thb": round(v[1], 2),
                                "load_kw": round(v[2], 3), "projected_load_kw": round(v[3], 3),
                                "preventable_load_kw": round(v[4], 3)} for m, v in by_month.items()},
            })
    return result


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
        energy_audit=_energy_audit(),
        afterhours_timing=_afterhours_timing(),
        months=sorted(pmv["month"].unique()), office_days=office_days)


def records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list of dicts (NaN -> None)."""
    return df.replace({np.nan: None}).to_dict(orient="records")

"""Shared helpers for the Question B notebooks and the Streamlit dashboard.

Paths, the PMV/PPD comfort model, humidity conversions and data loading live here so the
notebooks and the app compute exactly the same numbers.
"""
from pathlib import Path

import numpy as np
import pandas as pd

# --- Folders (resolved from this file, so they work from notebooks and from the app) ---
QNS2_DIR = (Path(__file__).resolve().parent / ".." / ".." / "data" / "qns2").resolve()
PROCESSED_DIR = QNS2_DIR / "processed"      # output of cubems_prepare
BASELINE_DIR = QNS2_DIR / "baseline"        # output of qb_baseline_model
COMFORT_DIR = QNS2_DIR / "comfort"          # output of qb_comfort_pmv
SETPOINT_DIR = QNS2_DIR / "setpoint"        # output of qb_energy_per_degree and qb_setpoint_sim

FLOORS = [2, 3, 4, 5, 6, 7]                 # floors with zone temperature and humidity sensors

# --- Comfort assumptions (proposal, Assumptions slide) ------------------------------------
CLO = 0.61          # trousers and long-sleeve shirt
MET = 1.1           # seated, typing
AIR_SPEED = 0.1     # m/s, no local air-speed control or measurement
# Mean radiant temperature = air temperature (only air temperature is measured).
PMV_LOW, PMV_HIGH = -0.5, 0.5               # comfort band; below = too cool, above = too warm
RH_LIMIT = 65.0                             # % RH, the "too humid" guardrail
PRESSURE_KPA = 101.325

BOOL_COLS = ["is_occupied", "is_holiday", "is_workday", "day_after_holiday", "is_weekend"]


# --- PMV / PPD (ISO 7730:2005, Annex D algorithm) ----------------------------------------
def pmv_ppd(ta, tr, rh, vel=AIR_SPEED, met=MET, clo=CLO, wme=0.0, max_iter=150):
    """Predicted Mean Vote and Predicted Percentage Dissatisfied, vectorised.

    ta, tr: air and mean radiant temperature (°C); rh: relative humidity (%);
    vel: air speed (m/s); met: metabolic rate (met); clo: clothing insulation (clo).
    Returns (pmv, ppd) as numpy arrays; NaN where any input is missing.
    """
    ta, tr, rh, vel, met, clo = np.broadcast_arrays(*(np.asarray(x, dtype=float)
                                                      for x in (ta, tr, rh, vel, met, clo)))
    pa = rh * 10 * np.exp(16.6536 - 4030.183 / (ta + 235))      # water vapour pressure, Pa
    icl = 0.155 * clo                                           # clothing insulation, m2K/W
    m, w = met * 58.15, wme * 58.15
    mw = m - w
    fcl = np.where(icl <= 0.078, 1 + 1.29 * icl, 1.05 + 0.645 * icl)
    hcf = 12.1 * np.sqrt(vel)
    taa, tra = ta + 273, tr + 273

    # Iterate for the clothing surface temperature.
    tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1)
    p1 = icl * fcl
    p2, p3, p4 = p1 * 3.96, p1 * 100, p1 * taa
    p5 = 308.7 - 0.028 * mw + p2 * (tra / 100) ** 4
    xn, xf = tcla / 100, tcla / 50
    for _ in range(max_iter):
        xf = (xf + xn) / 2
        hcn = 2.38 * np.abs(100 * xf - taa) ** 0.25
        hc = np.maximum(hcf, hcn)
        xn = (p5 + p4 * hc - p2 * xf ** 4) / (100 + p3 * hc)
        if np.nanmax(np.abs(xn - xf), initial=0) < 0.00015:
            break
    tcl = 100 * xn - 273

    hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa)                # skin diffusion
    hl2 = np.where(mw > 58.15, 0.42 * (mw - 58.15), 0.0)        # sweating
    hl3 = 1.7e-5 * m * (5867 - pa)                              # latent respiration
    hl4 = 0.0014 * m * (34 - ta)                                # dry respiration
    hl5 = 3.96 * fcl * (xn ** 4 - (tra / 100) ** 4)             # radiation
    hl6 = fcl * hc * (tcl - ta)                                 # convection
    ts = 0.303 * np.exp(-0.036 * m) + 0.028
    pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6)
    ppd = 100 - 95 * np.exp(-0.03353 * pmv ** 4 - 0.2179 * pmv ** 2)
    return pmv, ppd


def comfort_class(pmv) -> np.ndarray:
    pmv = np.asarray(pmv, dtype=float)
    return np.select([pmv < PMV_LOW, pmv > PMV_HIGH], ["too cool", "too warm"], "comfortable")


# --- Humidity -----------------------------------------------------------------------------
def saturation_pressure_kpa(temp_c):
    """Same Magnus formula as cubems_prepare.humidity_ratio."""
    return 0.61094 * np.exp(17.625 * np.asarray(temp_c, float) / (np.asarray(temp_c, float) + 243.04))


def humidity_ratio(temp_c, rh_pct, pressure_kpa=PRESSURE_KPA):
    """kg water / kg dry air."""
    p_w = np.asarray(rh_pct, float) / 100.0 * saturation_pressure_kpa(temp_c)
    return 0.622 * p_w / (pressure_kpa - p_w)


def rh_from_humidity_ratio(temp_c, w, pressure_kpa=PRESSURE_KPA):
    """Relative humidity (%) of air with humidity ratio w at temperature temp_c."""
    w = np.asarray(w, float)
    p_w = w * pressure_kpa / (0.622 + w)
    return np.clip(p_w / saturation_pressure_kpa(temp_c) * 100.0, 0, 100)


def warmed_rh(temp_c, rh_pct, delta_c):
    """RH after warming the air by delta_c with the same moisture content (it falls)."""
    return rh_from_humidity_ratio(np.asarray(temp_c, float) + delta_c, humidity_ratio(temp_c, rh_pct))


# --- Data loading ---------------------------------------------------------------------------
def load_table(floor: int, res: str = "hourly") -> pd.DataFrame:
    """Clean table from cubems_prepare; res is 'hourly' or '15min'."""
    path = PROCESSED_DIR / f"clean_{res}" / f"floor{floor}_{res}.csv"
    df = pd.read_csv(path, parse_dates=["timestamp"], index_col="timestamp")
    for col in BOOL_COLS:
        if col in df:
            df[col] = df[col].astype(str).str.lower().isin(["true", "1"])
    return df.sort_index()


def sensor_zones(df: pd.DataFrame) -> list[str]:
    """Zones with both a temperature and a humidity sensor."""
    zones = [c[:-len("_temp_c")] for c in df.columns if c.endswith("_temp_c") and not c.startswith("out_")]
    return sorted((z for z in zones if f"{z}_rh_pct" in df), key=lambda z: int(z[1:]))


def ac_zones(df: pd.DataFrame) -> list[str]:
    return sorted((c[:-len("_ac_total_kw")] for c in df.columns if c.endswith("_ac_total_kw")),
                  key=lambda z: int(z[1:]))


# --- Setpoint simulation and rule-based system ---------------------------------------------
PERIOD_HOURS = 0.25                 # 15-min periods
OFFICE_PERIODS_PER_YEAR = 7776      # office 15-min periods in 2019 (is_occupied count, qb_setpoint_sim);
                                    #   used to annualise savings from the months with sensor data
RAISE_STEP_C = 1.0                  # the rule raises in 1 °C steps ...
MAX_RAISE_C = 3.0                   #   ... up to this much above today's temperature
RAISE_IF_TOO_COOL_SHARE = 0.25      # raise again while > 25 % of periods are still too cool
TOO_WARM_TOLERANCE = 0.10           # roll back if > 10 % of periods would be too warm
HUMID_TOLERANCE = 0.10              # roll back if the share above RH_LIMIT would exceed
                                    #   max(10 %, today's share)


def simulate_setpoint(temp_c, rh_pct, ac_kw, delta_c, kw_per_c, dw_g_per_c=0.0) -> pd.DataFrame:
    """Effect of running a zone delta_c warmer, one row per 15-min period.

    Assumes the zone air temperature follows the setpoint. Moisture: the humidity ratio rises by
    dw_g_per_c (g/kg per °C, estimated from the data) because the AC removes less moisture;
    with 0 it stays constant and RH simply falls as the air warms.
    AC saved = kw_per_c * delta_c, never more than the AC actually used in that period.
    """
    index = temp_c.index if isinstance(temp_c, pd.Series) else None
    t = np.asarray(temp_c, float)
    new_t = t + delta_c
    w = humidity_ratio(t, rh_pct) + dw_g_per_c / 1000.0 * delta_c
    new_rh = rh_from_humidity_ratio(new_t, w)
    pmv, ppd = pmv_ppd(new_t, new_t, new_rh)
    ac = np.nan_to_num(np.asarray(ac_kw, float), nan=0.0)
    saved = np.minimum(max(kw_per_c * delta_c, 0.0), ac)
    return pd.DataFrame({"temp_c": new_t, "rh_pct": new_rh, "pmv": pmv, "ppd": ppd,
                         "comfort": comfort_class(pmv), "humid": new_rh > RH_LIMIT,
                         "ac_kw": ac, "saved_kw": saved}, index=index)


def summarise_sim(sim: pd.DataFrame) -> dict:
    ac_kwh = sim["ac_kw"].sum() * PERIOD_HOURS
    saved_kwh = sim["saved_kw"].sum() * PERIOD_HOURS
    out = {
        "pct_too_cool": round((sim["comfort"] == "too cool").mean() * 100, 1),
        "pct_comfortable": round((sim["comfort"] == "comfortable").mean() * 100, 1),
        "pct_too_warm": round((sim["comfort"] == "too warm").mean() * 100, 1),
        "pct_humid": round(sim["humid"].mean() * 100, 1),
        "mean_temp_c": round(sim["temp_c"].mean(), 2),
        "mean_rh_pct": round(sim["rh_pct"].mean(), 1),
        "mean_pmv": round(sim["pmv"].mean(), 2),
        "ac_kwh": round(ac_kwh, 1),
        "saved_kwh": round(saved_kwh, 1),
        "pct_ac_saved": round(saved_kwh / ac_kwh * 100, 1) if ac_kwh else 0.0,
    }
    return {"periods": len(sim), **{k: float(v) for k, v in out.items()}}


def recommend_raise(temp_c, rh_pct, ac_kw, kw_per_c, dw_g_per_c=0.0) -> tuple[float, str]:
    """Rule-based setpoint: raise 1 °C at a time while the zone is still too cool; roll the
    last step back if it would make the zone too warm or too humid. Returns (raise, reason)."""
    today = simulate_setpoint(temp_c, rh_pct, ac_kw, 0.0, kw_per_c, dw_g_per_c)
    humid_limit = max(HUMID_TOLERANCE, today["humid"].mean())
    delta, current = 0.0, today
    while True:
        if (current["comfort"] == "too cool").mean() <= RAISE_IF_TOO_COOL_SHARE:
            return delta, "comfortable enough"
        if delta + RAISE_STEP_C > MAX_RAISE_C:
            return delta, f"reached +{MAX_RAISE_C:g} °C cap"
        trial = simulate_setpoint(temp_c, rh_pct, ac_kw, delta + RAISE_STEP_C, kw_per_c, dw_g_per_c)
        if (trial["comfort"] == "too warm").mean() > TOO_WARM_TOLERANCE:
            return delta, "next step too warm (rolled back)"
        if trial["humid"].mean() > humid_limit:
            return delta, "next step too humid (rolled back)"
        delta, current = delta + RAISE_STEP_C, trial

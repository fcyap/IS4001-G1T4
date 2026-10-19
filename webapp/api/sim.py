"""What-if setpoint simulation over every sensor zone at once.

Same physics as qb_common.simulate_setpoint (zone air follows the setpoint, humidity ratio rises
by the zone's g/kg-per-°C slope, AC saved = kW-per-°C x raise capped at the AC in use), but
vectorised over all 15-min rows with a per-row change so the whole building updates in one pass.

The change can also be negative (a lower setpoint): the zone air cools, the coil removes more
moisture, and the AC uses kW-per-°C more per degree, capped at the zone's highest metered AC
power (its observed capacity). The slopes were fitted on raises of a few degrees, so large
changes in either direction are extrapolations.
"""
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .data import Store, qc

MIN_PERIODS_PER_MONTH = 160         # as in qb_setpoint_sim: about 5 office days for a recommendation


@dataclass(frozen=True)
class Scenario:
    mode: str = "global"            # "global": same change everywhere; "rule": monthly rule recommendation
    global_c: float = 0.0           # °C, negative = lower the setpoint
    overrides: tuple = ()           # (("F4:z2", 2.0), ...) per-zone change, wins over the mode

    @classmethod
    def build(cls, mode: str, global_c: float, overrides: dict[str, float] | None):
        return cls(mode, float(global_c), tuple(sorted((overrides or {}).items())))


def _summary(cool, comf, warm, humid, temp, rh, pmv, ac_kw, saved_kw) -> dict:
    n = len(cool)
    if n == 0:
        return {"periods": 0}
    ac_kwh = float(ac_kw.sum() * qc.PERIOD_HOURS)
    saved_kwh = float(saved_kw.sum() * qc.PERIOD_HOURS)
    return {
        "periods": int(n),
        "n_too_cool": int(cool.sum()), "n_comfortable": int(comf.sum()),
        "n_too_warm": int(warm.sum()), "n_humid": int(humid.sum()),
        "pct_too_cool": round(cool.mean() * 100, 1), "pct_comfortable": round(comf.mean() * 100, 1),
        "pct_too_warm": round(warm.mean() * 100, 1), "pct_humid": round(humid.mean() * 100, 1),
        "mean_temp_c": round(float(np.nanmean(temp)), 2), "mean_rh_pct": round(float(np.nanmean(rh)), 1),
        "mean_pmv": round(float(np.nanmean(pmv)), 2),
        "ac_kwh": round(ac_kwh, 1), "saved_kwh": round(saved_kwh, 1),
        "pct_ac_saved": round(saved_kwh / ac_kwh * 100, 1) if ac_kwh else 0.0,
    }


class Simulator:
    def __init__(self, store: Store, cache_size: int = 32):
        self.store = store
        p = store.pmv
        slopes = store.slopes.set_index(["floor", "zone"])
        key = list(zip(p["floor"], p["zone"]))
        self.zone_id = np.array([f"F{f}:{z}" for f, z in key])
        self.month = p["month"].to_numpy()
        self.date = p["timestamp"].dt.date.astype(str).to_numpy()
        self.time = p["timestamp"].dt.strftime("%H:%M").to_numpy()
        self.temp = p["temp_c"].to_numpy(float)
        self.rh = p["rh_pct"].to_numpy(float)
        self.ac = np.nan_to_num(p["ac_kw"].to_numpy(float), nan=0.0)
        # Highest AC power ever metered in the zone: the most a lower setpoint can draw.
        self.ac_cap = pd.Series(self.ac).groupby(self.zone_id).transform("max").to_numpy()
        self.out_temp = p["out_temp_c"].to_numpy(float)
        per_zone = {(f, z): (r.saving_kw_per_c, r.moisture_g_per_kg_per_c) for (f, z), r in slopes.iterrows()}
        self.kw_per_c = np.array([per_zone.get(k, (0.0, 0.0))[0] for k in key])
        self.dw = np.array([per_zone.get(k, (0.0, 0.0))[1] for k in key])
        self.simulated = np.array([k in per_zone for k in key])
        inspect = {f"F{r.floor}:{r.zone}" for r in store.inspection.itertuples()}
        self.inspect = np.isin(self.zone_id, list(inspect))
        self.w0 = qc.humidity_ratio(self.temp, self.rh)
        self._pmv0 = p["pmv"].to_numpy(float)              # today's PMV, from qb_comfort_pmv
        self.before = self._state(np.zeros(len(p)))
        rule = store.monthly.assign(zid="F" + store.monthly["floor"].astype(str) + ":" + store.monthly["zone"])
        self.rule_raise = dict(zip(zip(rule["zid"], rule["month"]), rule["recommended_raise_c"]))
        self._cache: OrderedDict[Scenario, dict] = OrderedDict()
        self._cache_size = cache_size

    # --- per-row physics ------------------------------------------------------------------
    def _state(self, delta: np.ndarray) -> dict:
        t = self.temp + delta
        w = np.maximum(self.w0 + self.dw / 1000.0 * delta, 0.0)
        rh = qc.rh_from_humidity_ratio(t, w)
        pmv = self._pmv0.copy()                           # only recompute rows whose setpoint changed
        ok = (delta != 0) & ~np.isnan(t) & ~np.isnan(rh)
        if ok.any():
            pmv[ok] = qc.pmv_ppd(t[ok], t[ok], rh[ok])[0]
        # Raise: save up to the AC in use. Lower: negative saving, up to the zone's capacity.
        saved = np.clip(self.kw_per_c * delta, -(self.ac_cap - self.ac), self.ac)
        return {"delta": delta, "temp": t, "rh": rh, "pmv": pmv,
                "cool": pmv < qc.PMV_LOW, "warm": pmv > qc.PMV_HIGH,
                "comf": (pmv >= qc.PMV_LOW) & (pmv <= qc.PMV_HIGH),
                "humid": rh > qc.RH_LIMIT, "saved": saved}

    def _delta(self, sc: Scenario) -> np.ndarray:
        if sc.mode == "rule":
            delta = np.array([self.rule_raise.get(k, 0.0) for k in zip(self.zone_id, self.month)])
        else:
            delta = np.where(self.inspect, 0.0, sc.global_c)
        for zid, c in sc.overrides:
            delta[self.zone_id == zid] = float(c)
        return np.where(self.simulated, delta, 0.0)       # no AC slope -> nothing to adjust

    def after(self, sc: Scenario) -> dict:
        if sc in self._cache:
            self._cache.move_to_end(sc)
            return self._cache[sc]
        state = self._state(self._delta(sc))
        self._cache[sc] = state
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return state

    # --- views ------------------------------------------------------------------------------
    def _summ(self, s: dict, m: np.ndarray) -> dict:
        return _summary(s["cool"][m], s["comf"][m], s["warm"][m], s["humid"][m], s["temp"][m],
                        s["rh"][m], s["pmv"][m], self.ac[m], s["saved"][m])

    def _guardrail(self, a: dict, b: dict, m: np.ndarray) -> tuple[list[str], list[str]]:
        """The rule's comfort guardrail, checked month by month as recommend_raise does: a raised
        zone-month fails if > 10 % of it is too warm, or more of it is humid than max(10 %, today).
        A lowered zone-month fails if more of it is too cool than both today and the share that
        makes the rule raise the setpoint (25 %). Months with too few periods for a
        recommendation (qb_setpoint_sim) are skipped."""
        kinds, months = set(), []
        for month in np.unique(self.month[m]):
            mm = m & (self.month == month)
            if mm.sum() < MIN_PERIODS_PER_MONTH:
                continue
            bad = []
            if b["delta"][mm].max() > 0:
                if b["warm"][mm].mean() > qc.TOO_WARM_TOLERANCE:
                    bad.append("too warm")
                if b["humid"][mm].mean() > max(qc.HUMID_TOLERANCE, a["humid"][mm].mean()):
                    bad.append("too humid")
            if b["delta"][mm].min() < 0 and \
                    b["cool"][mm].mean() > max(qc.RAISE_IF_TOO_COOL_SHARE, a["cool"][mm].mean()):
                bad.append("too cool")
            if bad:
                kinds.update(bad)
                months.append(month)
        return sorted(kinds, reverse=True), months

    def whatif(self, sc: Scenario, months: list[str] | None) -> dict:
        a, b = self.before, self.after(sc)
        base = np.isin(self.month, months) if months else np.ones(len(self.month), bool)
        zones = []
        for zid in pd.unique(self.zone_id):
            m = base & (self.zone_id == zid)
            if not m.any():
                continue
            before, after = self._summ(a, m), self._summ(b, m)
            d = b["delta"][m]
            breach, breach_months = self._guardrail(a, b, m)
            after["annual_kwh_saved"] = round(after["saved_kwh"] / after["periods"] * qc.OFFICE_PERIODS_PER_YEAR, 0)
            zones.append({
                "id": zid, "raise_c": round(float(d.mean()), 2), "raise_max": float(d.max()),
                "raise_min": float(d.min()),
                "mean_out_temp_c": round(float(np.nanmean(self.out_temp[m])), 2),
                "before": before, "after": after, "breach": breach, "breach_months": breach_months})
        return {"zones": zones}

    def zone_detail(self, zid: str, sc: Scenario, months: list[str] | None) -> dict:
        a, b = self.before, self.after(sc)
        m = self.zone_id == zid
        if months:
            m &= np.isin(self.month, months)
        pmv_bins = np.round(np.arange(-3.0, 2.01, 0.1), 2)
        rh_bins = np.arange(30, 101, 2)
        hist = lambda x, bins: np.histogram(x[~np.isnan(x)], bins=bins)[0].tolist()
        return {
            "pmv_bins": pmv_bins.tolist(), "rh_bins": rh_bins.tolist(),
            "pmv_before": hist(a["pmv"][m], pmv_bins), "pmv_after": hist(b["pmv"][m], pmv_bins),
            "rh_before": hist(a["rh"][m], rh_bins), "rh_after": hist(b["rh"][m], rh_bins),
        }

    def replay(self, date: str, sc: Scenario) -> dict:
        a, b = self.before, self.after(sc)
        m = self.date == date
        times = sorted(set(self.time[m]))
        pos = {t: i for i, t in enumerate(times)}
        out = {}
        for zid in pd.unique(self.zone_id[m]):
            zm = m & (self.zone_id == zid)
            idx = [pos[t] for t in self.time[zm]]
            series = {}
            for name, arr in [("temp_before", a["temp"]), ("temp_after", b["temp"]),
                              ("pmv_before", a["pmv"]), ("pmv_after", b["pmv"]),
                              ("rh_before", a["rh"]), ("rh_after", b["rh"]),
                              ("ac_before", self.ac), ("ac_after", self.ac - b["saved"])]:
                col = [None] * len(times)
                for i, v in zip(idx, arr[zm]):
                    col[i] = None if np.isnan(v) else round(float(v), 3)
                series[name] = col
            out[zid] = series
        out_temp = [None] * len(times)
        for t, v in zip(self.time[m], self.out_temp[m]):
            if not np.isnan(v):
                out_temp[pos[t]] = round(float(v), 1)
        return {"date": date, "times": times, "out_temp_c": out_temp, "zones": out}

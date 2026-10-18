"""Question B dashboard: comfort heat map, energy model view and setpoint simulator.

Run from the repository root:
    streamlit run notebooks/qn2/app/qb_dashboard.py

Reads the outputs of qb_baseline_model, qb_comfort_pmv, qb_energy_per_degree and qb_setpoint_sim.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # notebooks/qn2, for qb_common
import qb_common as qc
from qb_common import (BASELINE_DIR, COMFORT_DIR, SETPOINT_DIR, FLOORS, PERIOD_HOURS,
                       simulate_setpoint, summarise_sim, recommend_raise)

OLIVE, ORANGE, GREY = "#4f5b3a", "#e0a84a", "#9a9a8a"
COMFORT_COLORS = {"too cool": "#4a7fb0", "comfortable": OLIVE, "too warm": "#d0643c"}

st.set_page_config(page_title="Question B: Cooling Comfort & Efficiency", layout="wide")


# --- Data -------------------------------------------------------------------------------------
@st.cache_data
def load_outputs() -> dict:
    out = {
        "heatmap": pd.read_csv(COMFORT_DIR / "heatmap_zone_month.csv"),
        "zone_summary": pd.read_csv(COMFORT_DIR / "zone_summary.csv"),
        "inspection": pd.read_csv(COMFORT_DIR / "inspection_list.csv"),
        "pmv": pd.read_csv(COMFORT_DIR / "pmv_15min.csv", parse_dates=["timestamp"]),
        "slopes": pd.read_csv(SETPOINT_DIR / "kw_per_degC.csv"),
        "monthly": pd.read_csv(SETPOINT_DIR / "recommendations_monthly.csv"),
        "by_zone": pd.read_csv(SETPOINT_DIR / "recommendations_by_zone.csv"),
        "kpis": pd.read_csv(SETPOINT_DIR / "kpis.csv"),
        "baseline_summary": pd.read_csv(BASELINE_DIR / "summary_metrics.csv"),
        "preds": pd.concat(
            pd.read_csv(BASELINE_DIR / f"floor{f}" / "predictions_occupied_hours.csv",
                        parse_dates=["timestamp"]).assign(floor=f)
            for f in FLOORS if (BASELINE_DIR / f"floor{f}" / "predictions_occupied_hours.csv").exists()),
    }
    return out


try:
    data = load_outputs()
except FileNotFoundError as err:
    st.error(f"Missing output file: {err.filename}. Run the Question B notebooks first "
             "(qb_baseline_model, qb_comfort_pmv, qb_energy_per_degree, qb_setpoint_sim).")
    st.stop()

zone_label = lambda f, z: f"Floor {f} {z}"
inspect_keys = set(zip(data["inspection"]["floor"], data["inspection"]["zone"]))

# --- Header and KPIs ---------------------------------------------------------------------------
st.title("Question B: Cooling Comfort & Efficiency")
st.caption("Are the office floors overcooled, and how much AC energy could setpoint changes save while "
           "keeping zones within a comfort band? CU-BEMS building, Floors 2-7, office hours "
           "(workdays 08:00-17:00, excluding 12:00).")

kpis = data["kpis"].set_index("kpi")
cols = st.columns(5)
for col, (name, label, fmt, good_down) in zip(cols, [
        ("AC energy per office hour (weather-normalised)", "AC energy per office hour", "{:.0f} kWh/h", True),
        ("Too-cool hours", "Too-cool office time", "{:.1f} %", True),
        ("Comfortable hours", "Comfortable office time", "{:.1f} %", False),
        ("Too-humid hours", "Too-humid office time", "{:.1f} %", True),
        ("Peak cooling demand", "Peak cooling demand", "{:.0f} kW", True)]):
    r = kpis.loc[name]
    col.metric(label, fmt.format(r["today"]),
               delta=f"{fmt.format(r['after'])} after ({r['change_pct']:+.1f} %)",
               delta_color="inverse" if good_down else "normal")
st.caption("Each tile shows today's value, then the value after the recommended setpoint changes.")

tab_comfort, tab_energy, tab_sim = st.tabs(["Comfort heat map", "Energy model view", "Setpoint simulator"])

# --- Tab 1: comfort heat map -------------------------------------------------------------------
with tab_comfort:
    hm = data["heatmap"]
    c1, c2, c3 = st.columns([2, 3, 2])
    floors = c1.multiselect("Floors", FLOORS, default=FLOORS, key="hm_floors")
    zones_avail = sorted(hm.loc[hm["floor"].isin(floors), "zone"].unique(), key=lambda z: int(z[1:]))
    zones = c2.multiselect("Zones", zones_avail, default=zones_avail, key="hm_zones")
    measure = c3.selectbox("Show", list({"pct_too_cool": "% too cool (PMV < -0.5)",
                                    "pct_comfortable": "% comfortable (PMV within ±0.5)",
                                    "pct_too_warm": "% too warm (PMV > +0.5)",
                                    "pct_humid": "% too humid (RH > 65 %)"}.items()),
                           format_func=lambda kv: kv[1])
    sel = hm[hm["floor"].isin(floors) & hm["zone"].isin(zones)].copy()
    if sel.empty:
        st.info("Pick at least one floor and zone.")
    else:
        sel["row"] = [zone_label(f, z) for f, z in zip(sel["floor"], sel["zone"])]
        order = sorted(sel["row"].unique(), key=lambda r: (int(r.split()[1]), int(r.split()[2][1:])))
        grid = sel.pivot(index="row", columns="month", values=measure[0]).loc[order]
        scale = "YlOrBr" if measure[0] != "pct_comfortable" else "Greens"
        fig = px.imshow(grid, color_continuous_scale=scale, zmin=0, zmax=100, aspect="auto",
                        labels={"color": "%", "x": "Month", "y": ""})
        fig.update_layout(height=max(320, 26 * len(order) + 120), margin=dict(l=0, r=0, t=10, b=0))
        st.plotly_chart(fig, use_container_width=True)
        st.caption("Blank cells: sensor not working that month (no temperature mid-Sep 2018 to Feb 2019).")

    st.subheader("Zones over the whole sensor period")
    zs = data["zone_summary"]
    zs = zs[zs["floor"].isin(floors) & zs["zone"].isin(zones)]
    st.dataframe(zs[["floor", "zone", "periods", "pct_too_cool", "pct_comfortable", "pct_too_warm",
                     "pct_humid", "median_temp_c", "median_rh_pct", "mean_pmv", "inspect", "reason"]],
                 hide_index=True, use_container_width=True)
    st.subheader("Inspect before adjusting")
    st.dataframe(data["inspection"][["floor", "zone", "median_temp_c", "p5_temp_c", "coverage_pct", "reason"]],
                 hide_index=True, use_container_width=True)

# --- Tab 2: energy model view ------------------------------------------------------------------
with tab_energy:
    preds = data["preds"]
    c1, c2, c3 = st.columns([1, 1, 2])
    floor = c1.selectbox("Floor", FLOORS, index=FLOORS.index(4), key="en_floor")
    zone_opts = ["All AC zones"] + sorted(preds.loc[preds["floor"] == floor, "zone"].unique(),
                                          key=lambda z: int(z[1:]))
    zone = c2.selectbox("Zone", zone_opts, key="en_zone")
    p = preds[preds["floor"] == floor]
    if zone != "All AC zones":
        p = p[p["zone"] == zone]
    daily = (p.groupby(p["timestamp"].dt.date)[["ac_kw", "pred_chosen"]].sum()
             .rename(columns={"ac_kw": "Actual", "pred_chosen": "Baseline (weather-normalised)"}))
    daily.index = pd.to_datetime(daily.index)
    weekly = daily.resample("W").sum()
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=weekly.index, y=weekly["Actual"], name="Actual", line=dict(color=GREY)))
    fig.add_trace(go.Scatter(x=weekly.index, y=weekly["Baseline (weather-normalised)"],
                             name="Baseline model", line=dict(color=OLIVE)))
    fig.add_vrect(x0="2019-07-01", x1="2019-12-31", fillcolor=ORANGE, opacity=0.12, line_width=0,
                  annotation_text="test period", annotation_position="top left")
    fig.update_layout(height=360, yaxis_title="AC kWh per week (office hours)", margin=dict(l=0, r=0, t=30, b=0),
                      legend=dict(orientation="h", y=1.12))
    st.plotly_chart(fig, use_container_width=True)

    bs = data["baseline_summary"]
    bs_sel = bs[bs["floor"] == floor] if zone == "All AC zones" else bs[(bs["floor"] == floor) & (bs["zone"] == zone)]
    st.markdown("**Baseline accuracy, Jul-Dec 2019 test period** (ASHRAE Guideline 14: CV(RMSE) ≤ 30 %, |NMBE| ≤ 10 %)")
    st.dataframe(bs_sel, hide_index=True, use_container_width=True)
    st.caption(f"Building: {int(bs['passes_ashrae14'].sum())} of {len(bs)} zones pass on Floors 2-7.")

    st.subheader("PMV in office hours, by floor")
    pmv = data["pmv"]
    fig = px.box(pmv, x="floor", y="pmv", points=False, color_discrete_sequence=[OLIVE])
    fig.add_hrect(y0=qc.PMV_LOW, y1=qc.PMV_HIGH, fillcolor=OLIVE, opacity=0.12, line_width=0,
                  annotation_text="comfort band ±0.5", annotation_position="top right")
    fig.update_layout(height=360, xaxis_title="Floor", yaxis_title="PMV", margin=dict(l=0, r=0, t=10, b=0))
    st.plotly_chart(fig, use_container_width=True)

# --- Tab 3: setpoint simulator -----------------------------------------------------------------
with tab_sim:
    slopes = data["slopes"]
    pmv = data["pmv"]
    c1, c2, c3, c4 = st.columns([1, 1, 2, 2])
    floor = c1.selectbox("Floor", FLOORS, index=FLOORS.index(4), key="sim_floor")
    zone = c2.selectbox("Zone", sorted(slopes.loc[slopes["floor"] == floor, "zone"], key=lambda z: int(z[1:])),
                        key="sim_zone")
    z = pmv[(pmv["floor"] == floor) & (pmv["zone"] == zone)]
    months = sorted(z["month"].unique())
    pick = c3.multiselect("Months", months, default=months)
    delta = c4.select_slider("Raise setpoint by", options=[0, 1, 2, 3], value=1, format_func=lambda d: f"+{d} °C")
    z = z[z["month"].isin(pick)]
    s = slopes[(slopes["floor"] == floor) & (slopes["zone"] == zone)].iloc[0]

    if (floor, zone) in inspect_keys:
        reason = data["inspection"].set_index(["floor", "zone"]).loc[(floor, zone), "reason"]
        st.warning(f"On the inspection list: {reason}. Check the zone on site before changing its setpoint.")
    if z.empty:
        st.info("Pick at least one month.")
        st.stop()

    today = simulate_setpoint(z["temp_c"], z["rh_pct"], z["ac_kw"], 0, s["saving_kw_per_c"], s["moisture_g_per_kg_per_c"])
    new = simulate_setpoint(z["temp_c"], z["rh_pct"], z["ac_kw"], delta, s["saving_kw_per_c"], s["moisture_g_per_kg_per_c"])
    a, b = summarise_sim(today), summarise_sim(new)
    annual = b["saved_kwh"] / max(b["periods"], 1) * qc.OFFICE_PERIODS_PER_YEAR

    m = st.columns(5)
    m[0].metric("AC saved", f"{b['saved_kwh']:,.0f} kWh", f"{b['pct_ac_saved']:.1f} % of this zone's AC", delta_color="off")
    m[1].metric("Per year (annualised)", f"{annual:,.0f} kWh")
    m[2].metric("Too-cool time", f"{b['pct_too_cool']:.0f} %", f"{b['pct_too_cool'] - a['pct_too_cool']:+.0f} pts", delta_color="inverse")
    m[3].metric("Too-warm time", f"{b['pct_too_warm']:.0f} %", f"{b['pct_too_warm'] - a['pct_too_warm']:+.0f} pts", delta_color="inverse")
    m[4].metric("Mean RH", f"{b['mean_rh_pct']:.0f} %", f"{b['mean_rh_pct'] - a['mean_rh_pct']:+.1f} pts", delta_color="inverse")

    c1, c2 = st.columns(2)
    both = pd.concat([today.assign(case="Today"), new.assign(case=f"+{delta} °C")])
    fig = px.histogram(both, x="pmv", color="case", barmode="overlay", nbins=60, opacity=0.6,
                       color_discrete_map={"Today": GREY, f"+{delta} °C": ORANGE})
    fig.add_vrect(x0=qc.PMV_LOW, x1=qc.PMV_HIGH, fillcolor=OLIVE, opacity=0.12, line_width=0)
    fig.update_layout(height=320, title="PMV of office periods", xaxis_title="PMV", yaxis_title="15-min periods",
                      margin=dict(l=0, r=0, t=40, b=0), legend=dict(orientation="h", y=1.15, title=None))
    c1.plotly_chart(fig, use_container_width=True)
    fig = px.histogram(both, x="rh_pct", color="case", barmode="overlay", nbins=50, opacity=0.6,
                       color_discrete_map={"Today": GREY, f"+{delta} °C": ORANGE})
    fig.add_vline(x=qc.RH_LIMIT, line_dash="dash", line_color="#d0643c",
                  annotation_text=f"{qc.RH_LIMIT:g} % RH limit")
    fig.update_layout(height=320, title="Relative humidity of office periods", xaxis_title="RH (%)",
                      yaxis_title="15-min periods", margin=dict(l=0, r=0, t=40, b=0),
                      legend=dict(orientation="h", y=1.15, title=None))
    c2.plotly_chart(fig, use_container_width=True)

    rule_delta, rule_reason = ((0.0, "inspect before adjusting") if (floor, zone) in inspect_keys else
                               recommend_raise(z["temp_c"], z["rh_pct"], z["ac_kw"],
                                               s["saving_kw_per_c"], s["moisture_g_per_kg_per_c"]))
    st.markdown(f"**Rule-based recommendation for the selected months:** raise by **+{rule_delta:g} °C** "
                f"({rule_reason}). Rule: raise {qc.RAISE_STEP_C:g} °C while more than "
                f"{qc.RAISE_IF_TOO_COOL_SHARE:.0%} of office time is too cool; roll back if more than "
                f"{qc.TOO_WARM_TOLERANCE:.0%} would be too warm or too humid (RH > {qc.RH_LIMIT:g} %); "
                f"cap +{qc.MAX_RAISE_C:g} °C.")
    st.caption(f"This zone: {s['saving_kw_per_c']:.2f} kW saved per °C ({s['saving_pct_per_c']:.1f} % of its AC, "
               f"{s['source']} estimate); moisture +{s['moisture_g_per_kg_per_c']:.2f} g/kg per °C.")

    mz = data["monthly"]
    mz = mz[(mz["floor"] == floor) & (mz["zone"] == zone)]
    st.markdown("**Recommendation by month**")
    st.dataframe(mz[["month", "recommended_raise_c", "reason", "temp_before_c", "temp_after_c",
                     "pct_too_cool_before", "pct_too_cool_after", "pct_too_warm_after",
                     "pct_humid_after", "saved_kwh"]], hide_index=True, use_container_width=True)

    st.subheader("All zones, ranked by AC saved (rule-based recommendation)")
    st.dataframe(data["by_zone"], hide_index=True, use_container_width=True)

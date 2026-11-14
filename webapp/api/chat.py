"""Gemini AI integration for the Chamchuri 5 Building AI Copilot (bottom-right chat).

Allows Facility Managers (FMs) to ask questions about the dashboard, K-Means circuit classifications
(Critical Standby vs Preventable Waste), P2.5 dynamic baseloads, and any manual curfew/circuit
adjustments the FM has made on the dashboard.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests
from pydantic import BaseModel, Field

from .data import Store

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"

ZONE_FUNCTIONS: dict[int, list[str]] = {
    1: ["Sitting hall (Main Lobby)", "Electrical engine room", "Central stair hall", "Exterior around the building"],
    2: ["Registration and processing office", "Admin department, registration and processing office", "Central stair hall", "Procurement and finance department"],
    3: ["University resource management centre", "Finance department", "Central stair hall", "Planning and information work", "Project analysis and admin activities"],
    4: ["Infrastructure department", "Planning, design and physical systems information department", "Central stair hall", "Accounting department", "Building department"],
    5: ["Mission group, civil servants and employees", "Mission, benefits and personnel relations", "Central stair hall", "HR development department", "HR development department"],
    6: ["Office of strategy management", "Office of research administration", "Central stair hall", "Office of academic admin", "Office of academic admin"],
    7: ["Registration line inspection and procurement parcels", "Legal library and procurement organisation", "Central hall", "Office 3", "Legal and legal centre"],
}


def _zone_function(floor: int, zone: str) -> str:
    idx = int(zone.lstrip("z")) - 1
    names = ZONE_FUNCTIONS.get(floor, [])
    return names[idx] if 0 <= idx < len(names) else "Office zone"


def _load_env_key() -> str | None:
    """Read GEMINI_API_KEY from os.environ or project-root .env file."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if ROOT_ENV.is_file():
        for raw in ROOT_ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "GEMINI_API_KEY":
                val = v.strip().strip('"').strip("'")
                if val:
                    return val
    return None


def resolve_api_key(client_key: str | None = None) -> str | None:
    if client_key and client_key.strip():
        return client_key.strip()
    return _load_env_key()


class AIChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|bot)$")
    text: str


class CircuitWindowOverride(BaseModel):
    start_hour: int = Field(17, ge=17, le=23)
    end_hour: int = Field(8, ge=5, le=8)
    weekends_off: bool = True   # True: also off all day on weekends & holidays


class AIChatRequest(BaseModel):
    message: str
    history: list[AIChatMessage] = []
    floor: int | None = None
    zone: str | None = None
    month: str | None = None
    start_hour: int = Field(17, ge=17, le=23)
    end_hour: int = Field(8, ge=5, le=8)
    weekends_off: bool = True
    kept_on: list[str] = []      # circuits the FM keeps on 24/7 against a curfew recommendation
    circuit_windows: dict[str, CircuitWindowOverride] = {}
    api_key: str | None = None


def _find_timing_scenario(timing_list: list[dict], start_hour: int, end_hour: int,
                          weekends_off: bool = True) -> dict | None:
    if not timing_list:
        return None
    for row in timing_list:
        if (row.get("start_hour") == start_hour and row.get("end_hour") == end_hour
                and row.get("weekends_off", True) == weekends_off):
            return row
    for row in timing_list:
        if row.get("cutoff_hour") == start_hour:
            return row
    return timing_list[0]


def _circuit_savings_for_window(
    store: Store,
    circuit: dict[str, Any],
    month: str | None,
    start_hour: int,
    end_hour: int,
    weekends_off: bool = True,
    include_critical: bool = False,
) -> tuple[float, float]:
    # Critical Standby circuits save nothing unless the FM has chosen to put them on a curfew.
    if circuit["classification"] == "Critical Standby" and not include_critical:
        return 0.0, 0.0
    cid = circuit["circuit_id"]
    scen = _find_timing_scenario(store.afterhours_timing.get(f"circuit:{cid}", []), start_hour, end_hour, weekends_off)
    if month:
        m_scen = (scen or {}).get("monthly", {}).get(month, {})
        m_aud = circuit.get("monthly", {}).get(month, {})
        kwh_val = float(m_scen.get("kwh") if m_scen.get("kwh") is not None else (m_aud.get("surplus_kwh") or 0.0))
        thb_val = float(m_scen.get("cost_thb") if m_scen.get("cost_thb") is not None else (m_aud.get("cost_thb") or 0.0))
    else:
        kwh_val = float(scen.get("annual_kwh", circuit["annual_surplus_kwh"]) if scen else circuit["annual_surplus_kwh"])
        thb_val = float(scen.get("annual_cost_thb", circuit["annual_cost_thb"]) if scen else circuit["annual_cost_thb"])
    return kwh_val, thb_val


def _build_scope_telemetry(
    store: Store,
    floor: int | None,
    zone: str | None,
    month: str | None,
    start_hour: int,
    end_hour: int,
    kept_on: set[str],
    circuit_windows: dict[str, CircuitWindowOverride],
    weekends_off: bool = True,
) -> dict[str, Any]:
    audits = [
        a for a in store.energy_audit
        if (floor is None or a["floor"] == floor) and (zone is None or a["zone"] == zone)
    ]
    circuits_summary = []
    fm_overrides_summary = []
    total_kwh = 0.0
    total_thb = 0.0
    default_total_kwh = 0.0
    default_total_thb = 0.0
    curfew_count = 0
    critical_count = 0

    for audit in audits:
        f_num = audit["floor"]
        z_str = audit["zone"]
        space_name = _zone_function(f_num, z_str)
        for c in audit["circuits"]:
            cid = c["circuit_id"]
            is_critical = c["classification"] == "Critical Standby"
            # The K-Means classification is a recommendation; the FM's choice wins.
            recommended = "keep_on" if is_critical else "curfew"
            win = circuit_windows.get(cid)
            mode = "keep_on" if cid in kept_on else ("curfew" if win is not None else recommended)
            is_exempt = mode == "keep_on" and not is_critical

            # Baseline: model recommendation with the default 17:00-08:00 curfew, weekends & holidays off
            base_kwh, base_thb = _circuit_savings_for_window(store, c, month, 17, 8)
            default_total_kwh += base_kwh
            default_total_thb += base_thb

            if mode == "keep_on":
                saved_kwh, saved_thb = 0.0, 0.0
                if is_critical:
                    active_schedule = "ON 24/7 (model recommendation)"
                    critical_count += 1
                else:
                    active_schedule = "Kept ON 24/7 by the FM (model recommends a curfew)"
                    fm_overrides_summary.append({
                        "circuit_id": cid,
                        "space_name": space_name,
                        "override": "Kept ON 24/7 (model recommends a curfew)",
                        "active_saved_kwh": 0.0,
                        "active_saved_thb": 0.0,
                        "default_17_08_kwh": round(base_kwh, 1),
                        "default_17_08_thb": round(base_thb, 0),
                        "delta_thb_vs_default": round(-base_thb, 0),
                    })
            else:
                eff_start = win.start_hour if win else start_hour
                eff_end = win.end_hour if win else end_hour
                eff_wk = win.weekends_off if win else weekends_off
                saved_kwh, saved_thb = _circuit_savings_for_window(
                    store, c, month, eff_start, eff_end, eff_wk, include_critical=True)
                wk_txt = "" if eff_wk else ", same hours on weekends & holidays"
                active_schedule = f"Curfew Off {eff_start:02d}:00–{eff_end:02d}:00{wk_txt}"
                curfew_count += 1
                if is_critical:
                    fm_overrides_summary.append({
                        "circuit_id": cid,
                        "space_name": space_name,
                        "override": f"Put on curfew Off {eff_start:02d}:00–{eff_end:02d}:00{wk_txt} although the model recommends keeping it on (confirm it is safe to switch off)",
                        "active_saved_kwh": round(saved_kwh, 1),
                        "active_saved_thb": round(saved_thb, 0),
                        "default_17_08_kwh": 0.0,
                        "default_17_08_thb": 0.0,
                        "delta_thb_vs_default": round(saved_thb, 0),
                    })
                elif win and (eff_start, eff_end, eff_wk) != (start_hour, end_hour, weekends_off):
                    fm_overrides_summary.append({
                        "circuit_id": cid,
                        "space_name": space_name,
                        "override": f"Custom Curfew Off {eff_start:02d}:00–{eff_end:02d}:00{wk_txt}",
                        "active_saved_kwh": round(saved_kwh, 1),
                        "active_saved_thb": round(saved_thb, 0),
                        "default_17_08_kwh": round(base_kwh, 1),
                        "default_17_08_thb": round(base_thb, 0),
                        "delta_thb_vs_default": round(saved_thb - base_thb, 0),
                    })

            total_kwh += saved_kwh
            total_thb += saved_thb

            unocc_kw = c.get("monthly", {}).get(month, {}).get("unocc_mean_kw") if month else c.get("unocc_mean_kw")
            circuits_summary.append({
                "circuit_id": cid,
                "floor": f_num,
                "zone": z_str,
                "space_name": space_name,
                "type": c["type"],
                "classification": c["classification"],
                "unocc_to_occ_ratio": c.get("unocc_to_occ_ratio", 0.0),
                "offhours_cv": c.get("offhours_cv", 0.0),
                "baseload_kw": round(float(c["baseload_kw"]), 3),
                "unocc_mean_kw": round(float(unocc_kw or 0.0), 3),
                "active_schedule": active_schedule,
                "is_critical": is_critical,
                "is_exempt": is_exempt,
                "recommended": recommended,
                "fm_setting": mode,
                "saved_kwh": round(saved_kwh, 1),
                "saved_thb": round(saved_thb, 0),
                "default_17_08_kwh": round(base_kwh, 1),
                "default_17_08_thb": round(base_thb, 0),
            })

    circuits_summary.sort(key=lambda x: (1 if x["is_critical"] else 0, -x["default_17_08_thb"]))
    scope_desc = (
        f"Floor {floor}, Zone {zone[1:]} ({_zone_function(floor, zone)})"
        if floor and zone
        else f"Floor {floor}"
        if floor
        else "Whole Building (7 floors, 65 circuits)"
    )
    return {
        "scope_desc": scope_desc,
        "period_desc": month if month else "Annual baseline (Jul 2018–Jun 2019)",
        "global_window": f"{start_hour:02d}:00–{end_hour:02d}:00",
        "is_default_global_window": start_hour == 17 and end_hour == 8,
        "total_saved_kwh": round(total_kwh, 1),
        "total_saved_thb": round(total_thb, 0),
        "default_17_08_total_kwh": round(default_total_kwh, 1),
        "default_17_08_total_thb": round(default_total_thb, 0),
        "delta_kwh_vs_default": round(total_kwh - default_total_kwh, 1),
        "delta_thb_vs_default": round(total_thb - default_total_thb, 0),
        "curfew_count": curfew_count,
        "critical_count": critical_count,
        "fm_overrides": fm_overrides_summary,
        "top_circuits": circuits_summary[:12],
        "all_circuits": circuits_summary,
    }


def _fallback_chat(message: str, ctx: dict[str, Any]) -> str:
    q = message.lower()
    top = [c for c in ctx["top_circuits"] if not c["is_critical"] and c["default_17_08_thb"] > 0]
    criticals = [c for c in ctx["all_circuits"] if c["is_critical"]]
    overrides = ctx["fm_overrides"]

    if any(w in q for w in ["manual", "change", "override", "exempt", "adjust", "what did i", "difference", "what if", "delay", "window", "slider"]):
        lines = [
            f"### 🎛️ Active Dashboard Settings ({ctx['scope_desc']})",
            f"- **Global Curfew Window:** `{ctx['global_window']}` {'(Default Baseline)' if ctx['is_default_global_window'] else '(Adjusted from 17:00–08:00)'}",
            f"- **Simulated Savings:** **{int(ctx['total_saved_kwh']):,} kWh** (**฿{int(ctx['total_saved_thb']):,}** excl. VAT)",
            f"- **Default 17:00–08:00 Baseline:** **{int(ctx['default_17_08_total_kwh']):,} kWh** (**฿{int(ctx['default_17_08_total_thb']):,}** excl. VAT)",
        ]
        if ctx["delta_thb_vs_default"] != 0:
            diff_thb = int(abs(ctx["delta_thb_vs_default"]))
            diff_kwh = int(abs(ctx["delta_kwh_vs_default"]))
            direction = "reduces" if ctx["delta_thb_vs_default"] < 0 else "increases"
            lines.append(f"- **Net Impact of Manual Adjustments:** {direction} savings by **฿{diff_thb:,}** (**{diff_kwh:,} kWh**).")
        if overrides:
            lines.append("\n**Per-Circuit Manual Overrides:**")
            for ov in overrides[:8]:
                lines.append(
                    f"- `{ov['circuit_id'].replace('(kW)', '')}` ({ov['space_name']}): **{ov['override']}** → "
                    f"saves **฿{int(ov['active_saved_thb']):,}** vs **฿{int(ov['default_17_08_thb']):,}** at default (`{int(ov['delta_thb_vs_default']):+,} THB`)."
                )
        else:
            lines.append("\nNo individual circuit overrides are currently active; all 61 Preventable Waste circuits follow the global curfew window.")
        return "\n".join(lines)

    if any(w in q for w in ["critical", "standby", "24/7", "lock", "keep on", "exempt"]):
        lines = [
            "### 🔒 Critical Standby Circuits (ON 24/7 by default)",
            f"Based on K-Means clustering (Schedule Invariance Ratio, Off-Hours CV, and $P_{{2.5}}$ Baseload), **{len(criticals)} circuits** are classified as **Critical Standby**. "
            "Building, floor and zone curfews never switch them off; the FM can give an individual circuit its own curfew after confirming it is safe:",
        ]
        for c in criticals:
            lines.append(
                f"- `{c['circuit_id'].replace('(kW)', '')}` ({c['space_name']}): "
                f"Ratio `{c['unocc_to_occ_ratio']}`, CV `{c['offhours_cv']}`, Baseload `{c['baseload_kw']:.2f} kW`"
            )
        return "\n".join(lines)

    if any(w in q for w in ["f1", "floor 1", "lobby", "hotspot", "worst", "highest", "top"]):
        lines = [f"### 🔥 Top Preventable Waste Circuits in {ctx['scope_desc']} ({ctx['period_desc']})"]
        for i, c in enumerate(top[:5], 1):
            lines.append(
                f"{i}. **{c['circuit_id'].replace('(kW)', '')}** ({c['space_name']}): **{c['active_schedule']}** — "
                f"Unoccupied `{c['unocc_mean_kw']:.2f} kW` vs `{c['baseload_kw']:.2f} kW` base → saves **฿{int(c['saved_thb']):,}** (**{int(c['saved_kwh']):,} kWh**)."
            )
        return "\n".join(lines)

    lead = top[0] if top else None
    lead_line = (
        f"\n\n**Top Hotspot:** `{lead['circuit_id'].replace('(kW)', '')}` ({lead['space_name']}) running at `{lead['unocc_mean_kw']:.2f} kW` after hours vs `{lead['baseload_kw']:.2f} kW` base (**฿{int(lead['saved_thb']):,}**)."
        if lead
        else ""
    )
    return (
        f"### 📊 Dashboard Summary: {ctx['scope_desc']}\n\n"
        f"- **Active Curfew Window:** `{ctx['global_window']}` ({ctx['period_desc']})\n"
        f"- **Recoverable Savings:** **{int(ctx['total_saved_kwh']):,} kWh** (**฿{int(ctx['total_saved_thb']):,}** excl. VAT)\n"
        f"- **Circuit Split:** **{ctx['curfew_count']}** Preventable Waste circuits on curfew · **{ctx['critical_count']}** Critical Standby circuits locked ON 24/7"
        f"{lead_line}"
    )


def generate_ai_chat(store: Store, req: AIChatRequest) -> dict[str, Any]:
    ctx = _build_scope_telemetry(
        store,
        req.floor,
        req.zone,
        req.month,
        req.start_hour,
        req.end_hour,
        set(req.kept_on),
        req.circuit_windows,
        req.weekends_off,
    )
    api_key = resolve_api_key(req.api_key)
    if not api_key:
        return {
            "source": "telemetry_engine",
            "model": "K-Means Telemetry Engine",
            "reply": _fallback_chat(req.message, ctx),
        }

    system_prompt = (
        "You are the Chamchuri 5 Building Energy Audit AI Copilot assisting a Facility Manager (FM).\n"
        "Your job is to answer questions about the building's after-hours energy audit dashboard and explain the impact of any manual changes the FM has made.\n"
        "Rules:\n"
        "1. NEVER mention internal notebook codes like '1e' or 'qn1e'. Refer to the model as the 'K-Means Baseload & Waste Classification Audit' and the default window as the 'Default 17:00–08:00 Baseline'.\n"
        "2. Circuit rules on the dashboard:\n"
        "   - The K-Means classification is a RECOMMENDATION. 'Critical Standby' circuits (4 circuits on Floor 1: engine room & safety/exterior lighting) are recommended to stay ON 24/7; 'Preventable Waste' circuits (61 circuits) are recommended to be off during the after-hours curfew (default 17:00–08:00, plus all day on weekends & public holidays).\n"
        "   - The FM can change any circuit: keep it on, follow the curfew, or give it its own hours, and can choose whether weekends & holidays are off all day or follow the same hours. Each circuit's `recommended` and `fm_setting` fields show both. When the FM switches off a circuit the model recommends keeping on, remind them to confirm with facilities that it is safe.\n"
        "3. Always cite exact circuit names, space uses, kW baseloads, kWh, and Thai Baht (฿) figures from the live telemetry context below, including any manual overrides in `fm_overrides`.\n"
        "4. Keep responses concise (under 170 words) using clean Markdown bullet points.\n\n"
        f"LIVE DASHBOARD & TELEMETRY CONTEXT:\n{json.dumps(ctx, ensure_ascii=False)}"
    )

    contents = []
    for msg in req.history[-6:]:
        contents.append({
            "role": "user" if msg.role == "user" else "model",
            "parts": [{"text": msg.text}],
        })
    contents.append({
        "role": "user",
        "parts": [{"text": req.message}],
    })

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 700,
        },
    }

    try:
        resp = requests.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        if text:
            return {
                "source": "gemini",
                "model": "gemini-2.5-flash",
                "reply": text,
            }
    except Exception:
        pass

    return {
        "source": "telemetry_engine",
        "model": "K-Means Telemetry Engine",
        "reply": _fallback_chat(req.message, ctx),
    }

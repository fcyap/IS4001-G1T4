"""FastAPI backend for the building comfort and energy view (Questions A and B).

Dev:   uvicorn webapp.api.main:app --reload --port 8000   (with the Vite dev server on :5173)
Demo:  python -m webapp.api                               (also serves webapp/web/dist if built)
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .chat import AIChatRequest, generate_ai_chat, resolve_api_key
from .data import load, qc, records
from .sim import Scenario, Simulator

store = load()
sim = Simulator(store)
app = FastAPI(title="Building comfort and energy view")

# Manual what-if range, either way. The rule's own cap (qc.MAX_RAISE_C) still applies to its recommendations.
WHATIF_LIMIT_C = 5.0


class WhatIf(BaseModel):
    mode: str = Field("global", pattern="^(global|rule)$")
    global_c: float = Field(0.0, ge=-WHATIF_LIMIT_C, le=WHATIF_LIMIT_C)
    overrides: dict[str, float] = {}
    months: list[str] = []

    def scenario(self) -> Scenario:
        clean = {k: min(max(v, -WHATIF_LIMIT_C), WHATIF_LIMIT_C) for k, v in self.overrides.items()}
        return Scenario.build(self.mode, self.global_c, clean)


@app.get("/api/meta")
def meta():
    return {
        "floors": sorted({z["floor"] for z in store.registry}),
        "zones": store.registry,
        "energy_audit": store.energy_audit,
        "afterhours_timing": store.afterhours_timing,
        "months": store.months,
        "office_days": store.office_days,
        "rules": {"raise_step_c": qc.RAISE_STEP_C, "max_raise_c": qc.MAX_RAISE_C, "max_lower_c": qc.MAX_LOWER_C,
                  "reliable_change_c": qc.RELIABLE_CHANGE_C, "whatif_limit_c": WHATIF_LIMIT_C,
                  "lower_if_too_warm": qc.LOWER_IF_TOO_WARM_SHARE,
                  "raise_if_too_cool": qc.RAISE_IF_TOO_COOL_SHARE, "too_warm_tolerance": qc.TOO_WARM_TOLERANCE,
                  "office_periods_per_year": qc.OFFICE_PERIODS_PER_YEAR},
        "heatmap": records(store.heatmap),
        "monthly": records(store.monthly),
        "ai_configured": bool(resolve_api_key()),
    }


@app.get("/api/ai/status")
def ai_status():
    return {"configured": bool(resolve_api_key())}


@app.post("/api/ai/chat")
def ai_chat(body: AIChatRequest):
    return generate_ai_chat(store, body)


@app.post("/api/whatif")
def whatif(body: WhatIf):
    return sim.whatif(body.scenario(), body.months or None)


@app.post("/api/zone/{floor}/{zone}")
def zone_detail(floor: int, zone: str, body: WhatIf):
    zid = f"F{floor}:{zone}"
    if not any(z["id"] == zid for z in store.registry):
        raise HTTPException(404, f"unknown zone {zid}")
    return sim.zone_detail(zid, body.scenario(), body.months or None)


@app.post("/api/replay/{date}")
def replay(date: str, body: WhatIf):
    if date not in store.office_days:
        raise HTTPException(404, f"no sensor data on {date}")
    return sim.replay(date, body.scenario())


@app.get("/api/load")
def load_pattern(floor: int | None = None, zone: str | None = None):
    """Weekly AC kWh in office hours: actual vs weather-normalised baseline."""
    p = store.preds
    if floor is not None:
        p = p[p["floor"] == floor]
    if zone is not None:
        p = p[p["zone"] == zone]
    if p.empty:
        return {"weeks": [], "actual": [], "baseline": [], "test_start": "2019-07-01"}
    weekly = p.set_index("timestamp")[["ac_kw", "pred_chosen"]].resample("W").sum()   # hourly kW -> kWh
    weekly = weekly[(weekly["ac_kw"] > 0) | (weekly["pred_chosen"] > 0)]
    test = p[p["split"] == "test"]
    return {
        "weeks": [d.strftime("%Y-%m-%d") for d in weekly.index],
        "actual": weekly["ac_kw"].round(1).tolist(),
        "baseline": weekly["pred_chosen"].round(1).tolist(),
        "test_start": "2019-07-01",
        "test_actual_kwh": round(float(test["ac_kw"].sum()), 0),
        "test_baseline_kwh": round(float(test["pred_chosen"].sum()), 0),
    }


# --- Built frontend (python -m webapp.api) ------------------------------------------------------
DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")

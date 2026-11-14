import { useEffect } from "react";
import { AUDIT_CLASS_COLORS, auditValueColor, MEASURES } from "../lib/colors";
import { useData } from "../lib/data";
import { useCurfewSettings, useZoneSavings } from "../lib/plan";
import { dateLabel } from "../lib/format";
import { isAuditMeasure, monthLabel, useStore, type AuditMeasure, type MapMeasure, type Measure } from "../lib/store";

// Layers offered under "Colour Zones by": after-hours waste supports load, energy, cost, and waste status.
const AFTERHOURS_PICKS: MapMeasure[] = ["audit_load", "audit_kwh", "audit_cost", "audit_classification"];
const COMFORT_PICKS: Record<string, MapMeasure[]> = {
  overview: ["too_cool", "comfortable", "pmv", "ac"],
  whatif: ["comfortable", "too_cool", "saved", "pmv", "ac"],
  replay: ["pmv", "ac"],
};
const REPLAY_LABEL: Partial<Record<Measure, string>> = { pmv: "PMV Now", ac: "AC Power Now" };

function Legend({ measure }: { measure: Measure }) {
  const m = MEASURES[measure];
  const [lo, hi] = measure === "ac" ? [0, 40] : m.domain;
  const ends = measure === "pmv" ? ["−2 Cold", "0", "+2 Warm"]
    : measure === "saved" ? [`${(-lo).toLocaleString()} kWh Extra`, "0", `${hi.toLocaleString()} kWh Saved`]
    : [`${lo}${m.unit === "%" ? " %" : ""}`, `${hi.toLocaleString()} ${m.unit}`];
  return (
    <div className="legend">
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${m.legend.join(",")})` }} />
      <div className="legend-ends">{ends.map((e) => <span key={e}>{e}</span>)}</div>
      <div className="legend-keys">
        <span><i className="k-nodata" />No Sensor or AC</span>
        <span><i className="k-inspect" />Check First</span>
        <span><i className="k-breach" />Over Guardrail</span>
      </div>
    </div>
  );
}

function AuditLegend({ measure }: { measure: AuditMeasure }) {
  const { meta } = useData();
  const month = useStore((s) => s.month);
  const mode = useStore((s) => s.mode);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const zoneSaved = useZoneSavings(meta, month, useCurfewSettings());
  const showSaved = mode === "whatif" && (measure === "audit_kwh" || measure === "audit_cost");
  const rawValues = (meta?.energy_audit ?? []).map((z) => measure === "audit_load"
    ? month ? z.monthly[month]?.unocc_mean_kw : z.unocc_mean_kw
    : month ? measure === "audit_cost" ? z.monthly[month]?.cost_thb : z.monthly[month]?.surplus_kwh
      : measure === "audit_cost" ? z.annual_cost_thb : z.annual_surplus_kwh).filter((v): v is number => v !== null);
  const values = showSaved ? [...zoneSaved.values()].map((v) => (measure === "audit_cost" ? v.thb : v.kwh)) : rawValues;
  const max = Math.max(...values, 1);
  const unit = measure === "audit_load" ? "kW" : measure === "audit_cost" ? "THB" : "kWh";
  const endFmt = String(endHour).padStart(2, "0");
  return (
    <div className="legend">
      {measure === "audit_classification" ? <div className="legend-keys audit-keys">
        {Object.entries(AUDIT_CLASS_COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
        <span><i className="k-nodata" />No circuit data</span>
      </div> : <>
        <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => auditValueColor(max * t * t, max)).join(",")})` }} />
        <div className="legend-ends"><span>0 {unit}</span><span>{Math.round(max).toLocaleString()} {unit}</span></div>
        <div className="legend-keys">
          <span><i className="k-nodata" />No circuit data</span>
          <span>
            {showSaved
              ? "Saved by the curfew plan"
              : mode === "whatif"
              ? `After curfew ${startHour}:00–${endFmt}:00`
              : month ? monthLabel(month) : "Jul 2018–Jun 2019"}
          </span>
        </div>
      </>}
    </div>
  );
}

function Player() {
  const { meta, replay } = useData();
  const r = useStore((s) => s.replay);
  const setReplay = useStore((s) => s.setReplay);
  const steps = replay?.times.length ?? 0;

  useEffect(() => {
    if (!r.playing || steps === 0) return;
    const id = setInterval(() => {
      const t = useStore.getState().replay.t;
      if (t >= steps - 1) setReplay({ playing: false });
      else setReplay({ t: t + 1 });
    }, 1000 / r.speed);
    return () => clearInterval(id);
  }, [r.playing, r.speed, steps, setReplay]);

  useEffect(() => { setReplay({ t: 0 }); }, [r.date, setReplay]);

  const days = meta?.office_days ?? [];
  const i = r.date ? days.indexOf(r.date) : -1;
  return (
    <div className="player">
      <div className="player-row">
        <button type="button" className="play" aria-label={r.playing ? "Pause" : "Play"}
          onClick={() => setReplay({ playing: !r.playing, t: r.t >= steps - 1 ? 0 : r.t })}>
          {r.playing
            ? <svg viewBox="0 0 16 16" width="14" aria-hidden><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
            : <svg viewBox="0 0 16 16" width="14" aria-hidden><path d="M4 2 L14 8 L4 14 Z" fill="currentColor" /></svg>}
        </button>
        <div className="clock">{replay?.times[r.t] ?? "--:--"}</div>
        <input type="range" min={0} max={Math.max(steps - 1, 0)} value={r.t} aria-label="Time of day" aria-valuetext={replay?.times[r.t]}
          onChange={(e) => setReplay({ t: +e.target.value, playing: false })} />
        <select value={r.speed} aria-label="Speed" onChange={(e) => setReplay({ speed: +e.target.value })}>
          {[2, 4, 8].map((s) => <option key={s} value={s}>{s}× </option>)}
        </select>
      </div>
      <div className="player-row small">
        <button type="button" className="ghost" disabled={i <= 0} onClick={() => setReplay({ date: days[i - 1] })} aria-label="Previous day">‹</button>
        <select value={r.date ?? ""} onChange={(e) => setReplay({ date: e.target.value })} aria-label="Day">
          {days.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}
        </select>
        <button type="button" className="ghost" disabled={i < 0 || i >= days.length - 1} onClick={() => setReplay({ date: days[i + 1] })} aria-label="Next day">›</button>
        <div className="segmented tiny" role="group" aria-label="Scenario">
          <button type="button" className={!r.after ? "on" : ""} aria-pressed={!r.after} onClick={() => setReplay({ after: false })}>As Recorded</button>
          <button type="button" className={r.after ? "on" : ""} aria-pressed={r.after} onClick={() => setReplay({ after: true })}>With Setpoint Change</button>
        </div>
      </div>
    </div>
  );
}

/** Setpoint what-if: flip the map between the zones as recorded and with the rule or manual change applied. */
function BeforeAfterSwitch() {
  const showAfter = useStore((s) => s.whatifShowAfter);
  const setShowAfter = useStore((s) => s.setWhatifShowAfter);
  const rule = useStore((s) => s.whatif.mode === "rule");
  const after = rule ? "With Recommended Rule" : "With Manual Change";
  return (
    <div className="segmented before-after" role="group" aria-label="Show the zones">
      <button type="button" className={!showAfter ? "on" : ""} aria-pressed={!showAfter} onClick={() => setShowAfter(false)}>Current</button>
      <button type="button" className={showAfter ? "on" : ""} aria-pressed={showAfter} onClick={() => setShowAfter(true)}>{after}</button>
    </div>
  );
}

/** Floor picker: shown in plan view and once a floor is selected, when other floors (and their tags) are hidden or lifted out of view. */
function FloorPicker() {
  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);
  const floors = [...(meta?.floors ?? [])].sort((a, b) => b - a);
  return (
    <nav className="floor-picker" aria-label="Floors">
      <span>Floor</span>
      {floors.map((f) => (
        <button key={f} type="button" className={scope.floor === f ? "on" : ""} aria-current={scope.floor === f ? "location" : undefined} aria-label={`Floor ${f}`}
          onClick={() => select({ floor: f })}>{f}</button>
      ))}
    </nav>
  );
}

export default function Stage() {
  const topic = useStore((s) => s.topic);
  const mode = useStore((s) => s.mode);
  const measure = useStore((s) => s.measure);
  const setMeasure = useStore((s) => s.setMeasure);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const scope = useStore((s) => s.scope);
  const { error } = useData();
  const picks = topic === "afterhours" ? AFTERHOURS_PICKS : COMFORT_PICKS[mode] ?? [];
  const active = picks.includes(measure) ? measure : picks[0];

  useEffect(() => {
    if (active && active !== measure) setMeasure(active);
  }, [active, measure, setMeasure]);

  return (
    <>
      <div className="stage-tl">
        <label className="field">
          <span>Colour Zones by</span>
          <select value={active} onChange={(e) => setMeasure(e.target.value as MapMeasure)}>
            {picks.map((p) => <option key={p} value={p}>{isAuditMeasure(p)
              ? p === "audit_load" ? "After-hours Load (kW)"
                : p === "audit_kwh" ? (mode === "whatif" ? "Energy Saved (kWh)" : "Preventable Energy (kWh)")
                  : p === "audit_cost" ? (mode === "whatif" ? "Cost Saved (THB)" : "Cost Opportunity (THB)")
                    : "Waste Status"
              : mode === "replay" ? REPLAY_LABEL[p as Measure] : MEASURES[p as Measure].label}</option>)}
          </select>
        </label>
        {topic === "comfort" && mode === "whatif" && <BeforeAfterSwitch />}
      </div>
      {isAuditMeasure(active) ? <div className="stage-bl"><AuditLegend measure={active} /></div>
        : mode !== "replay" && <div className="stage-bl"><Legend measure={active as Measure} /></div>}
      {(view === "plan" || scope.floor !== undefined) && <FloorPicker />}
      <div className="stage-tr">
        {mode === "replay" && <Legend measure={active as Measure} />}
        <div className="segmented" role="group" aria-label="Building view">
          <button type="button" className={view === "3d" ? "on" : ""} aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D</button>
          <button type="button" className={view === "plan" ? "on" : ""} aria-pressed={view === "plan"} onClick={() => setView("plan")}>Plan</button>
        </div>
      </div>
      {error && <div className="stage-error" role="alert">Can’t reach the data service ({error}). Start it with <code>python -m webapp.api</code>, then reload.</div>}
      <div className={`stage-bottom ${topic === "afterhours" ? "has-fab" : ""}`}>
        {mode === "replay" && <Player />}
        <p className="caption">
          {scope.floor === undefined ? "Pick a floor on the left to open it. " : "Click a zone for detail. Esc goes back. "}
          Zone plans from CU-BEMS (Pipattanasomporn et al., 2020).
        </p>
      </div>
    </>
  );
}

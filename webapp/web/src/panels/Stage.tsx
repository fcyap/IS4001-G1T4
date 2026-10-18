import { useEffect } from "react";
import { MEASURES } from "../lib/colors";
import { useData } from "../lib/data";
import { dateLabel } from "../lib/format";
import { useStore, type Measure } from "../lib/store";

const PICKS: Record<string, Measure[]> = {
  overview: ["too_cool", "comfortable", "pmv", "ac"],
  whatif: ["saved", "too_cool", "comfortable", "pmv", "ac"],
  replay: ["pmv", "ac"],
};
const REPLAY_LABEL: Partial<Record<Measure, string>> = { pmv: "PMV Now", ac: "AC Power Now" };

function Legend({ measure }: { measure: Measure }) {
  const m = MEASURES[measure];
  const [lo, hi] = measure === "ac" ? [0, 40] : m.domain;
  const ends = measure === "pmv" ? ["−2 Cold", "0", "+2 Warm"]
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
        <button className="play" aria-label={r.playing ? "Pause" : "Play"}
          onClick={() => setReplay({ playing: !r.playing, t: r.t >= steps - 1 ? 0 : r.t })}>
          {r.playing
            ? <svg viewBox="0 0 16 16" width="14"><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
            : <svg viewBox="0 0 16 16" width="14"><path d="M4 2 L14 8 L4 14 Z" fill="currentColor" /></svg>}
        </button>
        <div className="clock">{replay?.times[r.t] ?? "--:--"}</div>
        <input type="range" min={0} max={Math.max(steps - 1, 0)} value={r.t} aria-label="Time of day"
          onChange={(e) => setReplay({ t: +e.target.value, playing: false })} />
        <select value={r.speed} aria-label="Speed" onChange={(e) => setReplay({ speed: +e.target.value })}>
          {[2, 4, 8].map((s) => <option key={s} value={s}>{s}× </option>)}
        </select>
      </div>
      <div className="player-row small">
        <button className="ghost" disabled={i <= 0} onClick={() => setReplay({ date: days[i - 1] })} aria-label="Previous day">‹</button>
        <select value={r.date ?? ""} onChange={(e) => setReplay({ date: e.target.value })} aria-label="Day">
          {days.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}
        </select>
        <button className="ghost" disabled={i < 0 || i >= days.length - 1} onClick={() => setReplay({ date: days[i + 1] })} aria-label="Next day">›</button>
        <div className="segmented tiny">
          <button className={!r.after ? "on" : ""} onClick={() => setReplay({ after: false })}>As Recorded</button>
          <button className={r.after ? "on" : ""} onClick={() => setReplay({ after: true })}>With Setpoint Change</button>
        </div>
      </div>
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
        <button key={f} className={scope.floor === f ? "on" : ""} aria-current={scope.floor === f}
          onClick={() => select({ floor: f })}>{f}</button>
      ))}
    </nav>
  );
}

export default function Stage() {
  const mode = useStore((s) => s.mode);
  const measure = useStore((s) => s.measure);
  const setMeasure = useStore((s) => s.setMeasure);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const scope = useStore((s) => s.scope);
  const { error } = useData();
  const picks = PICKS[mode];
  const active = picks.includes(measure) ? measure : picks[0];

  return (
    <>
      <div className="stage-tl">
        <label className="field">
          <span>Colour Zones by</span>
          <select value={active} onChange={(e) => setMeasure(e.target.value as Measure)}>
            {picks.map((p) => <option key={p} value={p}>{mode === "replay" ? REPLAY_LABEL[p] : MEASURES[p].label}</option>)}
          </select>
        </label>
      </div>
      {mode !== "replay" && <div className="stage-bl"><Legend measure={active} /></div>}
      {(view === "plan" || scope.floor !== undefined) && <FloorPicker />}
      <div className="stage-tr">
        {mode === "replay" && <Legend measure={active} />}
        <div className="segmented">
          <button className={view === "3d" ? "on" : ""} onClick={() => setView("3d")}>3D</button>
          <button className={view === "plan" ? "on" : ""} onClick={() => setView("plan")}>Plan</button>
        </div>
      </div>
      {error && <div className="stage-error">Can’t reach the data service ({error}). Start it with <code>python -m webapp.api</code>, then reload.</div>}
      <div className="stage-bottom">
        {mode === "replay" && <Player />}
        <p className="caption">
          {scope.floor === undefined ? "Click a floor to lift it out of the stack. " : "Click a zone for its detail. Esc goes back up. "}
          Zone plans traced from the CU-BEMS paper (Pipattanasomporn et al., 2020, Fig. 2); facade is schematic. Data is a historical replay of CU-BEMS (2018–19), not a live feed.
        </p>
      </div>
    </>
  );
}

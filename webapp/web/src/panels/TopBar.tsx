import { useEffect, useMemo } from "react";
import { useData } from "../lib/data";
import { MODES_BY_TOPIC, monthLabel, useStore, zoneName, type Mode, type Topic } from "../lib/store";

const TOPICS: { id: Topic; label: string; hint: string }[] = [
  { id: "afterhours", label: "After-hours Waste", hint: "Which circuits run outside office hours, and what switching them off is worth" },
  { id: "comfort", label: "Cooling Comfort", hint: "Where offices are overcooled, and what a setpoint change saves" },
];

// Mode tabs, worded for each question.
const MODE_LABELS: Record<"afterhours" | "comfort", Partial<Record<Mode, { label: string; hint: string }>>> = {
  afterhours: {
    overview: { label: "Today", hint: "Where after-hours load runs and what it costs" },
    whatif: { label: "What-If Simulation", hint: "Choose how much preventable load to cut and see energy and cost saved" },
  },
  comfort: {
    overview: { label: "Today", hint: "How the building runs now" },
    whatif: { label: "Setpoint What-If", hint: "Raise or lower setpoints and see comfort and AC energy change" },
    replay: { label: "Replay a Day", hint: "Step through one office day, 15 minutes at a time" },
  },
};

export default function TopBar() {
  const { meta, loading } = useData();
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);
  const topic = useStore((s) => s.topic);
  const navigate = useStore((s) => s.navigate);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const month = useStore((s) => s.month);
  const setMonth = useStore((s) => s.setMonth);
  const auditView = topic === "afterhours";
  const auditMonths = useMemo(() => [...new Set((meta?.energy_audit ?? []).flatMap((zone) => Object.keys(zone.monthly)))].sort(), [meta?.energy_audit]);
  const availableMonths = auditView ? auditMonths : meta?.months ?? [];

  useEffect(() => {
    if (month && !availableMonths.includes(month)) setMonth(null);
  }, [month, availableMonths, setMonth]);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => navigate("home")} aria-label="Chamchuri 5, back to the start page" title="Back to the start page">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={3 + (i % 2)} y={20 - i * 2.7} width="17" height="1.7" rx="0.4"
              fill={i === 3 ? "#5fa8e8" : "#41597a"} />
          ))}
        </svg>
        <div>
          <strong>Chamchuri 5</strong>
        </div>
      </button>

      <div className="segmented topics" role="group" aria-label="Question">
        {TOPICS.map((t) => (
          <button key={t.id} type="button" aria-pressed={topic === t.id} title={t.hint}
            className={topic === t.id ? "on" : ""} onClick={() => navigate(t.id)}>{t.label}</button>
        ))}
      </div>

      <nav className="crumbs" aria-label="Selection">
        <button type="button" className={!scope.floor ? "on" : ""} aria-current={!scope.floor ? "location" : undefined} onClick={() => select({})}>Whole Building</button>
        {scope.floor !== undefined && (
          <>
            <span aria-hidden>/</span>
            <button type="button" className={!scope.zone ? "on" : ""} aria-current={!scope.zone ? "location" : undefined} onClick={() => select({ floor: scope.floor })}>Floor {scope.floor}</button>
          </>
        )}
        {scope.zone && (
          <>
            <span aria-hidden>/</span>
            <span className="crumb-here" aria-current="location">{zoneName(scope.zone)}</span>
          </>
        )}
      </nav>

      <div className="topbar-right">
        {mode !== "replay" && (
          <label className="field">
            <span>Period</span>
            <select value={month ?? ""} onChange={(e) => setMonth(e.target.value || null)}>
              <option value="">{auditView ? "Annual baseline (Jul 2018–Jun 2019)" : `All Sensor Months (${availableMonths.length || "…"})`}</option>
              {availableMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
        )}
        {topic !== "home" && <div className="segmented" role="group" aria-label="View">
          {MODES_BY_TOPIC[topic].map((id) => {
            const m = MODE_LABELS[topic][id]!;
            return <button key={id} type="button" aria-pressed={mode === id} title={m.hint}
              className={mode === id ? "on" : ""} onClick={() => setMode(id)}>{m.label}</button>;
          })}
        </div>}
        <span className={`sync ${loading ? "busy" : ""}`} role="status" aria-label={loading ? "Updating data" : "Data up to date"} title={loading ? "Updating" : "Up to date"} />
      </div>
    </header>
  );
}

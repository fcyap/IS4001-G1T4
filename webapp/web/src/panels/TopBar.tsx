import { useEffect, useMemo } from "react";
import { useData } from "../lib/data";
import { isAuditMeasure, monthLabel, useStore, zoneName, type Mode } from "../lib/store";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "overview", label: "Today", hint: "How the building runs now" },
  { id: "whatif", label: "Setpoint What-If", hint: "Raise or lower setpoints and see comfort and AC energy change" },
  { id: "replay", label: "Replay a Day", hint: "Step through one office day, 15 minutes at a time" },
];

export default function TopBar() {
  const { meta, loading } = useData();
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);
  const mode = useStore((s) => s.mode);
  const measure = useStore((s) => s.measure);
  const setMode = useStore((s) => s.setMode);
  const month = useStore((s) => s.month);
  const setMonth = useStore((s) => s.setMonth);
  const auditView = mode === "overview" && isAuditMeasure(measure);
  const auditMonths = useMemo(() => [...new Set((meta?.energy_audit ?? []).flatMap((zone) => Object.keys(zone.monthly)))].sort(), [meta?.energy_audit]);
  const availableMonths = auditView ? auditMonths : meta?.months ?? [];

  useEffect(() => {
    if (month && !availableMonths.includes(month)) setMonth(null);
  }, [month, availableMonths, setMonth]);

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x={3 + (i % 2)} y={20 - i * 2.7} width="17" height="1.7" rx="0.4"
              fill={i === 3 ? "#5fa8e8" : "#41597a"} />
          ))}
        </svg>
        <div>
          <strong>Chamchuri 5</strong>
        </div>
      </div>

      <nav className="crumbs" aria-label="Selection">
        <button className={!scope.floor ? "on" : ""} onClick={() => select({})}>Whole Building</button>
        {scope.floor !== undefined && (
          <>
            <span aria-hidden>/</span>
            <button className={!scope.zone ? "on" : ""} onClick={() => select({ floor: scope.floor })}>Floor {scope.floor}</button>
          </>
        )}
        {scope.zone && (
          <>
            <span aria-hidden>/</span>
            <button className="on">{zoneName(scope.zone)}</button>
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
        <div className="segmented" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} title={m.hint}
              className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <span className={`sync ${loading ? "busy" : ""}`} title={loading ? "Updating" : "Up to date"} />
      </div>
    </header>
  );
}

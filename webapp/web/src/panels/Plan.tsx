// The recommended plan for the What-If Simulation: which zones to switch off after hours and how far to raise
// cooling setpoints, with the savings. The planners below start from it, so users adjust it rather than start blank.
import { useState } from "react";
import { api, type EnergyAuditZone, type ZoneInfo } from "../lib/api";
import { useData, useFetch } from "../lib/data";
import { kwh, n0 } from "../lib/format";
import { OFFICE_AC_THB_PER_KWH, plannedScheduleSavings, recommend } from "../lib/plan";
import { monthLabel, useStore } from "../lib/store";
import { zoneUse } from "../lib/zones";
import { Section } from "./PanelPrimitives";

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const SHOWN = 6;

export default function Plan({ zones }: { zones: ZoneInfo[] }) {
  const { auditById, meta } = useData();
  const month = useStore((s) => s.month);
  const topic = useStore((s) => s.topic);
  const cutoff = useStore((s) => s.auditCutoffHour);
  const scopeNavigationCount = useStore((s) => s.scopeNavigationCount);
  const captureRates = useStore((s) => s.auditCaptureRates);
  const resetRates = useStore((s) => s.resetAuditCaptureRates);
  const whatif = useStore((s) => s.whatif);
  const setWhatif = useStore((s) => s.setWhatif);
  const select = useStore((s) => s.select);
  const [showAll, setShowAll] = useState(false);

  // The setpoint half is always the rule recommendation, whatever the user has since changed.
  const months = month ? [month] : [];
  const { data: rule } = useFetch(`plan-rule|${month}`, (sig) =>
    api.whatif({ mode: "rule", global_c: 0, overrides: {}, months }, sig));

  const ids = new Set(zones.map((z) => z.id));
  const audits = zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
  const switchOff = audits.map((a) => {
    const rec = recommend(a);
    const savings = meta ? plannedScheduleSavings(meta, { floor: a.floor, zone: a.zone }, cutoff, month)
      : { energyKwh: 0, costThb: 0 };
    return { a, rec, kwh: savings.energyKwh, thb: savings.costThb };
  }).sort((x, y) => y.thb - x.thb);
  const acted = switchOff.filter((r) => r.rec.rate > 0);
  const offKwh = switchOff.reduce((n, r) => n + r.kwh, 0);
  const offThb = switchOff.reduce((n, r) => n + r.thb, 0);

  const setpoint = (rule?.zones ?? []).filter((z) => ids.has(z.id));
  const acKwh = setpoint.reduce((n, z) => n + (month ? z.after.saved_kwh : z.after.annual_kwh_saved ?? 0), 0);
  const raised = setpoint.filter((z) => z.raise_max > 0).length;
  const breaches = setpoint.filter((z) => z.breach.length > 0).length;

  const changedZones = audits.filter((a) => captureRates[a.id] !== undefined && captureRates[a.id] !== recommend(a).rate).length;
  const changedSetpoint = whatif.mode !== "rule" || Object.keys(whatif.overrides).length > 0;
  const reset = () => { resetRates(audits.map((a) => a.id)); setWhatif({ mode: "rule", overrides: {} }); };
  const period = month ? `in ${monthLabel(month)}` : "a year";
  const cutoffLabel = `${String(cutoff >= 24 ? cutoff - 24 : cutoff).padStart(2, "0")}:00${cutoff >= 24 ? " next day" : ""}`;

  return (
    <Section title="Recommended Plan" aside={<span className="aside">{month ? monthLabel(month) : "Per Year"} · off at {cutoffLabel} · excl. VAT</span>} className="plan" collapsible defaultOpen={scopeNavigationCount > 0}>
      <div className="plan-total">
        <span className="stat-label">The plan saves</span>
        <span className="big">{thb(offThb + acKwh * OFFICE_AC_THB_PER_KWH)}</span>
        <span className="sub">{kwh(offKwh + acKwh)} {period}</span>
      </div>

      <div className="plan-parts">
        <div className={`plan-part ${topic === "afterhours" ? "on" : ""}`}>
          <span className="plan-step">1</span>
          <b>Switch off after hours</b>
          <span>{acted.length} of {audits.length} zones · {kwh(offKwh)} · {thb(offThb)}</span>
        </div>
        <div className={`plan-part ${topic === "comfort" ? "on" : ""}`}>
          <span className="plan-step">2</span>
          <b>Raise cooling setpoints</b>
          <span>{rule ? <>{raised} of {setpoint.length} zones · {kwh(acKwh)} · {thb(acKwh * OFFICE_AC_THB_PER_KWH)}</> : "Calculating…"}</span>
        </div>
      </div>
      {rule && <p className="note">{breaches ? `${breaches} zone${breaches > 1 ? "s" : ""} break the comfort guardrail in some month.` : "No zone breaks the comfort guardrail."}</p>}

      <h3 className="glance-h">Where to act first</h3>
      <ol className="plan-zones">
        {(showAll ? switchOff : switchOff.slice(0, SHOWN)).map(({ a, rec, thb: saved }) => {
          const use = zoneUse(a.floor, a.zone);
          const custom = captureRates[a.id] !== undefined && captureRates[a.id] !== rec.rate;
          return (
            <li key={a.id}>
              <button type="button" className="plan-zone" onClick={() => select({ floor: a.floor, zone: a.zone })}>
                <span className={`plan-rate ${rec.rate === 0 ? "off" : ""}`}>{rec.rate === 0 ? "Keep" : `Cut ${rec.rate}%`}</span>
                <span className="plan-zone-name">
                  <b>Floor {a.floor}, zone {a.zone.slice(1)}{use && <small> · {use.name}</small>}</b>
                  <small>{rec.action}{rec.rate > 0 && ` · off at ${cutoffLabel}`}{custom && ` · you set ${n0(captureRates[a.id])}%`}</small>
                </span>
                <span className="plan-zone-val">{rec.rate ? thb(saved) : "–"}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {switchOff.length > SHOWN && <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
        {showAll ? "Show the top zones only" : `Show all ${switchOff.length} zones`}</button>}

      {(changedZones || changedSetpoint) ? (
        <div className="plan-status">
          <span>You’ve changed {[changedZones && `${changedZones} zone${changedZones > 1 ? "s" : ""}`, changedSetpoint && "the setpoints"].filter(Boolean).join(" and ")}.</span>
          <button type="button" className="link" onClick={reset}>Reset to the plan</button>
        </div>
      ) : null}
      <p className="note">Cut rates follow each zone’s space type and circuit class. AC savings use the office-hour tariff, about ฿{OFFICE_AC_THB_PER_KWH.toFixed(2)}/kWh.</p>
    </Section>
  );
}

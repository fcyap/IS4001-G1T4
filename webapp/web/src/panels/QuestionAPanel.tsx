import { useEffect, useState } from "react";
import type { CurfewException, EnergyAuditZone, ZoneInfo } from "../lib/api";
import { useData } from "../lib/data";
import { kwh, n3 } from "../lib/format";
import {
  countPlanChanges,
  defaultWindow,
  exceptionId,
  formatWindow,
  getCircuitPlanInfo,
  plannedScheduleSavings,
  recommendedMode,
  useCurfewSettings,
  type CurfewWindow,
} from "../lib/plan";
import { monthLabel, useStore, type AuditMeasure, type MapMeasure, type Scope } from "../lib/store";
import { zoneUse } from "../lib/zones";
import { AfterHoursLoadChart, CircuitEnergyHeatmap, FloorEnergyChart, PreventableEnergyChart } from "./Charts";
import { Section, Stat } from "./PanelPrimitives";
import QuestionAPlan from "./QuestionAPlan";

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const START_HOURS = [17, 18, 19, 20, 21, 22, 23];
const END_HOURS = [5, 6, 7, 8];

function AfterHoursLoadReadouts({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const audits = zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
  const circuits = audits.flatMap((audit) => audit.circuits);
  const loadFor = (circuit: EnergyAuditZone["circuits"][number]) => month
    ? circuit.monthly?.[month]?.unocc_mean_kw ?? null : circuit.unocc_mean_kw;
  const totalLoadValues = circuits.map(loadFor).filter((v): v is number => v !== null);
  const totalLoad = totalLoadValues.length ? totalLoadValues.reduce((sum, value) => sum + value, 0) : null;
  const energy = audits.reduce((sum, audit) => sum + (month ? audit.monthly[month]?.surplus_kwh ?? 0 : audit.annual_surplus_kwh), 0);
  const cost = audits.reduce((sum, audit) => sum + (month ? audit.monthly[month]?.cost_thb ?? 0 : audit.annual_cost_thb), 0);
  const hasEnergy = !month || audits.some((audit) => audit.monthly[month]?.surplus_kwh !== null && audit.monthly[month]?.surplus_kwh !== undefined);
  const hasCost = !month || audits.some((audit) => audit.monthly[month]?.cost_thb !== null && audit.monthly[month]?.cost_thb !== undefined);
  const preventable = circuits.filter((circuit) => circuit.classification === "Preventable Waste");
  const preventableValues = preventable.map(loadFor).filter((v): v is number => v !== null);
  const preventableLoad = preventableValues.length ? preventableValues.reduce((sum, value) => sum + value, 0) : null;
  const criticalCount = circuits.filter((circuit) => circuit.classification === "Critical Standby").length;
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  return (
    <Section title="After-hours Load & Waste" aside={<span className="aside">{periodLabel}</span>}>
      <div className="audit-kpi-primary">
        <Stat label="Preventable energy" value={hasEnergy ? kwh(energy) : "Unavailable"} />
        <Stat label="Mean after-hours load" value={n3(totalLoad)} unit="kW" />
      </div>
      <div className="audit-kpi-secondary">
        <Stat label="Cost opportunity" value={hasCost ? thb(cost) : "Unavailable"} unit="excl. VAT" />
        <Stat label="Preventable load" value={n3(preventableLoad)} unit="kW" />
        <Stat label="Preventable circuits" value={String(preventable.length)} />
        <Stat label="Critical standby" value={String(criticalCount)} />
      </div>
    </Section>
  );
}

function EnergyByFloor({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const totals = new Map<number, { energyKwh: number; costThb: number; hasReadings: boolean; coverageWeight: number; circuitWeight: number }>();
  for (const zone of zones) {
    const audit = auditById.get(zone.id);
    if (!audit) continue;
    const total = totals.get(zone.floor) ?? { energyKwh: 0, costThb: 0, hasReadings: false, coverageWeight: 0, circuitWeight: 0 };
    const energy = month ? audit.monthly[month]?.surplus_kwh : audit.annual_surplus_kwh;
    const cost = month ? audit.monthly[month]?.cost_thb : audit.annual_cost_thb;
    if (energy !== null && energy !== undefined) { total.energyKwh += energy; total.hasReadings = true; }
    if (cost !== null && cost !== undefined) total.costThb += cost;
    const coverage = month ? audit.monthly[month]?.energy_coverage_pct ?? 100 : audit.annual_energy_coverage_pct;
    total.coverageWeight += coverage * audit.preventable_count;
    total.circuitWeight += audit.preventable_count;
    totals.set(zone.floor, total);
  }
  const data = [...totals.entries()].sort(([a], [b]) => a - b)
    .map(([floor, total]) => ({
      floor,
      energyKwh: total.hasReadings ? total.energyKwh : null,
      costThb: total.hasReadings ? total.costThb : null,
      coveragePct: total.circuitWeight ? total.coverageWeight / total.circuitWeight : 100,
    }));
  if (!data.length) return null;
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  return (
    <Section title="Preventable Energy by Floor" aside={<span className="aside">{periodLabel} · kWh</span>}>
      <FloorEnergyChart data={data} periodLabel={periodLabel} />
    </Section>
  );
}

function PreventableEnergyByCircuitAndMonth({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const circuits = zones.flatMap((zone) => auditById.get(zone.id)?.circuits ?? [])
    .filter((circuit) => circuit.classification === "Preventable Waste");
  if (!circuits.length) return null;
  return (
    <Section title="Preventable Energy by Circuit and Month" aside={<span className="aside">{circuits.length} circuits · kWh</span>}>
      <CircuitEnergyHeatmap circuits={circuits} selectedMonth={month} />
    </Section>
  );
}

/** Off-from / until pickers and the weekend checkbox, shared by the default and each exception. */
function HoursPicker({ value, onChange, label }: { value: CurfewWindow; onChange: (w: CurfewWindow) => void; label: string }) {
  return (
    <div className="hours-picker">
      <span>Off from</span>
      <select className="mini" aria-label={`${label}: off from`} value={value.start_hour}
        onChange={(e) => onChange({ ...value, start_hour: +e.target.value })}>
        {START_HOURS.map((h) => <option key={h} value={h}>{h}:00</option>)}
      </select>
      <span>until</span>
      <select className="mini" aria-label={`${label}: until`} value={value.end_hour}
        onChange={(e) => onChange({ ...value, end_hour: +e.target.value })}>
        {END_HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
      </select>
      <label className="curfew-weekend compact">
        <input type="checkbox" checked={value.weekends_off} aria-label={`${label}: weekends and holidays off all day`}
          onChange={(e) => onChange({ ...value, weekends_off: e.target.checked })} />
        Weekends &amp; holidays off all day
      </label>
    </div>
  );
}

function exceptionLabel(e: CurfewException, auditById: Map<string, EnergyAuditZone>): string {
  if (!e.zone) return `Floor ${e.floor} (all zones)`;
  const zoneName = zoneUse(e.floor, e.zone)?.name ?? auditById.get(`F${e.floor}:${e.zone}`)?.zone;
  const where = `Floor ${e.floor} · Zone ${e.zone.slice(1)}${zoneName ? ` (${zoneName})` : ""}`;
  return e.circuit ? `${where} · ${e.circuit.replace(/\(kW\)/i, "").replace(/^Floor\d+_/, "")}` : `${where} · all circuits`;
}

/** The whole curfew plan in one place: a building-wide default plus a list of exceptions. */
function CurfewPlan() {
  const { meta, auditById } = useData();
  const month = useStore((s) => s.month);
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);
  const setStart = useStore((s) => s.setAuditStartHour);
  const setEnd = useStore((s) => s.setAuditEndHour);
  const setWeekendsOff = useStore((s) => s.setAuditWeekendsOff);
  const putException = useStore((s) => s.putException);
  const removeException = useStore((s) => s.removeException);
  const resetCurfewPlan = useStore((s) => s.resetCurfewPlan);
  const curfew = useCurfewSettings();
  const def = defaultWindow(curfew);
  const setDefault = (w: CurfewWindow) => {
    setStart(w.start_hour);
    setEnd(w.end_hour);
    setWeekendsOff(w.weekends_off);
  };

  // "Add exception" row, pre-filled from the zone or floor selected on the map
  const floors = meta?.floors ?? [];
  const [addFloor, setAddFloor] = useState<number>(scope.floor ?? floors[0] ?? 1);
  const [addZone, setAddZone] = useState<string>(scope.zone ?? "");
  const [addCircuit, setAddCircuit] = useState<string>("");
  useEffect(() => {
    if (scope.floor === undefined) return;
    setAddFloor(scope.floor);
    setAddZone(scope.zone ?? "");
    setAddCircuit("");
  }, [scope.floor, scope.zone]);
  const zonesOnFloor = meta?.energy_audit.filter((a) => a.floor === addFloor) ?? [];
  const circuitsInZone = zonesOnFloor.find((a) => a.zone === addZone)?.circuits ?? [];
  const newId = exceptionId(addFloor, addZone || undefined, addCircuit || undefined);
  const alreadyListed = curfew.exceptions.some((e) => e.id === newId);
  const addException = () => putException({
    id: newId,
    floor: addFloor,
    zone: addZone || undefined,
    circuit: addCircuit || undefined,
    mode: "hours",
    ...def,
  });

  if (!meta) return null;

  // Everything below follows the page: whole building, one floor, or one zone
  const isBuilding = scope.floor === undefined;
  const isZone = !isBuilding && !!scope.zone;
  const scopeAudits = meta.energy_audit.filter((a) =>
    (isBuilding || a.floor === scope.floor) && (!isZone || a.zone === scope.zone));
  const building = plannedScheduleSavings(meta, {}, month, curfew);
  const shown = isBuilding ? building : plannedScheduleSavings(meta, scope, month, curfew);
  // Two different numbers: the curfew saving is compared with the theoretical maximum a full curfew could save
  // (lights fully off, plugs down to standby), not with the waste above the baseload shown on Today.
  const curfewMaxKwh = scopeAudits.reduce((sum, a) => sum + (month ? a.monthly[month]?.curfew_max_kwh ?? 0 : a.annual_curfew_max_kwh), 0);
  const capturePct = curfewMaxKwh > 0
    ? Math.min(100, Math.round(((shown.energyKwh - shown.beyondRecommendationKwh) / curfewMaxKwh) * 100))
    : 0;
  const relevantExceptions = isBuilding
    ? curfew.exceptions
    : curfew.exceptions.filter((e) => e.floor === scope.floor && (!isZone || !e.zone || e.zone === scope.zone));
  const otherExceptions = curfew.exceptions.length - relevantExceptions.length;
  const allCircuits = scopeAudits.flatMap((a) => a.circuits);
  const circuitById = new Map(meta.energy_audit.flatMap((a) => a.circuits).map((c) => [c.circuit_id, c]));
  const keepOnRecommended = allCircuits.filter((c) => recommendedMode(c) === "keep_on").length;
  const periodLabel = month ? monthLabel(month) : "a year";
  const scopeName = isBuilding ? "Whole building" : isZone ? `Floor ${scope.floor} · Zone ${scope.zone!.slice(1)}` : `Floor ${scope.floor}`;
  const placeWord = isZone ? "zone" : "floor";

  const PRESETS = [
    { label: "17:00–08:00", start: 17, end: 8 },
    { label: "18:00–08:00", start: 18, end: 8 },
    { label: "20:00–07:00", start: 20, end: 7 },
    { label: "19:00–05:00", start: 19, end: 5 },
  ];

  return (
    <Section
      title="Curfew Plan"
      aside={countPlanChanges(curfew) > 0
        ? <button type="button" className="link" onClick={resetCurfewPlan}>Reset to recommendations</button>
        : <span className="aside">{month ? monthLabel(month) : "Jul 2018–Jun 2019"}</span>}
      collapsible
      defaultOpen={true}
    >
      <div className="result">
        <div>
          <span className="stat-label">Energy Saved</span>
          <span className="big">{kwh(shown.energyKwh)}</span>
          <span className="sub">
            {scopeName}, {periodLabel}
            {curfewMaxKwh > 0 ? ` · ${capturePct}% of the theoretical maximum` : " · no preventable waste here"}
            {shown.beyondRecommendationKwh > 0 ? ` · ${kwh(shown.beyondRecommendationKwh)} from circuits the model recommends keeping on` : ""}
          </span>
        </div>
        <div>
          <span className="stat-label">Cost Saved</span>
          <span className="big">{thb(shown.costThb)}</span>
          <span className="sub">MEA TOU tariff, excl. VAT</span>
        </div>
      </div>
      {!isBuilding ? (
        <p className="note curfew-default-summary">
          Building default: <b>{formatWindow(def)}</b>.{" "}
          <button type="button" className="link" onClick={() => select({})}>Change it on the building page</button>
        </p>
      ) : (
      <div className="curfew-control-block">
        <h3 className="glance-h">Default for all circuits</h3>
        <HoursPicker value={def} onChange={setDefault} label="Default" />
        <div className="preset-buttons">
          {PRESETS.map((p) => (
            <button key={p.label} type="button"
              className={def.start_hour === p.start && def.end_hour === p.end ? "preset-btn active" : "preset-btn"}
              onClick={() => setDefault({ ...def, start_hour: p.start, end_hour: p.end })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="curfew-control-block">
        <h3 className="glance-h">
          {isBuilding ? "Exceptions" : isZone ? "Exceptions that apply to this zone" : `Exceptions on Floor ${scope.floor}`} ({relevantExceptions.length})
        </h3>
        {relevantExceptions.length === 0 && (
          <p className="note">
            {isBuilding
              ? "No exceptions. Every circuit follows the default and the model's recommendation."
              : `None. This ${placeWord} follows the building default and the model's recommendation.`}
          </p>
        )}
        <ul className="exception-list">
          {relevantExceptions.map((e) => {
            const circuit = e.circuit ? circuitById.get(e.circuit) : undefined;
            const againstAdvice = circuit && e.mode === "hours" && recommendedMode(circuit) === "keep_on";
            const label = exceptionLabel(e, auditById);
            return (
              <li key={e.id} className="exception-row">
                <div className="exception-head">
                  <b>{label}</b>
                  <select className="mini" aria-label={`${label}: setting`} value={e.mode}
                    onChange={(ev) => putException({ ...e, mode: ev.target.value as CurfewException["mode"] })}>
                    <option value="hours">Off on its own hours</option>
                    <option value="keep_on">Keep on 24/7</option>
                  </select>
                  <button type="button" className="link exception-remove" aria-label={`Remove exception for ${label}`}
                    onClick={() => removeException(e.id)}>✕</button>
                </div>
                {e.mode === "hours" && (
                  <HoursPicker value={e} onChange={(w) => putException({ ...e, ...w })} label={label} />
                )}
                {againstAdvice && (
                  <small className="critical-override-note">
                    ⚠ The model recommends keeping this circuit on. Check with facilities before switching it off.
                  </small>
                )}
              </li>
            );
          })}
        </ul>

        <div className="exception-add">
          {isBuilding && (
          <select className="mini" aria-label="Exception floor" value={addFloor}
            onChange={(e) => { setAddFloor(+e.target.value); setAddZone(""); setAddCircuit(""); }}>
            {floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
          </select>
          )}
          {!isZone && (
          <select className="mini" aria-label="Exception zone" value={addZone}
            onChange={(e) => { setAddZone(e.target.value); setAddCircuit(""); }}>
            <option value="">All zones</option>
            {zonesOnFloor.map((a) => (
              <option key={a.zone} value={a.zone}>Zone {a.zone.slice(1)}</option>
            ))}
          </select>
          )}
          <select className="mini" aria-label="Exception circuit" value={addCircuit} disabled={!addZone}
            onChange={(e) => setAddCircuit(e.target.value)}>
            <option value="">{isZone ? "Whole zone" : "All circuits"}</option>
            {circuitsInZone.map((c) => (
              <option key={c.circuit_id} value={c.circuit_id}>{c.circuit_id.replace(/\(kW\)/i, "").replace(/^Floor\d+_/, "")}</option>
            ))}
          </select>
          <button type="button" className="preset-btn" onClick={addException} disabled={alreadyListed}>
            {alreadyListed ? "Already listed" : isZone ? "+ Add exception for this zone" : isBuilding ? "+ Add exception" : `+ Add exception on Floor ${scope.floor}`}
          </button>
        </div>
        {!isBuilding && otherExceptions > 0 && (
          <p className="note">
            {otherExceptions} more exception{otherExceptions > 1 ? "s" : ""} elsewhere in the building.{" "}
            <button type="button" className="link" onClick={() => select({})}>See all</button>
          </p>
        )}
      </div>

      <p className="note">
        <b>Model recommendations{isBuilding ? "" : ` for this ${placeWord}`}</b> (applied automatically): {keepOnRecommended} circuit{keepOnRecommended === 1 ? "" : "s"} kept on 24/7 as critical standby,{" "}
        {allCircuits.length - keepOnRecommended} off with the default. Floor and zone exceptions only change circuits that are
        off after hours; to switch off a circuit the model recommends keeping on, add an exception for that circuit.
      </p>
    </Section>
  );
}

function ZoneAtAGlance({ audit, measure }: { audit: EnergyAuditZone; measure: MapMeasure }) {
  const month = useStore((s) => s.month);
  const curfew = useCurfewSettings();
  const period = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const isLoad = measure === "audit_load";

  const kwhVal = month ? audit.monthly[month]?.surplus_kwh ?? 0 : audit.annual_surplus_kwh;
  const thbVal = month ? audit.monthly[month]?.cost_thb ?? 0 : audit.annual_cost_thb;
  const unoccMean = month ? audit.monthly[month]?.unocc_mean_kw : audit.unocc_mean_kw;
  const totalBaseload = audit.circuits.reduce((sum, c) => sum + c.baseload_kw, 0);

  const sortedCircuits = [...audit.circuits].sort((a, b) => {
    const aKwh = month ? a.monthly[month]?.surplus_kwh ?? 0 : a.annual_surplus_kwh;
    const bKwh = month ? b.monthly[month]?.surplus_kwh ?? 0 : b.annual_surplus_kwh;
    return bKwh - aKwh;
  });
  const maxKwh = Math.max(...sortedCircuits.map((c) => (month ? c.monthly[month]?.surplus_kwh ?? 0 : c.annual_surplus_kwh)), 1e-9);

  return (
    <Section
      title="Zone Summary"
      aside={<span className="aside">{period}</span>}
      className="glance"
    >
      <div className="stats">
        <Stat
          label="Preventable Waste"
          value={kwh(kwhVal)}
          unit={thb(thbVal)}
          hint="Above P2.5 dynamic baseloads, excl. VAT"
        />
        <Stat
          label="Unoccupied Load"
          value={unoccMean !== null && unoccMean !== undefined ? `${unoccMean.toFixed(2)} kW` : "–"}
          unit={`Baseload ${totalBaseload.toFixed(2)} kW`}
          hint={`Mean across ${audit.circuit_count} circuits`}
        />
      </div>

      <div className="zone-side-popup-chart">
        <h3 className="glance-h">{isLoad ? "Monthly After-Hours Load · kW" : "Monthly Preventable Energy · kWh"}</h3>
        {isLoad
          ? <AfterHoursLoadChart monthly={audit.monthly} selectedMonth={month} baseloadKw={totalBaseload} />
          : <PreventableEnergyChart monthly={audit.monthly} selectedMonth={month} />}
      </div>

      <h3 className="glance-h">Circuits ({audit.circuit_count})</h3>
      <ol className="rank">
        {sortedCircuits.map((c) => {
          const cKwh = month ? c.monthly[month]?.surplus_kwh ?? 0 : c.annual_surplus_kwh;
          const cThb = month ? c.monthly[month]?.cost_thb ?? 0 : c.annual_cost_thb;
          const isCritical = c.classification === "Critical Standby";
          const isTimerLike = !isCritical && (c.behaviour_group ?? "").startsWith("Extended");
          const schedLabel = getCircuitPlanInfo(audit, c, null, month, curfew).setting;
          return (
            <li key={c.circuit_id}>
              <div className="rank-row">
                <span
                  className="rank-name"
                  title={isTimerLike ? "Timer-like after-hours pattern: it may follow an operating rule (e.g. security lighting). If it must stay on, add an exception in the Curfew Plan." : undefined}
                >
                  <b>{c.circuit_id.replace(/\(kW\)/i, "")}</b>
                  <small>{c.classification}{isTimerLike ? " (timer-like)" : ""} · {schedLabel}</small>
                  {isTimerLike && <small className="timer-hint">May follow an operating rule. Add an exception if it must stay on.</small>}
                </span>
                <span className="rank-bar">
                  <i
                    style={{
                      width: `${isCritical ? 100 : (cKwh / maxKwh) * 100}%`,
                      background: isCritical ? "var(--comfy)" : "var(--warm)",
                      opacity: isCritical ? 0.35 : 1,
                    }}
                  />
                </span>
                <span className="rank-val">
                  <b>{isCritical ? "Kept on" : kwh(cKwh)}</b>
                  <small>{isCritical ? `${c.baseload_kw.toFixed(2)} kW base` : thb(cThb)}</small>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export default function QuestionAPanel({ zones, measure, scope, auditZone, detailMeasure, showPlanner }: {
  zones: ZoneInfo[];
  measure: AuditMeasure;
  scope: Scope;
  auditZone?: EnergyAuditZone;
  detailMeasure: MapMeasure;
  showPlanner: boolean;
}) {
  if (showPlanner) {
    return (
      <>
        <CurfewPlan />
        <QuestionAPlan zones={zones} />
      </>
    );
  }

  return (
    <>
      {auditZone ? (
        <ZoneAtAGlance audit={auditZone} measure={detailMeasure || measure} />
      ) : (
        <>
          <AfterHoursLoadReadouts zones={zones} />
          {!scope.floor && <EnergyByFloor zones={zones} />}
          {!!scope.floor && !scope.zone && <PreventableEnergyByCircuitAndMonth zones={zones} />}
        </>
      )}
    </>
  );
}

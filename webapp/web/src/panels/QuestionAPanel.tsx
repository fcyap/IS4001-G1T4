import type { EnergyAuditZone, ZoneInfo } from "../lib/api";
import { AUDIT_CLASS_COLORS } from "../lib/colors";
import { useData } from "../lib/data";
import { kwh, n1, n3 } from "../lib/format";
import { plannedScheduleSavings, recommend } from "../lib/plan";
import { monthLabel, useStore, zoneName, type AuditMeasure, type MapMeasure, type Scope } from "../lib/store";
import { AfterHoursLoadChart, CircuitEnergyHeatmap, FloorEnergyChart, PreventableEnergyChart } from "./Charts";
import { Section, Stat } from "./PanelPrimitives";

function EnergyReadouts({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const audits = zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
  const energy = audits.reduce((n, a) => n + (month ? a.monthly[month]?.surplus_kwh ?? 0 : a.annual_surplus_kwh), 0);
  const cost = audits.reduce((n, a) => n + (month ? a.monthly[month]?.cost_thb ?? 0 : a.annual_cost_thb), 0);
  const hasEnergy = !month || audits.some((a) => a.monthly[month]?.surplus_kwh !== null && a.monthly[month]?.surplus_kwh !== undefined);
  const hasCost = !month || audits.some((a) => a.monthly[month]?.cost_thb !== null && a.monthly[month]?.cost_thb !== undefined);
  const energyCoverage = audits.length ? audits.reduce((n, a) => n + (month ? a.monthly[month]?.energy_coverage_pct ?? 0 : a.annual_energy_coverage_pct) * a.preventable_count, 0) / Math.max(audits.reduce((n, a) => n + a.preventable_count, 0), 1) : 100;
  const preventable = audits.reduce((n, a) => n + a.preventable_count, 0);
  const critical = audits.reduce((n, a) => n + a.critical_count, 0);
  return <>
    <div className="stats">
      <Stat label="Preventable energy opportunity" value={hasEnergy ? kwh(energy) : "Unavailable"} unit={month ? `in ${monthLabel(month)}` : "Jul 2018–Jun 2019"} />
      <Stat label="Estimated cost opportunity (excl. VAT)" value={hasCost ? `฿${Math.round(cost).toLocaleString("en-US")}` : "Unavailable"} unit={month ? `in ${monthLabel(month)}` : "Jul 2018–Jun 2019"} />
      <Stat label="Preventable circuits" value={String(preventable)} />
      <Stat label="Critical standby circuits" value={String(critical)} />
    </div>
    <p className="note">Preventable energy is accumulated surplus above circuit baselines, measured in kWh. {month ? `Energy uses recorded after-hours readings in ${monthLabel(month)}; cost uses the peak/off-peak tariff and excludes VAT.` : "Annual totals sum the recorded clean baseline period, Jul 2018–Jun 2019, using the same hourly data as the monthly view. Cost excludes VAT."} Critical standby loads are excluded.{energyCoverage < 99.9 && ` Coverage is ${energyCoverage.toFixed(1)}%; the displayed total includes observed readings only.`}</p>
  </>;
}

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
  const circuitCount = audits.reduce((sum, audit) => sum + audit.circuit_count, 0);
  const loadCoverage = circuitCount
    ? audits.reduce((sum, audit) => sum + (month ? audit.monthly[month]?.load_coverage_pct ?? 0 : audit.annual_load_coverage_pct) * audit.circuit_count, 0) / circuitCount
    : 100;
  const periodLabel = month ? monthLabel(month) : "Clean-year average · Jul 2018–Jun 2019";
  return <>
    <Section title="After-hours Load" aside={<span className="aside">{periodLabel}</span>}>
      <div className="audit-kpi-primary">
        <Stat label="Preventable energy" value={hasEnergy ? kwh(energy) : "Unavailable"} unit={month ? monthLabel(month) : "Annual total"} />
        <Stat label="Mean after-hours load" value={n3(totalLoad)} unit="kW · average unoccupied power" />
      </div>
      <div className="audit-kpi-secondary">
        <Stat label="Cost opportunity" value={hasCost ? `฿${Math.round(cost).toLocaleString("en-US")}` : "Unavailable"} unit="excl. VAT" />
        <Stat label="Preventable circuit load" value={n3(preventableLoad)} unit="kW" />
        <Stat label="Preventable circuits" value={String(preventable.length)} />
        <Stat label="Critical standby" value={String(criticalCount)} />
      </div>
      <p className="note">Energy is accumulated excess (kWh); load is average unoccupied power (kW). Critical standby circuits are excluded from preventable totals.{loadCoverage < 99.9 ? ` Coverage: ${loadCoverage.toFixed(1)}%.` : " Coverage is complete."}</p>
    </Section>
  </>;
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
    .map(([floor, total]) => ({ floor, energyKwh: total.hasReadings ? total.energyKwh : null, costThb: total.hasReadings ? total.costThb : null,
      coveragePct: total.circuitWeight ? total.coverageWeight / total.circuitWeight : 100 }));
  if (!data.length) return null;
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  return <Section title="Preventable Energy by Floor" aside={<span className="aside">{periodLabel} · kWh</span>}>
    <FloorEnergyChart data={data} periodLabel={periodLabel} />
    <p className="note">Bars show observed preventable energy; hover for estimated cost, excluding VAT. The chart follows the selected Period. Annual values cover Jul 2018–Jun 2019.</p>
  </Section>;
}

function PreventableEnergyByCircuitAndMonth({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const circuits = zones.flatMap((zone) => auditById.get(zone.id)?.circuits ?? [])
    .filter((circuit) => circuit.classification === "Preventable Waste");
  if (!circuits.length) return null;
  return <Section title="Preventable Energy by Circuit and Month" aside={<span className="aside">{circuits.length} preventable circuits · kWh</span>}>
    <CircuitEnergyHeatmap circuits={circuits} selectedMonth={month} />
    <p className="note">Each cell shows recorded monthly preventable energy for one circuit. Blank cells indicate missing meter readings; the selected Period is outlined. Critical standby circuits are excluded.</p>
  </Section>;
}

function AuditSavings() {
  const { meta } = useData();
  const month = useStore((s) => s.month);
  const scope = useStore((s) => s.scope);
  const scopeNavigationCount = useStore((s) => s.scopeNavigationCount);
  const select = useStore((s) => s.select);
  const cutoff = useStore((s) => s.auditCutoffHour);
  const setCutoff = useStore((s) => s.setAuditCutoffHour);
  const scopeLabel = scope.zone ? `Floor ${scope.floor} · ${zoneName(scope.zone)}` : scope.floor ? `Floor ${scope.floor}` : "Whole Building";
  const estimateFor = (selectedScope: Scope) => meta ? plannedScheduleSavings(meta, selectedScope, cutoff, month) : null;
  const estimate = estimateFor(scope);
  const parentScopes = scope.zone
    ? [{ label: `Floor ${scope.floor}`, target: { floor: scope.floor } }, { label: "Whole building", target: {} }]
    : scope.floor ? [{ label: "Whole building", target: {} }] : [];
  const parentScenarios = parentScopes.map(({ label, target }) => {
    const values = estimateFor(target);
    return { label, target, energy: values?.energyKwh, cost: values?.costThb };
  });
  const breakdownRows = scope.floor
    ? (meta?.zones.filter((zone) => zone.floor === scope.floor) ?? []).map((zone) => {
      const values = estimateFor({ floor: zone.floor, zone: zone.zone });
      return { key: zone.id, label: zoneName(zone.zone), selected: scope.zone === zone.zone,
        energy: values?.energyKwh, cost: values?.costThb,
        onClick: () => select({ floor: zone.floor, zone: zone.zone }) };
    })
    : Array.from({ length: 7 }, (_, index) => {
      const floor = index + 1;
      const values = estimateFor({ floor });
      return { key: `F${floor}`, label: `Floor ${floor}`, selected: false,
        energy: values?.energyKwh, cost: values?.costThb,
        onClick: () => select({ floor }) };
    });
  const breakdownTitle = scope.floor ? `Estimated savings by zone · Floor ${scope.floor}` : "Estimated savings by floor";
  const energy = estimate?.energyKwh;
  const cost = estimate?.costThb;
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const timeLabel = (hour: number) => `${String(hour >= 24 ? hour - 24 : hour).padStart(2, "0")}:00${hour >= 24 ? " next day" : ""}`;

  return (
    <Section title="After-hours Schedule What-if" aside={<span className="aside">{scopeLabel} · {periodLabel}</span>} collapsible defaultOpen={scopeNavigationCount > 0}>
      <p className="note">Set the weekday switch-off time for lighting and plug circuits classified as preventable in the selected scope. The same time carries across the building, floor, and zone views, with related scope savings shown below. Estimates use historical hourly load above each circuit’s time-of-week baseline and the Recommended Plan’s cut rate for each space; critical standby circuits stay on. Weekend and holiday unoccupied hours are included.</p>
      <label className="slider schedule-slider">
        <span>Switch-off time <b>{timeLabel(cutoff)}</b></span>
        <input type="range" min={17} max={30} step={1} value={cutoff}
          aria-label={`Weekday after-hours switch-off time for ${scopeLabel}`}
          onChange={(e) => setCutoff(+e.target.value)} />
        <span className="slider-ends"><span>17:00</span><span>06:00 next day</span></span>
      </label>
      <div className="result">
        <div>
          <span className="stat-label">Estimated energy savings</span>
          <span className="big">{energy === undefined ? "Unavailable" : kwh(energy)}</span>
          <span className="sub">{periodLabel} · {scopeLabel.toLowerCase()}</span>
        </div>
        <div>
          <span className="stat-label">Estimated cost savings</span>
          <span className="big">{cost === undefined ? "Unavailable" : `฿${Math.round(cost).toLocaleString("en-US")}`}</span>
          <span className="sub">THB · excludes VAT</span>
        </div>
      </div>
      {parentScenarios.length > 0 && <div className="schedule-scope-rollup" aria-label="Related scope savings at the same switch-off time">
        {parentScenarios.map((row) => <button key={row.label} type="button" onClick={() => select(row.target)}>
          <span>{row.label} at {timeLabel(cutoff)}</span>
          <b>{row.energy === undefined ? "Unavailable" : kwh(row.energy)}</b>
          <small><span>Cost savings</span><b>{row.cost === undefined ? "Unavailable" : `฿${Math.round(row.cost).toLocaleString("en-US")}`}</b></small>
        </button>)}
      </div>}
      <div className="schedule-scope-breakdown">
        <h3>{breakdownTitle}</h3>
        <div>
          {breakdownRows.map((row) => <button key={row.key} type="button"
            className={row.selected ? "active" : ""} aria-pressed={row.selected}
            onClick={row.onClick}>
            <span>{row.label}</span>
            <b>{row.energy === undefined ? "Unavailable" : kwh(row.energy)}</b>
            <small><span>Cost savings</span><b>{row.cost === undefined ? "Unavailable" : `฿${Math.round(row.cost).toLocaleString("en-US")}`}</b></small>
          </button>)}
        </div>
      </div>
      <p className="note">This is a historical estimate of preventable surplus from the selected switch-off time through the unoccupied period. It assumes eligible circuits are scheduled down to their measured baselines; it does not send commands to building equipment.</p>
    </Section>
  );
}

function ZoneRecommendation({ audit }: { audit: EnergyAuditZone }) {
  const rec = recommend(audit);
  return <Section title={`${zoneName(audit.zone)} recommendation`}
    aside={<span className="aside">{rec.rate ? `${rec.rate}% cut` : "Keep on"}</span>}>
    <p className="note">{rec.action}</p>
    <p className="note">This is a rule-based recommendation using the zone type and circuit labels. Estimated savings update with the schedule time above.</p>
  </Section>;
}

function AuditZonePopup({ audit, measure }: { audit: EnergyAuditZone; measure: MapMeasure }) {
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.select);
  const isLoad = measure === "audit_load";
  const isCost = measure === "audit_cost";
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const circuitBaseload = audit.circuits.reduce((sum, circuit) => sum + circuit.baseload_kw, 0);
  const energy = month ? audit.monthly[month]?.surplus_kwh ?? null : audit.annual_surplus_kwh;
  const cost = month ? audit.monthly[month]?.cost_thb ?? null : audit.annual_cost_thb;
  return (
    <Section title={`${zoneName(audit.zone)} · ${measure === "audit_classification" ? "Waste Status" : "After-hours Load"}`} aside={
      <button className="link" onClick={() => select({ floor: audit.floor })}>Close</button>
    }>
      <div className="zone-side-popup">
        <div className="zone-side-popup-summary">
          <span className="badge" style={{ color: AUDIT_CLASS_COLORS[audit.classification], borderColor: AUDIT_CLASS_COLORS[audit.classification] }}>{audit.classification}</span>
          <span>{audit.circuit_count} audited circuits · {periodLabel}</span>
          <b>{isLoad
            ? `${n1(month ? audit.monthly[month]?.unocc_mean_kw : audit.unocc_mean_kw)} kW after-hours load`
            : isCost ? `฿${cost === null ? "–" : Math.round(cost).toLocaleString("en-US")} cost opportunity (excl. VAT)` : `${kwh(energy)} preventable energy`}</b>
        </div>
        <div className="zone-side-popup-chart">
          <h3>{isLoad ? "Monthly after-hours load · kW" : "Monthly preventable energy · kWh"}</h3>
          {isLoad
            ? <AfterHoursLoadChart monthly={audit.monthly} selectedMonth={month} baselineKw={circuitBaseload} />
            : <PreventableEnergyChart monthly={audit.monthly} selectedMonth={month} />}
          <div className="zone-side-popup-chart-note">{isLoad
            ? <>Bars show mean load; the dashed line marks the combined circuit baseload. Hover for readings and coverage. Missing months are left blank. {month ? `${monthLabel(month)} is highlighted.` : "Select a month to highlight it."}</>
            : <>Bars show preventable kWh; hover for estimated cost excluding VAT. Missing readings are left blank. {month ? `${monthLabel(month)} is highlighted.` : "Select a month to highlight it."}</>}</div>
        </div>
        <div className="zone-side-popup-circuits">
          {audit.circuits.map((circuit) => {
            const circuitEnergy = month ? circuit.monthly[month]?.surplus_kwh ?? null : circuit.annual_surplus_kwh;
            const circuitCost = month ? circuit.monthly[month]?.cost_thb ?? null : circuit.annual_cost_thb;
            const circuitLoad = month ? circuit.monthly[month]?.unocc_mean_kw ?? null : circuit.unocc_mean_kw;
            return <div className="zone-side-popup-circuit" key={circuit.circuit_id}>
              <div><strong>{circuit.circuit_id}</strong><span className="zone-popup-badge" style={{ color: AUDIT_CLASS_COLORS[circuit.classification] }}>{circuit.classification}</span></div>
              <small>{circuit.type} · {isLoad ? circuitLoad === null ? "No readings" : `${n1(circuitLoad)} kW after-hours` : isCost ? circuitCost === null ? "No readings" : `฿${Math.round(circuitCost).toLocaleString("en-US")} excl. VAT` : `${kwh(circuitEnergy)} preventable`}</small>
            </div>;
          })}
        </div>
      </div>
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
  return <>
    {measure === "audit_load" && showPlanner && auditZone && <ZoneRecommendation audit={auditZone} />}
    {measure === "audit_load" && !showPlanner && <AfterHoursLoadReadouts zones={zones} />}
    {measure !== "audit_load" && <EnergyReadouts zones={zones} />}
    {measure === "audit_load" && showPlanner && <AuditSavings />}
    {measure === "audit_load" && !showPlanner && !scope.floor && <EnergyByFloor zones={zones} />}
    {measure === "audit_load" && !showPlanner && !!scope.floor && <PreventableEnergyByCircuitAndMonth zones={zones} />}
    {auditZone && !showPlanner && <AuditZonePopup audit={auditZone} measure={detailMeasure} />}
  </>;
}

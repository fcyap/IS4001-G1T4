import { useState } from "react";
import type { EnergyAuditZone, ZoneInfo } from "../lib/api";
import { AUDIT_CLASS_COLORS } from "../lib/colors";
import { useData } from "../lib/data";
import { kwh, n1, n3 } from "../lib/format";
import { recommend } from "../lib/plan";
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

function AuditClassificationMethod() {
  return <details className="audit-method">
    <summary>How circuit labels are assigned</summary>
    <p>The notebook’s K-means model groups circuits using three operating-pattern measures: unoccupied-to-occupied load ratio, the 2.5th-percentile standby baseline, and variability during unoccupied hours.</p>
    <p><b>Preventable Waste</b> identifies schedule-responsive loads that may be reduced with a curfew. <b>Critical Standby</b> identifies stable, continuous loads to protect. These are operational categories, not confirmed equipment faults.</p>
  </details>;
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

function AuditSavings({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const month = useStore((s) => s.month);
  const scope = useStore((s) => s.scope);
  const [selectedCircuitIds, setSelectedCircuitIds] = useState<string[] | null>(null);
  const [circuitPickerFloor, setCircuitPickerFloor] = useState<number | "all">("all");
  const captureRates = useStore((s) => s.auditCaptureRates);
  const setCaptureRate = useStore((s) => s.setAuditCaptureRate);
  const setCaptureRates = useStore((s) => s.setAuditCaptureRates);
  const audits = zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
  const scenarioCircuits = audits.flatMap((audit) => audit.circuits
    .filter((circuit) => circuit.classification === "Preventable Waste")
    .map((circuit) => ({ circuit, floor: audit.floor, zone: audit.zone })));
  const allPreventableCircuits = scenarioCircuits.map(({ circuit }) => circuit);
  const circuitFloors = [...new Set(scenarioCircuits.map(({ floor }) => floor))].sort((a, b) => a - b);
  const visibleScenarioCircuits = scenarioCircuits.filter(({ floor }) => circuitPickerFloor === "all" || floor === circuitPickerFloor);
  const selectedCircuitSet = new Set(selectedCircuitIds ?? allPreventableCircuits.map((circuit) => circuit.circuit_id));
  const selectedPreventableCircuits = allPreventableCircuits.filter((circuit) => selectedCircuitSet.has(circuit.circuit_id));
  const rateFor = (a: EnergyAuditZone) => captureRates[a.id] ?? recommend(a).rate;   // starts from the recommended plan
  const zoneScenario = (a: EnergyAuditZone, rate: number) => {
    const fraction = rate / 100;
    const periodFor = (c: EnergyAuditZone["circuits"][number]) => month ? c.monthly?.[month] : null;
    const preventableCircuits = a.circuits.filter((c) => c.classification === "Preventable Waste" && selectedCircuitSet.has(c.circuit_id));
    // Use the selected circuit rows for both monthly and annual views. Zone-level
    // annual totals include every preventable circuit, including unchecked ones.
    const energyValues = month
      ? preventableCircuits.map((c) => periodFor(c)?.surplus_kwh ?? null).filter((v): v is number => v !== null)
      : preventableCircuits.map((c) => c.annual_surplus_kwh);
    const costValues = month
      ? preventableCircuits.map((c) => periodFor(c)?.cost_thb ?? null).filter((v): v is number => v !== null)
      : preventableCircuits.map((c) => c.annual_cost_thb);
    if (preventableCircuits.length === 0) { energyValues.push(0); costValues.push(0); }
    const energy = energyValues.length ? energyValues.reduce((sum, value) => sum + value, 0) : null;
    const cost = costValues.length ? costValues.reduce((sum, value) => sum + value, 0) : null;
    const measuredCircuits = preventableCircuits.filter((c) => (month ? c.monthly?.[month]?.unocc_mean_kw : c.unocc_mean_kw) !== null && (month ? c.monthly?.[month]?.unocc_mean_kw : c.unocc_mean_kw) !== undefined);
    const loads = measuredCircuits.map((c) => month ? c.monthly?.[month]?.unocc_mean_kw ?? 0 : c.unocc_mean_kw ?? 0);
    const currentLoad = preventableCircuits.length === 0 ? 0 : loads.length ? loads.reduce((sum, value) => sum + value, 0) : null;
    const baselineLoad = preventableCircuits.length === 0 ? 0 : measuredCircuits.length ? measuredCircuits.reduce((sum, c) => sum + c.baseload_kw, 0) : null;
    const reducibleLoad = measuredCircuits.reduce((sum, c) => {
      const period = periodFor(c);
      const surplus = month ? period?.surplus_kwh : c.annual_surplus_kwh;
      const hours = month ? period?.unocc_hours : c.annual_unocc_hours;
      return sum + (surplus !== null && surplus !== undefined && hours ? surplus / hours : 0);
    }, 0);
    const projectedLoad = baselineLoad === null || currentLoad === null ? null : currentLoad - reducibleLoad * fraction;
    return { energy: energy === null ? null : energy * fraction, cost: cost === null ? null : cost * fraction, currentLoad, projectedLoad, baselineLoad };
  };
  const rates = audits.map(rateFor);
  const scopeRate = rates.length && rates.every((rate) => rate === rates[0]) ? rates[0] : null;
  const sliderRate = scopeRate ?? (rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length * 10) / 10 : 50);
  const rateText = (rate: number) => `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
  const eligibleAudits = audits.filter((audit) => audit.preventable_count > 0);
  const selectedPreset = eligibleAudits.length && eligibleAudits.every((audit) => rateFor(audit) === rateFor(eligibleAudits[0]))
    ? rateFor(eligibleAudits[0]) : null;
  const scenario = audits.reduce((total, audit) => {
    const values = zoneScenario(audit, rateFor(audit));
    if (values.energy !== null) { total.energy += values.energy; total.hasAnyEnergy = true; }
    if (values.cost !== null) { total.cost += values.cost; total.hasAnyCost = true; }
    if (values.currentLoad !== null) { total.currentLoad += values.currentLoad; total.hasAnyLoad = true; }
    if (values.projectedLoad !== null && values.baselineLoad !== null) {
      total.baselineAvailable = true;
      total.projectedLoad += values.projectedLoad;
      total.baselineLoad += values.baselineLoad;
    }
    return total;
  }, { energy: 0, cost: 0, currentLoad: 0, projectedLoad: 0, baselineLoad: 0, baselineAvailable: false, hasAnyEnergy: false, hasAnyCost: false, hasAnyLoad: false });
  const availableEnergyValues = audits.map((audit) => zoneScenario(audit, 100).energy).filter((value): value is number => value !== null);
  const availableEnergy = availableEnergyValues.reduce((sum, value) => sum + value, 0);
  const energyUnitScale = availableEnergy >= 1000 ? 1000 : 1;
  const energyUnit = energyUnitScale === 1000 ? "MWh" : "kWh";
  const remainingEnergy = Math.max(availableEnergy - scenario.energy, 0);
  const preventableCircuits = selectedPreventableCircuits;
  const expectedEnergyHours = preventableCircuits.reduce((sum, circuit) => sum + (month
    ? circuit.monthly?.[month]?.expected_unocc_hours ?? 0 : circuit.annual_expected_unocc_hours), 0);
  const observedEnergyHours = preventableCircuits.reduce((sum, circuit) => sum + (month
    ? circuit.monthly?.[month]?.unocc_hours ?? 0 : circuit.annual_unocc_hours), 0);
  const energyCoverage = expectedEnergyHours ? 100 * observedEnergyHours / expectedEnergyHours : 100;
  const hasScenarioData = preventableCircuits.some((circuit) => month
    ? (circuit.monthly?.[month]?.unocc_hours ?? 0) > 0
    : circuit.annual_unocc_hours > 0);
  const applyScenario = (rate: number) => audits.forEach((audit) => setCaptureRate(audit.id, audit.preventable_count > 0 ? rate : 0));
  const toggleCircuit = (circuitId: string) => {
    const next = new Set(selectedCircuitSet);
    if (next.has(circuitId)) next.delete(circuitId); else next.add(circuitId);
    setSelectedCircuitIds(next.size === allPreventableCircuits.length ? null : [...next]);
  };
  const applyEnergyTarget = (targetInDisplayUnits: number) => {
    const targetKwh = Math.max(0, Math.min(availableEnergy, targetInDisplayUnits * energyUnitScale));
    const captureRate = availableEnergy > 0 ? Math.round((availableEnergy - targetKwh) / availableEnergy * 1000) / 10 : 0;
    setCaptureRates(audits.map((audit) => audit.id), captureRate);
  };
  const scopeLabel = scope.zone ? `Floor ${scope.floor}, ${zoneName(scope.zone)}` : scope.floor ? `Floor ${scope.floor}` : "Whole Building";

  return (
    <Section title="Preventable Waste Savings Planner" aside={<span className="aside">{scopeLabel} · {month ? monthLabel(month) : "Jul 2018–Jun 2019"}</span>}>
      <p className="note">This starts from the recommended plan. Choose how much preventable after-hours load to bring toward its circuit baseline. Energy, cost, and projected load update as you adjust the capture rate.{energyCoverage < 99.9 ? ` Meter coverage for this scope and period is ${energyCoverage.toFixed(1)}%; savings include observed readings only.` : " Meter coverage is complete for this scope and period."}</p>
      <div className="capture-scenarios" role="group" aria-label="Preventable energy capture scenarios">
        <span className="capture-scenarios-label">Share of estimated preventable energy captured</span>
        {[
          { rate: 50, label: "Conservative", detail: "Capture half" },
          { rate: 75, label: "Moderate", detail: "Capture three-quarters" },
          { rate: 100, label: "Full capture", detail: "Capture all" },
        ].map(({ rate, label, detail }) => <button key={rate} type="button" className={`capture-scenario${selectedPreset === rate ? " active" : ""}`}
          aria-pressed={selectedPreset === rate} disabled={!hasScenarioData} onClick={() => applyScenario(rate)}>
          <span>{label}</span><b>{rate}%</b><small>{detail} of estimated surplus</small>
        </button>)}
      </div>
      <label className="slider">
        <span>{scope.zone ? `Capture in ${scopeLabel}` : "Apply to this scope"} <b>{scopeRate === null ? `Mixed rates · set all to ${rateText(sliderRate)}` : rateText(scopeRate)}</b></span>
        <input type="range" min={0} max={100} step={0.1} value={sliderRate} disabled={!hasScenarioData}
          aria-label={`Capture rate for ${scopeLabel}; changing it applies the same rate to all included zones`}
          onChange={(e) => setCaptureRates(audits.map((audit) => audit.id), +e.target.value)} />
      </label>
      <label className="target-energy">
        <span>Preventable energy to leave on</span>
        <span className="target-energy-input"><input type="number" min={0} max={availableEnergy / energyUnitScale} step="0.1"
          value={hasScenarioData ? (remainingEnergy / energyUnitScale).toFixed(1) : ""} disabled={!hasScenarioData}
          aria-label={`Target preventable energy to leave on in ${energyUnit}`}
          onChange={(e) => { if (e.target.value !== "") applyEnergyTarget(+e.target.value); }} /><b>{energyUnit}</b></span>
        <small>Current scope has {kwh(availableEnergy)} of preventable energy. Savings are calculated from the difference; the audit figures above remain the baseline.</small>
      </label>
      <details className="scenario-circuit-picker">
        <summary>Circuits in scenario <b>{selectedPreventableCircuits.length} of {allPreventableCircuits.length}</b></summary>
        <p>Choose which preventable circuits to include. Critical standby circuits stay excluded.</p>
        <div className="scenario-floor-tabs" role="tablist" aria-label="Filter scenario circuits by floor">
          <button type="button" role="tab" aria-selected={circuitPickerFloor === "all"} className={circuitPickerFloor === "all" ? "active" : ""} onClick={() => setCircuitPickerFloor("all")}>All floors</button>
          {circuitFloors.map((floor) => <button key={floor} type="button" role="tab" aria-selected={circuitPickerFloor === floor}
            className={circuitPickerFloor === floor ? "active" : ""} onClick={() => setCircuitPickerFloor(floor)}>Floor {floor}</button>)}
        </div>
        <div className="scenario-circuit-list">
          {visibleScenarioCircuits.map(({ circuit, floor, zone }) => {
            const period = month ? circuit.monthly?.[month] : null;
            const energy = month ? period?.surplus_kwh : circuit.annual_surplus_kwh;
            const label = month ? monthLabel(month) : "Jul 2018–Jun 2019";
            return <label key={circuit.circuit_id} className="scenario-circuit-option">
              <input type="checkbox" checked={selectedCircuitSet.has(circuit.circuit_id)} onChange={() => toggleCircuit(circuit.circuit_id)} />
              <span><b>{circuit.circuit_id}</b><small>Floor {floor} · {zoneName(zone)} · {energy === null || energy === undefined ? `No energy readings · ${label}` : `${kwh(energy)} preventable · ${label}`}</small></span>
            </label>;
          })}
        </div>
        {selectedCircuitIds !== null && <button type="button" className="link" onClick={() => setSelectedCircuitIds(null)}>Select all {allPreventableCircuits.length} circuits</button>}
      </details>
      <div className="result">
        <div>
          <span className="stat-label">Estimated Energy Savings</span>
          <span className="big">{scenario.hasAnyEnergy ? kwh(scenario.energy) : "Unavailable"}</span>
          <span className="sub">{month ? `in ${monthLabel(month)}` : "Jul 2018–Jun 2019"}</span>
        </div>
        <div>
          <span className="stat-label">Estimated Cost Savings (excl. VAT)</span>
          <span className="big">{scenario.hasAnyCost ? `฿${Math.round(scenario.cost).toLocaleString("en-US")}` : "Unavailable"}</span>
          <span className="sub">{month ? `in ${monthLabel(month)}` : "Jul 2018–Jun 2019"}</span>
        </div>
      </div>
      <div className="audit-sim-loads">
        <span>Current load <b>{scenario.hasAnyLoad ? `${n3(scenario.currentLoad)} kW` : "Unavailable"}</b></span>
        <span>Projected load <b>{scenario.baselineAvailable ? `${n3(scenario.projectedLoad)} kW` : "Unavailable"}</b></span>
        <span>Baseline target <b>{scenario.baselineAvailable ? `${n3(scenario.baselineLoad)} kW` : "Unavailable"}</b></span>
      </div>
    </Section>
  );
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
    {measure === "audit_load" ? <AfterHoursLoadReadouts zones={zones} /> : <EnergyReadouts zones={zones} />}
    {measure === "audit_load" && <AuditClassificationMethod />}
    {measure === "audit_load" && showPlanner && <AuditSavings zones={zones} />}
    {measure === "audit_load" && !showPlanner && !scope.floor && <EnergyByFloor zones={zones} />}
    {measure === "audit_load" && !showPlanner && !!scope.floor && <PreventableEnergyByCircuitAndMonth zones={zones} />}
    {auditZone && !showPlanner && <AuditZonePopup audit={auditZone} measure={detailMeasure} />}
  </>;
}

import type { EnergyAuditZone, ZoneInfo } from "../lib/api";
import { AUDIT_CLASS_COLORS } from "../lib/colors";
import { useData } from "../lib/data";
import { kwh, n1, n3 } from "../lib/format";
import { plannedScheduleSavings } from "../lib/plan";
import { monthLabel, useStore, zoneName, type AuditMeasure, type MapMeasure, type Scope } from "../lib/store";
import { zoneUse } from "../lib/zones";
import { AfterHoursLoadChart, CircuitEnergyHeatmap, FloorEnergyChart, PreventableEnergyChart } from "./Charts";
import { Section, Stat } from "./PanelPrimitives";
import QuestionAPlan from "./QuestionAPlan";

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
  const { meta, auditById } = useData();
  const month = useStore((s) => s.month);
  const scope = useStore((s) => s.scope);
  const scopeNavigationCount = useStore((s) => s.scopeNavigationCount);
  const select = useStore((s) => s.select);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const setStartHour = useStore((s) => s.setAuditStartHour);
  const setEndHour = useStore((s) => s.setAuditEndHour);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);
  const toggleCircuitExemption = useStore((s) => s.toggleCircuitExemption);
  const resetCircuitExemptions = useStore((s) => s.resetCircuitExemptions);

  const scopeLabel = scope.zone ? `Floor ${scope.floor} · ${zoneName(scope.zone)}` : scope.floor ? `Floor ${scope.floor}` : "Whole Building";
  const estimateFor = (selectedScope: Scope) => meta ? plannedScheduleSavings(meta, selectedScope, startHour, endHour, month, circuitExemptions) : null;
  const estimate = estimateFor(scope);

  const isWholeBuilding = scope.floor === undefined;
  const isFloor = scope.floor !== undefined && !scope.zone;
  const isZone = !!scope.zone;

  const currentAudits = isZone && scope.floor && scope.zone
    ? [auditById.get(`F${scope.floor}:${scope.zone}`)].filter((a): a is EnergyAuditZone => !!a)
    : isFloor && scope.floor
      ? meta?.energy_audit.filter((a) => a.floor === scope.floor) ?? []
      : meta?.energy_audit ?? [];

  const totalPreventableKwh = currentAudits.reduce((sum, a) => sum + (month ? a.monthly[month]?.surplus_kwh ?? 0 : a.annual_surplus_kwh), 0);
  const capturePct = totalPreventableKwh > 0 && estimate?.energyKwh !== undefined
    ? Math.min(100, Math.round((estimate.energyKwh / totalPreventableKwh) * 100))
    : 0;

  const energy = estimate?.energyKwh;
  const cost = estimate?.costThb;
  const periodLabel = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const windowDuration = ((24 - startHour) + endHour).toFixed(0);

  const PRESETS = [
    { label: "Standard (18:00–08:00)", start: 18, end: 8 },
    { label: "Strict (17:00–08:00)", start: 17, end: 8 },
    { label: "Night Shift (20:00–07:00)", start: 20, end: 7 },
    { label: "Early Crew (19:00–05:00)", start: 19, end: 5 },
  ];

  // Breakdown for whole building (by floor)
  const floorBreakdown = isWholeBuilding
    ? Array.from({ length: 7 }, (_, i) => {
        const floor = i + 1;
        const val = estimateFor({ floor });
        return {
          floor,
          energy: val?.energyKwh ?? 0,
          cost: val?.costThb ?? 0,
          pct: energy && energy > 0 ? Math.round(((val?.energyKwh ?? 0) / energy) * 100) : 0,
        };
      }).sort((a, b) => b.cost - a.cost)
    : [];

  // Breakdown for floor (by zone)
  const zoneBreakdown = isFloor
    ? (meta?.zones.filter((z) => z.floor === scope.floor) ?? []).map((z) => {
        const val = estimateFor({ floor: z.floor, zone: z.zone });
        return {
          id: z.id,
          name: zoneName(z.zone),
          floor: z.floor,
          zone: z.zone,
          energy: val?.energyKwh ?? 0,
          cost: val?.costThb ?? 0,
          pct: energy && energy > 0 ? Math.round(((val?.energyKwh ?? 0) / energy) * 100) : 0,
        };
      }).sort((a, b) => b.cost - a.cost)
    : [];

  const parentScopes = isZone
    ? [{ label: `Floor ${scope.floor}`, target: { floor: scope.floor } }, { label: "Whole building", target: {} }]
    : isFloor ? [{ label: "Whole building", target: {} }] : [];

  const parentScenarios = parentScopes.map(({ label, target }) => {
    const values = estimateFor(target);
    return { label, target, energy: values?.energyKwh, cost: values?.costThb };
  });

  const zoneAudit = isZone && scope.floor && scope.zone ? auditById.get(`F${scope.floor}:${scope.zone}`) : undefined;
  const exemptedCount = Object.keys(circuitExemptions).filter((id) => circuitExemptions[id]).length;

  return (
    <Section
      title={isWholeBuilding ? "After-Hours Curfew Simulator" : `After-Hours Simulation · ${scopeLabel}`}
      aside={<span className="aside">{periodLabel}</span>}
      collapsible
      defaultOpen={scopeNavigationCount > 0}
    >
      {/* 1. TIMING CONTROLS (Only at Whole-Building Level) */}
      {isWholeBuilding ? (
        <div className="curfew-control-block">
          <div className="curfew-window-badge">
            <span className="curfew-window-pill">Curfew Window: <b>{startHour}:00 → 0{endHour}:00 next day</b> ({windowDuration} hrs off/day)</span>
          </div>

          <div className="curfew-dual-sliders">
            <label className="slider">
              <div className="slider-label-row">
                <span>1. Curfew Start (Evening):</span>
                <b>{startHour}:00</b>
              </div>
              <input
                type="range"
                min={17}
                max={23}
                step={1}
                value={startHour}
                aria-label="Curfew evening start hour"
                onChange={(e) => setStartHour(+e.target.value)}
              />
              <span className="slider-ends"><span>17:00 (5 PM)</span><span>23:00 (11 PM)</span></span>
            </label>

            <label className="slider">
              <div className="slider-label-row">
                <span>2. Curfew End (Morning):</span>
                <b>0{endHour}:00</b>
              </div>
              <input
                type="range"
                min={5}
                max={8}
                step={1}
                value={endHour}
                aria-label="Curfew morning end hour"
                onChange={(e) => setEndHour(+e.target.value)}
              />
              <span className="slider-ends"><span>05:00 (5 AM)</span><span>08:00 (8 AM)</span></span>
            </label>
          </div>

          <div className="curfew-presets">
            <small>Quick Presets:</small>
            <div className="preset-buttons">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={startHour === p.start && endHour === p.end ? "preset-btn active" : "preset-btn"}
                  onClick={() => { setStartHour(p.start); setEndHour(p.end); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            Curfew window applies building-wide. During this period, automated BEMS sweeps de-energize preventable office lighting and plug circuits down to standby. Critical standby loads (Server Rooms, Plant) remain powered 24/7.
          </p>
        </div>
      ) : (
        <div className="curfew-locked-badge">
          <span>🕒 Building Curfew Window: <b>{startHour}:00 – 0{endHour}:00</b> ({windowDuration} hrs off)</span>
          <button type="button" className="link" onClick={() => select({})}>Adjust at Building Level ↑</button>
        </div>
      )}

      {/* 2. SAVINGS HERO CARD */}
      <div className="result" style={{ marginTop: 12 }}>
        <div>
          <span className="stat-label">Estimated Energy Saved</span>
          <span className="big">{energy === undefined ? "Unavailable" : kwh(energy)}</span>
          <span className="sub">{capturePct}% of avoidable waste captured</span>
        </div>
        <div>
          <span className="stat-label">Estimated Utility Cost Saved</span>
          <span className="big">{cost === undefined ? "Unavailable" : `฿${Math.round(cost).toLocaleString("en-US")}`}</span>
          <span className="sub">THB · MEA TOU rates (excl. VAT)</span>
        </div>
      </div>

      {/* 3. WHOLE BUILDING: LIVE FLOOR BREAKDOWN */}
      {isWholeBuilding && (
        <div className="whatif-breakdown-section">
          <h3 className="glance-h" style={{ marginTop: 16 }}>Live Savings Breakdown by Floor</h3>
          <p className="note">Shows each floor's contribution to total building savings under the {startHour}:00–0{endHour}:00 curfew:</p>
          <div className="floor-savings-bars">
            {floorBreakdown.map((row) => (
              <div key={row.floor} className="floor-bar-row" onClick={() => select({ floor: row.floor })}>
                <div className="floor-bar-header">
                  <strong>Floor {row.floor}</strong>
                  <span><b>฿{Math.round(row.cost).toLocaleString("en-US")}</b> ({kwh(row.energy)})</span>
                </div>
                <div className="floor-bar-track">
                  <div className="floor-bar-fill" style={{ width: `${Math.max(5, row.pct)}%` }} />
                </div>
                <div className="floor-bar-footer">
                  <small>{row.pct}% of building savings</small>
                  <button type="button" className="link">View Floor ›</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. FLOOR LEVEL: ZONE BREAKDOWN */}
      {isFloor && (
        <div className="whatif-breakdown-section">
          {parentScenarios.length > 0 && (
            <div className="schedule-scope-rollup" style={{ marginBottom: 12 }}>
              {parentScenarios.map((row) => (
                <button key={row.label} type="button" onClick={() => select(row.target)}>
                  <span>{row.label} total savings</span>
                  <b>{row.energy === undefined ? "Unavailable" : kwh(row.energy)}</b>
                  <small><span>Cost</span><b>{row.cost === undefined ? "Unavailable" : `฿${Math.round(row.cost).toLocaleString("en-US")}`}</b></small>
                </button>
              ))}
            </div>
          )}
          <h3 className="glance-h">Zone Savings Contribution (Floor {scope.floor})</h3>
          <div className="floor-savings-bars">
            {zoneBreakdown.map((row) => (
              <div key={row.id} className="floor-bar-row" onClick={() => select({ floor: row.floor, zone: row.zone })}>
                <div className="floor-bar-header">
                  <strong>{row.name}</strong>
                  <span><b>฿{Math.round(row.cost).toLocaleString("en-US")}</b> ({kwh(row.energy)})</span>
                </div>
                <div className="floor-bar-track">
                  <div className="floor-bar-fill" style={{ width: `${Math.max(5, row.pct)}%` }} />
                </div>
                <div className="floor-bar-footer">
                  <small>{row.pct}% of floor savings</small>
                  <button type="button" className="link">Inspect Zone ›</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. ZONE LEVEL: CIRCUIT EXEMPTION CONTROLS */}
      {isZone && zoneAudit && (
        <div className="circuit-exemptions-section" style={{ marginTop: 16 }}>
          <div className="circuit-exemptions-header">
            <h3 className="glance-h">Circuit Curfew Controls ({zoneName(scope.zone!)})</h3>
            {exemptedCount > 0 && (
              <button type="button" className="link" onClick={resetCircuitExemptions}>Reset All Exemptions</button>
            )}
          </div>
          <p className="note">
            Enable or exempt individual circuits from the {startHour}:00–0{endHour}:00 curfew sweep. Whitelisted circuits stay energized.
          </p>

          <div className="circuit-cards">
            {zoneAudit.circuits.map((c) => {
              const isCritical = c.classification === "Critical Standby";
              const isExempt = !!circuitExemptions[c.circuit_id];
              return (
                <div key={c.circuit_id} className={`circuit-card ${isExempt ? "exempt" : ""} ${isCritical ? "critical" : ""}`}>
                  <div className="circuit-card-main">
                    <div>
                      <strong>{c.circuit_id}</strong>
                      <span className="zone-popup-badge" style={{ color: AUDIT_CLASS_COLORS[c.classification], marginLeft: 8 }}>
                        {c.classification}
                      </span>
                    </div>
                    <small>{c.type} · Baseload {c.baseload_kw.toFixed(2)} kW</small>
                  </div>

                  <div className="circuit-card-action">
                    {isCritical ? (
                      <span className="badge-critical-lock">🔒 Protected Standby (Always ON)</span>
                    ) : (
                      <button
                        type="button"
                        className={`circuit-toggle-btn ${isExempt ? "exempt" : "active"}`}
                        onClick={() => toggleCircuitExemption(c.circuit_id)}
                      >
                        {isExempt ? "⚠ Whitelisted (Exempt from Curfew)" : "✓ Curfew Sweep Enabled"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {parentScenarios.length > 0 && (
            <div className="schedule-scope-rollup" style={{ marginTop: 16 }}>
              {parentScenarios.map((row) => (
                <button key={row.label} type="button" onClick={() => select(row.target)}>
                  <span>{row.label} at {startHour}:00–0{endHour}:00</span>
                  <b>{row.energy === undefined ? "Unavailable" : kwh(row.energy)}</b>
                  <small><span>Cost</span><b>{row.cost === undefined ? "Unavailable" : `฿${Math.round(row.cost).toLocaleString("en-US")}`}</b></small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;

function ZoneAtAGlance({ audit }: { audit: EnergyAuditZone }) {
  const month = useStore((s) => s.month);
  const period = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const use = zoneUse(audit.floor, audit.zone);

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
      title={`Floor ${audit.floor}, Zone ${audit.zone.slice(1)} at a Glance`}
      aside={<span className="aside">{period}</span>}
      className="glance"
    >
      <div className="stats">
        <Stat
          label="After-hours Waste"
          value={kwh(kwhVal)}
          unit={thb(thbVal)}
          hint="Preventable after-hours energy above circuit baselines, cost excluding VAT (Question A)"
        />
        <Stat
          label="Unoccupied Load"
          value={unoccMean !== null && unoccMean !== undefined ? `${unoccMean.toFixed(2)} kW` : "–"}
          unit={`Baseload ${totalBaseload.toFixed(2)} kW`}
          hint={`Combined mean unoccupied load across ${audit.circuit_count} circuits`}
        />
      </div>

      {use && (
        <p className="glance-lead">
          <b>{use.name}</b> ({use.kindLabel.toLowerCase()} space): {use.lever}
        </p>
      )}

      <h3 className="glance-h">Audited Circuits</h3>
      <ol className="rank">
        {sortedCircuits.map((c) => {
          const cKwh = month ? c.monthly[month]?.surplus_kwh ?? 0 : c.annual_surplus_kwh;
          const cThb = month ? c.monthly[month]?.cost_thb ?? 0 : c.annual_cost_thb;
          const isCritical = c.classification === "Critical Standby";
          return (
            <li key={c.circuit_id}>
              <div className="rank-row">
                <span className="rank-name">
                  <b>{c.circuit_id.replace(/\(kW\)/i, "")}</b>
                  <small>{c.type} · {c.classification}</small>
                </span>
                <span className="rank-bar">
                  <i
                    style={{
                      width: `${(cKwh / maxKwh) * 100}%`,
                      background: isCritical ? "var(--comfy)" : "var(--warm)",
                    }}
                  />
                </span>
                <span className="rank-val">
                  <b>{isCritical ? "Standby" : kwh(cKwh)}</b>
                  <small>{isCritical ? `${c.baseload_kw.toFixed(2)} kW base` : thb(cThb)}</small>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="note">
        Bars show preventable after-hours energy above baselines. Critical standby circuits maintain permanent equipment power.
      </p>
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
    {measure === "audit_load" && auditZone && <ZoneAtAGlance audit={auditZone} />}
    {measure === "audit_load" && !showPlanner && !auditZone && <AfterHoursLoadReadouts zones={zones} />}
    {measure !== "audit_load" && <EnergyReadouts zones={zones} />}
    {measure === "audit_load" && showPlanner && <AuditSavings />}
    {measure === "audit_load" && showPlanner && !scope.zone && <QuestionAPlan zones={zones} />}
    {measure === "audit_load" && !showPlanner && !scope.floor && <EnergyByFloor zones={zones} />}
    {measure === "audit_load" && !showPlanner && !!scope.floor && !scope.zone && <PreventableEnergyByCircuitAndMonth zones={zones} />}
    {auditZone && !showPlanner && <AuditZonePopup audit={auditZone} measure={detailMeasure} />}
  </>;
}

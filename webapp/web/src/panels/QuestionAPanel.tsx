import type { EnergyAuditZone, ZoneInfo } from "../lib/api";
import { AUDIT_CLASS_COLORS } from "../lib/colors";
import { useData } from "../lib/data";
import { kwh, n3 } from "../lib/format";
import {
  plannedScheduleSavings,
  resolveCircuitWindow,
  resolveFloorWindow,
  resolveZoneWindow,
} from "../lib/plan";
import { monthLabel, useStore, zoneName, type AuditMeasure, type MapMeasure, type Scope } from "../lib/store";
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
        <Stat label="Preventable energy" value={hasEnergy ? kwh(energy) : "Unavailable"} unit={month ? monthLabel(month) : "Annual total"} />
        <Stat label="Mean after-hours load" value={n3(totalLoad)} unit="kW · unoccupied power" />
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

function AuditSavings() {
  const { meta, auditById } = useData();
  const month = useStore((s) => s.month);
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);

  // Building-level defaults + Floor/Zone/Circuit manual overrides
  const buildingStart = useStore((s) => s.auditStartHour);
  const buildingEnd = useStore((s) => s.auditEndHour);
  const setBuildingStart = useStore((s) => s.setAuditStartHour);
  const setBuildingEnd = useStore((s) => s.setAuditEndHour);

  const floorWindows = useStore((s) => s.auditFloorWindows);
  const setFloorWindow = useStore((s) => s.setFloorWindow);
  const clearFloorWindow = useStore((s) => s.clearFloorWindow);

  const zoneWindows = useStore((s) => s.auditZoneWindows);
  const setZoneWindow = useStore((s) => s.setZoneWindow);
  const clearZoneWindow = useStore((s) => s.clearZoneWindow);

  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);
  const circuitWindows = useStore((s) => s.auditCircuitWindows);
  const toggleCircuitExemption = useStore((s) => s.toggleCircuitExemption);
  const setCircuitWindow = useStore((s) => s.setCircuitWindow);
  const clearCircuitWindow = useStore((s) => s.clearCircuitWindow);
  const resetCircuitExemptions = useStore((s) => s.resetCircuitExemptions);

  const isWholeBuilding = scope.floor === undefined;
  const isFloor = scope.floor !== undefined && !scope.zone;
  const isZone = scope.floor !== undefined && !!scope.zone;
  const activeZoneId = isZone ? `F${scope.floor}:${scope.zone}` : "";

  // Determine the active slider values for the current scope level (Building, Floor, or Zone)
  const floorResolved = scope.floor !== undefined
    ? resolveFloorWindow(scope.floor, buildingStart, buildingEnd, floorWindows)
    : { start_hour: buildingStart, end_hour: buildingEnd, isOverridden: false };
  const zoneResolved = isZone && scope.floor !== undefined && scope.zone
    ? resolveZoneWindow(scope.floor, scope.zone, buildingStart, buildingEnd, floorWindows, zoneWindows)
    : { start_hour: floorResolved.start_hour, end_hour: floorResolved.end_hour, isOverridden: false, source: "building" as const };

  const activeStart = isZone
    ? zoneResolved.start_hour
    : isFloor
      ? floorResolved.start_hour
      : buildingStart;
  const activeEnd = isZone
    ? zoneResolved.end_hour
    : isFloor
      ? floorResolved.end_hour
      : buildingEnd;

  const handleSliderChange = (nextStart: number, nextEnd: number) => {
    if (isZone && activeZoneId) {
      setZoneWindow(activeZoneId, nextStart, nextEnd);
    } else if (isFloor && scope.floor !== undefined) {
      setFloorWindow(scope.floor, nextStart, nextEnd);
    } else {
      setBuildingStart(nextStart);
      setBuildingEnd(nextEnd);
    }
  };

  const scopeTitle = scope.zone
    ? `Floor ${scope.floor} · ${zoneName(scope.zone)}`
    : scope.floor
      ? `Floor ${scope.floor}`
      : "Whole Building";

  const estimate = meta
    ? plannedScheduleSavings(
        meta,
        scope,
        buildingStart,
        buildingEnd,
        month,
        circuitExemptions,
        circuitWindows,
        floorWindows,
        zoneWindows
      )
    : null;

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
  const windowDuration = ((24 - activeStart) + activeEnd).toFixed(0);
  const endFmt = String(activeEnd).padStart(2, "0");

  const PRESETS = [
    { label: "Default (17:00–08:00)", start: 17, end: 8 },
    { label: "Late Office (18:00–08:00)", start: 18, end: 8 },
    { label: "Night (20:00–07:00)", start: 20, end: 7 },
    { label: "Early (19:00–05:00)", start: 19, end: 5 },
  ];

  // Floor-by-floor breakdown when viewing Whole Building
  const floorBreakdown = isWholeBuilding && meta
    ? meta.floors.map((f) => {
        const sav = plannedScheduleSavings(
          meta,
          { floor: f },
          buildingStart,
          buildingEnd,
          month,
          circuitExemptions,
          circuitWindows,
          floorWindows,
          zoneWindows
        );
        const fWin = resolveFloorWindow(f, buildingStart, buildingEnd, floorWindows);
        const zoneOvCount = Object.keys(zoneWindows).filter((zid) => zid.startsWith(`F${f}:`)).length;
        return {
          floor: f,
          kwh: sav.energyKwh,
          thb: sav.costThb,
          start: fWin.start_hour,
          end: fWin.end_hour,
          isFloorOverridden: fWin.isOverridden,
          zoneOvCount,
        };
      })
    : [];
  const maxFloorKwh = Math.max(...floorBreakdown.map((f) => f.kwh), 1);

  // Zone-by-zone breakdown when viewing a single Floor
  const zoneBreakdown = isFloor && scope.floor !== undefined && meta
    ? currentAudits.map((a) => {
        const sav = plannedScheduleSavings(
          meta,
          { floor: a.floor, zone: a.zone },
          buildingStart,
          buildingEnd,
          month,
          circuitExemptions,
          circuitWindows,
          floorWindows,
          zoneWindows
        );
        const zWin = resolveZoneWindow(a.floor, a.zone, buildingStart, buildingEnd, floorWindows, zoneWindows);
        const use = zoneUse(a.floor, a.zone);
        const circuitOvCount = a.circuits.filter(
          (c) => circuitExemptions[c.circuit_id] || circuitWindows[c.circuit_id]
        ).length;
        return {
          zone: a.zone,
          name: use?.name ?? `Zone ${a.zone.slice(1)}`,
          classification: a.classification,
          kwh: sav.energyKwh,
          thb: sav.costThb,
          start: zWin.start_hour,
          end: zWin.end_hour,
          isZoneOverridden: zWin.isOverridden,
          circuitOvCount,
        };
      })
    : [];
  const maxZoneKwh = Math.max(...zoneBreakdown.map((z) => z.kwh), 1);

  const zoneAudit = isZone && scope.floor && scope.zone ? auditById.get(`F${scope.floor}:${scope.zone}`) : undefined;
  const totalOverrideCount =
    Object.keys(floorWindows).length +
    Object.keys(zoneWindows).length +
    Object.keys(circuitExemptions).filter((id) => circuitExemptions[id]).length +
    Object.keys(circuitWindows).length;

  return (
    <Section
      title={isWholeBuilding ? "Whole Building Curfew Simulator" : `Curfew Simulator · ${scopeTitle}`}
      aside={
        totalOverrideCount > 0 ? (
          <button type="button" className="link" onClick={resetCircuitExemptions}>
            Reset All ({totalOverrideCount})
          </button>
        ) : (
          <span className="aside">{activeStart}:00–{endFmt}:00 ({windowDuration}h) · {periodLabel}</span>
        )
      }
      collapsible
      defaultOpen={true}
    >
      {/* Scope hierarchy status bar */}
      <div className="curfew-scope-status" style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          {isWholeBuilding && <>Setting <b>Whole Building</b> default curfew (overridden floors/zones stay locked)</>}
          {isFloor && scope.floor !== undefined && (
            floorResolved.isOverridden
              ? <><b>Floor {scope.floor} Manual Override</b> active (overridden zones on this floor stay locked)</>
              : <>Following <b>Whole Building</b> ({buildingStart}:00–{String(buildingEnd).padStart(2, "0")}:00) · Move slider to override Floor {scope.floor}</>
          )}
          {isZone && scope.floor !== undefined && scope.zone && (
            zoneResolved.isOverridden
              ? <><b>Zone {scope.zone.slice(1)} Manual Override</b> active (stays locked if Floor {scope.floor} changes)</>
              : <>Following <b>{zoneResolved.source === "floor" ? `Floor ${scope.floor}` : "Whole Building"}</b> ({zoneResolved.start_hour}:00–{String(zoneResolved.end_hour).padStart(2, "0")}:00) · Move slider to override Zone {scope.zone.slice(1)}</>
          )}
        </span>
        {isFloor && scope.floor !== undefined && floorResolved.isOverridden && (
          <button type="button" className="link" onClick={() => clearFloorWindow(scope.floor!)}>
            Revert to Building
          </button>
        )}
        {isZone && activeZoneId && zoneResolved.isOverridden && (
          <button type="button" className="link" onClick={() => clearZoneWindow(activeZoneId)}>
            Revert to Floor
          </button>
        )}
      </div>

      <div className="curfew-control-block">
        <div className="curfew-dual-sliders">
          <label className="slider">
            <div className="slider-label-row">
              <span>Start Curfew ({isZone ? `Zone ${scope.zone?.slice(1)}` : isFloor ? `Floor ${scope.floor}` : "Building"}):</span>
              <b>{activeStart}:00</b>
            </div>
            <input
              type="range"
              min={17}
              max={23}
              step={1}
              value={activeStart}
              aria-label="Curfew evening start hour"
              onChange={(e) => handleSliderChange(+e.target.value, activeEnd)}
            />
            <span className="slider-ends"><span>17:00</span><span>23:00</span></span>
          </label>

          <label className="slider">
            <div className="slider-label-row">
              <span>End Curfew ({isZone ? `Zone ${scope.zone?.slice(1)}` : isFloor ? `Floor ${scope.floor}` : "Building"}):</span>
              <b>{endFmt}:00</b>
            </div>
            <input
              type="range"
              min={5}
              max={8}
              step={1}
              value={activeEnd}
              aria-label="Curfew morning end hour"
              onChange={(e) => handleSliderChange(activeStart, +e.target.value)}
            />
            <span className="slider-ends"><span>05:00</span><span>08:00</span></span>
          </label>
        </div>

        <div className="curfew-presets">
          <div className="preset-buttons">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={activeStart === p.start && activeEnd === p.end ? "preset-btn active" : "preset-btn"}
                onClick={() => handleSliderChange(p.start, p.end)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="result" style={{ marginTop: 10 }}>
        <div>
          <span className="stat-label">Simulated Energy Saved</span>
          <span className="big">{energy === undefined ? "Unavailable" : kwh(energy)}</span>
          <span className="sub">{capturePct}% of preventable waste captured</span>
        </div>
        <div>
          <span className="stat-label">Simulated Cost Saved</span>
          <span className="big">{cost === undefined ? "Unavailable" : thb(cost)}</span>
          <span className="sub">THB · MEA TOU (excl. VAT)</span>
        </div>
      </div>

      {/* LEVEL 1 -> LEVEL 2: WHOLE BUILDING -> FLOOR BREAKDOWN */}
      {isWholeBuilding && floorBreakdown.length > 0 && (
        <div className="whatif-scope-breakdown" style={{ marginTop: 14 }}>
          <h3 className="glance-h">Floor Curfews (Click a Floor to Adjust)</h3>
          <ol className="rank">
            {floorBreakdown.map((f) => {
              const fEndFmt = String(f.end).padStart(2, "0");
              return (
                <li key={f.floor}>
                  <button
                    type="button"
                    className="rank-row"
                    style={{ width: "100%", background: "none", border: "none", color: "inherit", cursor: "pointer", textAlign: "left", padding: "4px 0" }}
                    onClick={() => select({ floor: f.floor })}
                  >
                    <span className="rank-name">
                      <b>Floor {f.floor}</b>
                      <small>
                        Off {f.start}:00–{fEndFmt}:00
                        {f.isFloorOverridden ? " · Floor Override" : ""}
                        {f.zoneOvCount > 0 ? ` · ${f.zoneOvCount} Zone Override${f.zoneOvCount > 1 ? "s" : ""}` : ""}
                      </small>
                    </span>
                    <span className="rank-bar">
                      <i style={{ width: `${(f.kwh / maxFloorKwh) * 100}%`, background: f.isFloorOverridden || f.zoneOvCount > 0 ? "var(--amber)" : "var(--warm)" }} />
                    </span>
                    <span className="rank-val">
                      <b>{kwh(f.kwh)}</b>
                      <small>{thb(f.thb)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* LEVEL 2 -> LEVEL 3: FLOOR -> ZONE BREAKDOWN */}
      {isFloor && zoneBreakdown.length > 0 && (
        <div className="whatif-scope-breakdown" style={{ marginTop: 14 }}>
          <h3 className="glance-h">Floor {scope.floor} Zones (Click a Zone to Adjust)</h3>
          <ol className="rank">
            {zoneBreakdown.map((z) => {
              const zEndFmt = String(z.end).padStart(2, "0");
              const isAllCritical = z.classification === "Critical Standby";
              return (
                <li key={z.zone}>
                  <button
                    type="button"
                    className="rank-row"
                    style={{ width: "100%", background: "none", border: "none", color: "inherit", cursor: "pointer", textAlign: "left", padding: "4px 0" }}
                    onClick={() => select({ floor: scope.floor, zone: z.zone })}
                  >
                    <span className="rank-name">
                      <b>Zone {z.zone.slice(1)} · <small>{z.name}</small></b>
                      <small>
                        {isAllCritical
                          ? "🔒 Critical Standby (ON 24/7)"
                          : `Off ${z.start}:00–${zEndFmt}:00${z.isZoneOverridden ? " · Zone Override (Locked)" : " · Follows Floor"}${z.circuitOvCount > 0 ? ` · ${z.circuitOvCount} Circuit Override` : ""}`}
                      </small>
                    </span>
                    <span className="rank-bar">
                      <i style={{ width: `${isAllCritical ? 100 : (z.kwh / maxZoneKwh) * 100}%`, background: isAllCritical ? "var(--comfy)" : z.isZoneOverridden || z.circuitOvCount > 0 ? "var(--amber)" : "var(--warm)", opacity: isAllCritical ? 0.35 : 1 }} />
                    </span>
                    <span className="rank-val">
                      <b>{isAllCritical ? "ON 24/7" : kwh(z.kwh)}</b>
                      <small>{isAllCritical ? "Locked" : thb(z.thb)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* LEVEL 3 -> LEVEL 4: ZONE -> THE 2 CIRCUITS (LIGHT & PLUG) */}
      {isZone && zoneAudit && (
        <div className="circuit-exemptions-section" style={{ marginTop: 14 }}>
          <div className="circuit-exemptions-header">
            <h3 className="glance-h">Zone {scope.zone?.slice(1)} Circuits (Light & Plug)</h3>
          </div>
          <div className="circuit-cards">
            {zoneAudit.circuits.map((c) => {
              const isCritical = c.classification === "Critical Standby";
              const isExempt = !!circuitExemptions[c.circuit_id];
              const resolved = resolveCircuitWindow(
                zoneAudit.floor,
                zoneAudit.zone,
                c.circuit_id,
                buildingStart,
                buildingEnd,
                floorWindows,
                zoneWindows,
                circuitWindows
              );
              const isCircuitOverridden = resolved.source === "circuit" || isExempt;
              return (
                <div key={c.circuit_id} className={`circuit-card ${isExempt ? "exempt" : ""} ${isCritical ? "critical" : ""}`}>
                  <div className="circuit-card-main">
                    <div>
                      <strong>{c.circuit_id.replace(/\(kW\)/i, "")}</strong>
                      <span className="zone-popup-badge" style={{ color: AUDIT_CLASS_COLORS[c.classification], marginLeft: 8 }}>
                        {c.classification}
                      </span>
                    </div>
                    <small>
                      {c.type} · Base {c.baseload_kw.toFixed(2)} kW · Unocc {(c.unocc_mean_kw ?? 0).toFixed(2)} kW
                      {isCircuitOverridden ? " · Circuit Override (Locked)" : !isCritical ? ` · Follows ${resolved.source === "zone" ? "Zone" : resolved.source === "floor" ? "Floor" : "Building"}` : ""}
                    </small>
                  </div>
                  <div className="circuit-card-action">
                    {isCritical ? (
                      <span className="badge-critical-lock">🔒 ON 24/7</span>
                    ) : (
                      <div className="circuit-inline-controls">
                        <button
                          type="button"
                          className={`circuit-toggle-btn ${isExempt ? "exempt" : "active"}`}
                          onClick={() => toggleCircuitExemption(c.circuit_id)}
                        >
                          {isExempt ? "ON 24/7 (Exempt)" : "Curfew Off"}
                        </button>
                        {!isExempt && (
                          <div className="circuit-window-selects">
                            <select
                              className="mini"
                              value={resolved.start_hour}
                              onChange={(e) => setCircuitWindow(c.circuit_id, +e.target.value, resolved.end_hour)}
                              title="Circuit curfew start hour"
                            >
                              {START_HOURS.map((h) => (
                                <option key={h} value={h}>{h}:00</option>
                              ))}
                            </select>
                            <span>–</span>
                            <select
                              className="mini"
                              value={resolved.end_hour}
                              onChange={(e) => setCircuitWindow(c.circuit_id, resolved.start_hour, +e.target.value)}
                              title="Circuit curfew end hour"
                            >
                              {END_HOURS.map((h) => (
                                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                              ))}
                            </select>
                            {resolved.source === "circuit" && (
                              <button
                                type="button"
                                className="link"
                                onClick={() => clearCircuitWindow(c.circuit_id)}
                                title="Revert circuit to Zone curfew"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function ZoneAtAGlance({ audit, measure }: { audit: EnergyAuditZone; measure: MapMeasure }) {
  const month = useStore((s) => s.month);
  const buildingStart = useStore((s) => s.auditStartHour);
  const buildingEnd = useStore((s) => s.auditEndHour);
  const floorWindows = useStore((s) => s.auditFloorWindows);
  const zoneWindows = useStore((s) => s.auditZoneWindows);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);
  const circuitWindows = useStore((s) => s.auditCircuitWindows);
  const period = month ? monthLabel(month) : "Jul 2018–Jun 2019";
  const use = zoneUse(audit.floor, audit.zone);
  const isLoad = measure === "audit_load";

  const kwhVal = month ? audit.monthly[month]?.surplus_kwh ?? 0 : audit.annual_surplus_kwh;
  const thbVal = month ? audit.monthly[month]?.cost_thb ?? 0 : audit.annual_cost_thb;
  const unoccMean = month ? audit.monthly[month]?.unocc_mean_kw : audit.unocc_mean_kw;
  const totalBaseload = audit.circuits.reduce((sum, c) => sum + c.baseload_kw, 0);

  const sortedCircuits = [...audit.circuits].sort((a, b) => {
    const aKwh = month ? a.monthly[month]?.surplus_kwh ?? 0 : a.annual_surplus_kwh;
    const bKwh = month ? b.monthly[month]?.cost_thb ?? 0 : b.annual_surplus_kwh;
    return bKwh - aKwh;
  });
  const maxKwh = Math.max(...sortedCircuits.map((c) => (month ? c.monthly[month]?.surplus_kwh ?? 0 : c.annual_surplus_kwh)), 1e-9);

  return (
    <Section
      title={`Floor ${audit.floor}, Zone ${audit.zone.slice(1)}`}
      aside={<span className="aside">{period}</span>}
      className="glance"
    >
      <div className="stats">
        <Stat
          label="Preventable Waste"
          value={kwh(kwhVal)}
          unit={thb(thbVal)}
          hint="Preventable after-hours energy above P2.5 dynamic baselines (excl. VAT)"
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
          <b>{use.name}</b> ({use.kindLabel.toLowerCase()}): {use.lever}
        </p>
      )}

      <div className="zone-side-popup-chart" style={{ marginTop: 10, marginBottom: 12 }}>
        <h3 className="glance-h">{isLoad ? "Monthly After-Hours Load · kW" : "Monthly Preventable Energy · kWh"}</h3>
        {isLoad
          ? <AfterHoursLoadChart monthly={audit.monthly} selectedMonth={month} baselineKw={totalBaseload} />
          : <PreventableEnergyChart monthly={audit.monthly} selectedMonth={month} />}
      </div>

      <h3 className="glance-h">Circuits ({audit.circuit_count})</h3>
      <ol className="rank">
        {sortedCircuits.map((c) => {
          const cKwh = month ? c.monthly[month]?.surplus_kwh ?? 0 : c.annual_surplus_kwh;
          const cThb = month ? c.monthly[month]?.cost_thb ?? 0 : c.annual_cost_thb;
          const isCritical = c.classification === "Critical Standby";
          const isExempt = !isCritical && !!circuitExemptions[c.circuit_id];
          const resolved = resolveCircuitWindow(
            audit.floor,
            audit.zone,
            c.circuit_id,
            buildingStart,
            buildingEnd,
            floorWindows,
            zoneWindows,
            circuitWindows
          );
          const effE = String(resolved.end_hour).padStart(2, "0");
          const schedLabel = isCritical
            ? "Locked ON 24/7"
            : isExempt
              ? "ON 24/7 (Exempt)"
              : `Off ${resolved.start_hour}:00–${effE}:00`;
          return (
            <li key={c.circuit_id}>
              <div className="rank-row">
                <span className="rank-name">
                  <b>{c.circuit_id.replace(/\(kW\)/i, "")}</b>
                  <small>{c.classification} · {schedLabel}</small>
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
                  <b>{isCritical ? "ON 24/7" : kwh(cKwh)}</b>
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
        <AuditSavings />
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

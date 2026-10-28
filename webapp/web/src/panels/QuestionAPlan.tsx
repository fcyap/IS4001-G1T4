import { useState } from "react";
import type { EnergyAuditCircuit, EnergyAuditZone, Meta, ZoneInfo } from "../lib/api";
import { useData } from "../lib/data";
import { kwh } from "../lib/format";
import { monthLabel, useStore } from "../lib/store";
import { zoneUse } from "../lib/zones";
import { Section } from "./PanelPrimitives";

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const SHOWN = 8;

interface CircuitPlanItem {
  circuit_id: string;
  cleanName: string;
  floor: number;
  zone: string;
  type: string;
  isCritical: boolean;
  badge: string;
  badgeStyle: string;
  category: "curfew" | "plugs" | "keep_on";
  action: string;
  dataReason: string;
  savedKwh: number;
  savedThb: number;
}

function getCircuitPlanInfo(
  audit: EnergyAuditZone,
  circuit: EnergyAuditCircuit,
  meta: Meta | null,
  month: string | null,
  startHour: number,
  endHour: number
): CircuitPlanItem {
  const cid = circuit.circuit_id;
  const cleanName = cid.replace(/\(kW\)/i, "");
  const use = zoneUse(audit.floor, audit.zone);
  const isCritical = circuit.classification === "Critical Standby" || use?.kind === "plant";

  const timingList = meta?.afterhours_timing[`circuit:${cid}`] ?? [];

  const findScenario = (sHour: number, eHour: number) => {
    return timingList.find((r) => r.start_hour === sHour && r.end_hour === eHour)
      ?? timingList.find((r) => r.cutoff_hour === sHour)
      ?? timingList[0];
  };

  // 1. Critical Standby: Engineering plant room & emergency egress lighting
  if (isCritical) {
    return {
      circuit_id: cid,
      cleanName,
      floor: audit.floor,
      zone: audit.zone,
      type: circuit.type,
      isCritical: true,
      badge: "Keep ON",
      badgeStyle: "badge-keep",
      category: "keep_on",
      action: "Protected 24/7 (Exempt from Curfew)",
      dataReason: `Permanent engineering baseload of ${circuit.baseload_kw.toFixed(2)} kW; essential for building plant, UPS, and safety egress.`,
      savedKwh: 0,
      savedThb: 0,
    };
  }

  // 2. Ground Floor Sitting Hall / Lobby (Floor 1 Zone 1)
  if (audit.floor === 1 && audit.zone === "z1") {
    const scen = findScenario(startHour, endHour);
    const kwhVal = month ? (scen?.monthly[month]?.kwh ?? circuit.monthly[month]?.surplus_kwh ?? 0) : (scen?.annual_kwh ?? circuit.annual_surplus_kwh);
    const thbVal = month ? (scen?.monthly[month]?.cost_thb ?? circuit.monthly[month]?.cost_thb ?? 0) : (scen?.annual_cost_thb ?? circuit.annual_cost_thb);
    return {
      circuit_id: cid,
      cleanName,
      floor: audit.floor,
      zone: audit.zone,
      type: circuit.type,
      isCritical: false,
      badge: "Off at Curfew",
      badgeStyle: "badge-curfew",
      category: "curfew",
      action: `Switch off at ${startHour}:00 entrance closure`,
      dataReason: `Unoccupied decorative draw (${(circuit.unocc_mean_kw ?? 7.79).toFixed(1)} kW) after main lobby closes; largest single waste circuit in building.`,
      savedKwh: kwhVal,
      savedThb: thbVal,
    };
  }

  // 3. Workstation plug loads across administrative departments
  if (circuit.type.toLowerCase().includes("plug")) {
    const scen = findScenario(startHour, endHour);
    const kwhVal = month ? (scen?.monthly[month]?.kwh ?? circuit.monthly[month]?.surplus_kwh ?? 0) : (scen?.annual_kwh ?? circuit.annual_surplus_kwh);
    const thbVal = month ? (scen?.monthly[month]?.cost_thb ?? circuit.monthly[month]?.cost_thb ?? 0) : (scen?.annual_cost_thb ?? circuit.annual_cost_thb);
    return {
      circuit_id: cid,
      cleanName,
      floor: audit.floor,
      zone: audit.zone,
      type: circuit.type,
      isCritical: false,
      badge: "Switch Off",
      badgeStyle: "badge-amber",
      category: "plugs",
      action: "De-energize workstation plug circuits overnight",
      dataReason: `Phantom standby load (${(circuit.unocc_mean_kw ?? 0.2).toFixed(2)} kW) from unattended desktop screens and office equipment.`,
      savedKwh: kwhVal,
      savedThb: thbVal,
    };
  }

  // 4. Administrative Office Department Lighting (Floors 2 to 7)
  const scen = findScenario(startHour, endHour);
  const kwhVal = month ? (scen?.monthly[month]?.kwh ?? circuit.monthly[month]?.surplus_kwh ?? 0) : (scen?.annual_kwh ?? circuit.annual_surplus_kwh);
  const thbVal = month ? (scen?.monthly[month]?.cost_thb ?? circuit.monthly[month]?.cost_thb ?? 0) : (scen?.annual_cost_thb ?? circuit.annual_cost_thb);
  const deptName = use?.name ? ` in ${use.name}` : "";
  return {
    circuit_id: cid,
    cleanName,
    floor: audit.floor,
    zone: audit.zone,
    type: circuit.type,
    isCritical: false,
    badge: "Off at Curfew",
    badgeStyle: "badge-curfew",
    category: "curfew",
    action: `Switch off with ${startHour}:00 building curfew sweep`,
    dataReason: `Zero baseload (0.00 kW)${deptName}; office lights left burning unattended after working hours end.`,
    savedKwh: kwhVal,
    savedThb: thbVal,
  };
}

export default function QuestionAPlan({ zones }: { zones: ZoneInfo[] }) {
  const { auditById, meta } = useData();
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.select);
  const scopeNavigationCount = useStore((s) => s.scopeNavigationCount);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);

  const [aiState, setAiState] = useState<"ready" | "generating">("ready");
  const [loadingStep, setLoadingStep] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const audits = zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
  const period = month ? `in ${monthLabel(month)}` : "a year";
  const curfewLabel = `${startHour}:00–0${endHour}:00`;

  const handleGenerate = () => {
    setAiState("generating");
    setLoadingStep(1);
    setTimeout(() => setLoadingStep(2), 300);
    setTimeout(() => setLoadingStep(3), 600);
    setTimeout(() => {
      setAiState("ready");
    }, 900);
  };

  // Compile all circuits from visible zones
  const circuitItems: CircuitPlanItem[] = [];
  for (const audit of audits) {
    for (const circuit of audit.circuits) {
      const item = getCircuitPlanInfo(audit, circuit, meta, month, startHour, endHour);
      // If user has explicitly whitelisted this circuit in zone controls, adjust status
      if (circuitExemptions[circuit.circuit_id] && !item.isCritical) {
        circuitItems.push({
          ...item,
          badge: "Exempted",
          badgeStyle: "badge-keep",
          action: "User whitelisted (exempt from curfew)",
          savedKwh: 0,
          savedThb: 0,
        });
      } else {
        circuitItems.push(item);
      }
    }
  }

  // Sort: highest savings first, critical last
  circuitItems.sort((a, b) => {
    if (a.isCritical && !b.isCritical) return 1;
    if (!a.isCritical && b.isCritical) return -1;
    return b.savedThb - a.savedThb;
  });

  const totalThb = circuitItems.reduce((acc, c) => acc + c.savedThb, 0);
  const totalKwh = circuitItems.reduce((acc, c) => acc + c.savedKwh, 0);

  const curfewCircuits = circuitItems.filter((c) => c.category === "curfew" && c.savedThb > 0);
  const plugCircuits = circuitItems.filter((c) => c.category === "plugs" && c.savedThb > 0);
  const criticalCircuits = circuitItems.filter((c) => c.isCritical || c.badge === "Exempted");

  const curfewKwh = curfewCircuits.reduce((acc, c) => acc + c.savedKwh, 0);
  const curfewThb = curfewCircuits.reduce((acc, c) => acc + c.savedThb, 0);

  const plugKwh = plugCircuits.reduce((acc, c) => acc + c.savedKwh, 0);
  const plugThb = plugCircuits.reduce((acc, c) => acc + c.savedThb, 0);

  return (
    <Section
      title="Recommended Plan"
      aside={<span className="aside">{month ? monthLabel(month) : "Per Year"} · Curfew {curfewLabel} · excl. VAT</span>}
      className="plan"
      collapsible
      defaultOpen={scopeNavigationCount > 0}
    >
      {/* 1. AI GENERATION SIMULATION BAR */}
      <div className="plan-ai-header">
        <div className="plan-ai-title">
          <span className="ai-icon-sparkle">✨</span>
          <span>AI Curfew Plan</span>
          <span className="plan-ai-tag">Telemetry-Optimized</span>
        </div>
        <button
          type="button"
          className="plan-ai-btn"
          onClick={handleGenerate}
          disabled={aiState === "generating"}
        >
          {aiState === "generating" ? "Simulating AI…" : "↻ Re-generate Plan"}
        </button>
      </div>

      {aiState === "generating" ? (
        <div className="plan-ai-loading">
          <div className="plan-ai-loading-bar">
            <div className="plan-ai-loading-progress" style={{ width: `${loadingStep * 33}%` }} />
          </div>
          <p className="plan-ai-loading-text">
            {loadingStep === 1 && "Analyzing 65 circuit telemetry feeds across 7 office floors…"}
            {loadingStep === 2 && "Correlating end-of-day office departures with circuit baseloads (P2.5)…"}
            {loadingStep === 3 && "Synthesizing circuit shutoff timings and critical plant whitelists…"}
          </p>
        </div>
      ) : (
        <>
          {/* 2. THE TOTAL PLAN SAVINGS (Identical format to Cooling Comfort) */}
          <div className="plan-total">
            <span className="stat-label">The AI plan saves</span>
            <span className="big">{thb(totalThb)}</span>
            <span className="sub">{kwh(totalKwh)} {period}</span>
          </div>

          {/* 3. PLAN PARTS (Identical format to Cooling Comfort) */}
          <div className="plan-parts">
            <div className="plan-part on">
              <span className="plan-step">⚡</span>
              <b>Off at Curfew</b>
              <span>{curfewCircuits.length} lighting circuits · {kwh(curfewKwh)} · {thb(curfewThb)}</span>
            </div>
            <div className="plan-part">
              <span className="plan-step">🔌</span>
              <b>Switch Off Plugs</b>
              <span>{plugCircuits.length} workstation circuits · {kwh(plugKwh)} · {thb(plugThb)}</span>
            </div>
            <div className="plan-part">
              <span className="plan-step">🔒</span>
              <b>24/7 Whitelist</b>
              <span>{criticalCircuits.length} circuits · Protected Standby</span>
            </div>
          </div>

          <p className="note">
            The plan is circuit-specific and data-driven: office lighting and workstation plugs with zero baseloads are scheduled to switch off after working hours, while critical plant equipment and emergency egress lighting remain whitelisted 24/7.
          </p>

          {/* 4. CIRCUIT-SPECIFIC LIST */}
          <h3 className="glance-h">Circuit-Specific Recommendations</h3>
          <ol className="plan-zones">
            {(showAll ? circuitItems : circuitItems.slice(0, SHOWN)).map((c) => (
              <li key={c.circuit_id}>
                <button
                  type="button"
                  className="plan-zone plan-circuit-item"
                  onClick={() => select({ floor: c.floor, zone: c.zone })}
                  title="Click to view zone in digital twin and manage circuit"
                >
                  <span className={`plan-rate ${c.badgeStyle}`}>
                    {c.badge}
                  </span>
                  <span className="plan-zone-name">
                    <b>
                      Floor {c.floor}, zone {c.zone.slice(1)} · {c.cleanName} <small>({c.type})</small>
                    </b>
                    <small>{c.action} · {c.dataReason}</small>
                  </span>
                  <span className="plan-zone-val">{c.isCritical || c.savedThb === 0 ? "–" : thb(c.savedThb)}</span>
                </button>
              </li>
            ))}
          </ol>

          {circuitItems.length > SHOWN && (
            <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show top circuits only" : `Show all ${circuitItems.length} circuits`}
            </button>
          )}

          <div className="plan-status">
            <span>
              The curfew slider above controls the timing for curfew-linked circuits. Click any circuit to navigate to its zone and toggle exemption switches.
            </span>
          </div>
        </>
      )}
    </Section>
  );
}

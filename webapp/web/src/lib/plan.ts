// Curfew planning for Question A: one building-wide default plus a list of exceptions.
// The K-Means class gives each circuit a RECOMMENDATION (Critical Standby -> keep on 24/7,
// Preventable Waste -> off with the default curfew). Exceptions override it; the most specific wins
// (circuit > zone > floor). Floor and zone exceptions only change circuits that are off after hours:
// a circuit recommended to stay on is switched off only by an exception for that circuit.
import { useMemo } from "react";
import { useStore } from "./store";
import type { CircuitMode, CurfewException, EnergyAuditCircuit, EnergyAuditZone, Meta } from "./api";
import type { Scope } from "./store";
import { zoneUse } from "./zones";

export interface ZoneRec {
  rate: number;
  action: string;
}

export interface CurfewSettings {
  start: number;
  end: number;
  weekendsOff: boolean;
  exceptions: CurfewException[];
}

export function useCurfewSettings(): CurfewSettings {
  const start = useStore((s) => s.auditStartHour);
  const end = useStore((s) => s.auditEndHour);
  const weekendsOff = useStore((s) => s.auditWeekendsOff);
  const exceptions = useStore((s) => s.auditExceptions);
  return { start, end, weekendsOff, exceptions };
}

export interface CurfewWindow {
  start_hour: number;
  end_hour: number;
  weekends_off: boolean;
}

export const DEFAULT_START = 17;
export const DEFAULT_END = 8;

export const formatWindow = (w: CurfewWindow) =>
  `Off ${w.start_hour}:00–${String(w.end_hour).padStart(2, "0")}:00${w.weekends_off ? " + weekends" : " daily"}`;

export const defaultWindow = (s: CurfewSettings): CurfewWindow =>
  ({ start_hour: s.start, end_hour: s.end, weekends_off: s.weekendsOff });

export const exceptionId = (floor: number, zone?: string, circuit?: string) =>
  circuit ? `F${floor}:${zone}:${circuit}` : zone ? `F${floor}:${zone}` : `F${floor}`;

/** Number of changes from the recommended plan (default hours, weekends, exceptions). */
export function countPlanChanges(s: CurfewSettings): number {
  return s.exceptions.length + (s.start !== DEFAULT_START || s.end !== DEFAULT_END ? 1 : 0) + (s.weekendsOff ? 0 : 1);
}

export function recommendedMode(circuit: EnergyAuditCircuit): CircuitMode {
  return circuit.classification === "Critical Standby" ? "keep_on" : "curfew";
}

export interface ResolvedCircuit {
  mode: CircuitMode;
  window: CurfewWindow;
  /** The exception that decides this circuit, if any. */
  exception?: CurfewException;
}

/** What happens to one circuit after hours under the plan. */
export function resolveCircuit(floor: number, zone: string, circuit: EnergyAuditCircuit, s: CurfewSettings): ResolvedCircuit {
  const own = s.exceptions.find((e) => e.id === exceptionId(floor, zone, circuit.circuit_id));
  if (own) return { mode: own.mode === "keep_on" ? "keep_on" : "curfew", window: own, exception: own };
  const area = s.exceptions.find((e) => e.id === exceptionId(floor, zone))
    ?? s.exceptions.find((e) => e.id === exceptionId(floor));
  if (area?.mode === "keep_on") return { mode: "keep_on", window: area, exception: area };
  if (recommendedMode(circuit) === "keep_on") return { mode: "keep_on", window: defaultWindow(s) };
  return area ? { mode: "curfew", window: area, exception: area } : { mode: "curfew", window: defaultWindow(s) };
}

export function circuitMode(circuit: EnergyAuditCircuit, floor: number, zone: string, s: CurfewSettings): CircuitMode {
  return resolveCircuit(floor, zone, circuit, s).mode;
}

export function recommend(a: EnergyAuditZone): ZoneRec {
  const kind = zoneUse(a.floor, a.zone)?.kind;
  if (a.preventable_count === 0) {
    return {
      rate: 0,
      action: "All critical standby, leave on",
    };
  }
  if (kind === "plant") {
    return {
      rate: 0,
      action: "Plant equipment, leave on",
    };
  }
  if (a.classification === "Mixed") {
    return {
      rate: 50,
      action: "Switch off preventable circuits, leave critical standby on",
    };
  }
  if (kind === "circulation") {
    return {
      rate: 50,
      action: "Switch off non-essential lighting, keep safety lighting on",
    };
  }
  if (kind === "exterior") {
    return {
      rate: 50,
      action: "Keep security lighting on",
    };
  }
  if (kind === "lobby") {
    return {
      rate: 75,
      action: "Switch off sitting hall circuits",
    };
  }
  return {
    rate: 90,
    action: "Switch off lights and plugs",
  };
}

export function findTimingScenario(
  scenarioList: Meta["afterhours_timing"][string] | undefined,
  startHour: number,
  endHour: number,
  weekendsOff = true
) {
  if (!scenarioList || !scenarioList.length) return undefined;
  return (
    scenarioList.find((row) =>
      row.start_hour === startHour && row.end_hour === endHour && (row.weekends_off ?? true) === weekendsOff
    ) ??
    scenarioList.find((row) => row.cutoff_hour === startHour) ??
    scenarioList[0]
  );
}

export interface CircuitPlanItem {
  circuit_id: string;
  cleanName: string;
  floor: number;
  zone: string;
  spaceName: string;
  type: string;
  classification: string;
  recommended: CircuitMode;
  mode: CircuitMode;
  /** The FM's plan differs from the model's recommendation for this circuit. */
  changedFromRecommendation: boolean;
  window: CurfewWindow;
  exception?: CurfewException;
  /** Short plain-language setting, e.g. "Kept on 24/7" or "Off 17:00–08:00 + weekends". */
  setting: string;
  baseloadKw: number;
  unoccMeanKw: number;
  savedKwh: number;
  savedThb: number;
}

/** One circuit's setting and savings under the current curfew plan. */
export function getCircuitPlanInfo(
  audit: EnergyAuditZone,
  circuit: EnergyAuditCircuit,
  meta: Meta | null,
  month: string | null,
  s: CurfewSettings
): CircuitPlanItem {
  const cid = circuit.circuit_id;
  const recommended = recommendedMode(circuit);
  const { mode, window, exception } = resolveCircuit(audit.floor, audit.zone, circuit, s);
  const unoccMeanKw = (month ? circuit.monthly[month]?.unocc_mean_kw : circuit.unocc_mean_kw) ?? circuit.baseload_kw;

  let savedKwh = 0;
  let savedThb = 0;
  if (mode === "curfew") {
    const scen = findTimingScenario(meta?.afterhours_timing[`circuit:${cid}`], window.start_hour, window.end_hour, window.weekends_off);
    savedKwh = month
      ? (scen?.monthly[month]?.kwh ?? circuit.monthly[month]?.surplus_kwh ?? 0)
      : (scen?.annual_kwh ?? circuit.annual_surplus_kwh);
    savedThb = month
      ? (scen?.monthly[month]?.cost_thb ?? circuit.monthly[month]?.cost_thb ?? 0)
      : (scen?.annual_cost_thb ?? circuit.annual_cost_thb);
  }

  return {
    circuit_id: cid,
    cleanName: cid.replace(/\(kW\)/i, ""),
    floor: audit.floor,
    zone: audit.zone,
    spaceName: zoneUse(audit.floor, audit.zone)?.name ?? `Zone ${audit.zone.slice(1)}`,
    type: circuit.type,
    classification: circuit.classification,
    recommended,
    mode,
    changedFromRecommendation: mode !== recommended,
    window,
    exception,
    setting: mode === "keep_on" ? "Kept on 24/7" : formatWindow(window),
    baseloadKw: circuit.baseload_kw,
    unoccMeanKw,
    savedKwh,
    savedThb,
  };
}

/** All circuits in a scope, biggest saving first; circuits kept on go last. */
export function getScopeCircuitPlan(meta: Meta, scope: Scope, month: string | null, s: CurfewSettings): CircuitPlanItem[] {
  const items: CircuitPlanItem[] = [];
  for (const audit of meta.energy_audit) {
    if (scope.floor !== undefined && audit.floor !== scope.floor) continue;
    if (scope.zone && audit.zone !== scope.zone) continue;
    for (const circuit of audit.circuits) items.push(getCircuitPlanInfo(audit, circuit, meta, month, s));
  }
  items.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "keep_on" ? 1 : -1;
    return b.savedThb - a.savedThb;
  });
  return items;
}

/** Total savings in a scope. `beyondRecommendationKwh` is the part from circuits the model recommends keeping on. */
export function plannedScheduleSavings(meta: Meta, scope: Scope, month: string | null, s: CurfewSettings) {
  return getScopeCircuitPlan(meta, scope, month, s).reduce(
    (total, item) => {
      total.energyKwh += item.savedKwh;
      total.costThb += item.savedThb;
      if (item.recommended === "keep_on") total.beyondRecommendationKwh += item.savedKwh;
      return total;
    },
    { energyKwh: 0, costThb: 0, beyondRecommendationKwh: 0 }
  );
}

/** For the AI Copilot: circuits the FM keeps on against a curfew recommendation, and each curfewed circuit's
 *  hours wherever they differ from the default (or the model recommends keeping it on). */
export function buildCopilotPlan(meta: Meta | null, s: CurfewSettings) {
  const keptOn: string[] = [];
  const windows: Record<string, CurfewWindow> = {};
  if (!meta) return { keptOn, windows };
  for (const audit of meta.energy_audit) {
    for (const c of audit.circuits) {
      const r = resolveCircuit(audit.floor, audit.zone, c, s);
      if (r.mode === "keep_on") {
        if (recommendedMode(c) === "curfew") keptOn.push(c.circuit_id);
      } else if (r.exception || recommendedMode(c) === "keep_on") {
        windows[c.circuit_id] = { start_hour: r.window.start_hour, end_hour: r.window.end_hour, weekends_off: r.window.weekends_off };
      }
    }
  }
  return { keptOn, windows };
}

/** Energy (kWh) and cost (THB) the plan saves in each zone, keyed like "F1:z4". Used to colour the map in What-If. */
export function useZoneSavings(meta: Meta | null, month: string | null, s: CurfewSettings) {
  const { start, end, weekendsOff, exceptions } = s;
  return useMemo(() => {
    const out = new Map<string, { kwh: number; thb: number }>();
    if (!meta) return out;
    const settings = { start, end, weekendsOff, exceptions };
    for (const audit of meta.energy_audit) {
      let kwh = 0;
      let thb = 0;
      for (const c of audit.circuits) {
        const item = getCircuitPlanInfo(audit, c, meta, month, settings);
        kwh += item.savedKwh;
        thb += item.savedThb;
      }
      out.set(`F${audit.floor}:${audit.zone}`, { kwh, thb });
    }
    return out;
  }, [meta, month, start, end, weekendsOff, exceptions]);
}

/** A zone's projected after-hours load and remaining preventable energy under the plan (3D map, What-If mode). */
export function simulatedZoneAuditMetrics(meta: Meta | null, audit: EnergyAuditZone, month: string | null, s: CurfewSettings) {
  const baseLoadKw = month ? audit.monthly[month]?.unocc_mean_kw ?? null : audit.unocc_mean_kw;
  const baseKwh = month ? audit.monthly[month]?.surplus_kwh ?? null : audit.annual_surplus_kwh;
  const baseCost = month ? audit.monthly[month]?.cost_thb ?? null : audit.annual_cost_thb;
  const unoccHours = month ? audit.monthly[month]?.unocc_hours ?? 0 : audit.annual_unocc_hours;

  if (!meta) {
    return { beforeLoadKw: baseLoadKw, afterLoadKw: baseLoadKw, savedKwh: 0, savedThb: 0, remainingKwh: baseKwh, remainingThb: baseCost };
  }

  const savings = plannedScheduleSavings(meta, { floor: audit.floor, zone: audit.zone }, month, s);
  const kwReduction = unoccHours > 0 ? savings.energyKwh / unoccHours : 0;
  return {
    beforeLoadKw: baseLoadKw,
    afterLoadKw: baseLoadKw === null ? null : Math.max(0, baseLoadKw - kwReduction),
    savedKwh: savings.energyKwh,
    savedThb: savings.costThb,
    remainingKwh: baseKwh === null ? null : Math.max(0, baseKwh - savings.energyKwh),
    remainingThb: baseCost === null ? null : Math.max(0, baseCost - savings.costThb),
  };
}

/** Office-hour AC tariff, excluding VAT: 08:00–09:00 is off-peak (฿2.5849), 09:00–17:00 less lunch is peak (฿4.3297). */
export const OFFICE_AC_THB_PER_KWH = (2.5849 + 7 * 4.3297) / 8;

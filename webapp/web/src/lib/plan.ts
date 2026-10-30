// Hierarchical curfew schedule calculations:
// Precedence: Circuit Override > Zone Override > Floor Override > Whole Building Default.
import type { CircuitWindowOverride, EnergyAuditCircuit, EnergyAuditZone, Meta } from "./api";
import type { Scope } from "./store";
import { zoneUse } from "./zones";

export interface ZoneRec {
  rate: number;
  action: string;
}

export type OverrideSource = "circuit" | "zone" | "floor" | "building";

export interface CircuitPlanItem {
  circuit_id: string;
  cleanName: string;
  floor: number;
  zone: string;
  spaceName: string;
  type: string;
  isCritical: boolean;
  isExempt: boolean;
  overrideSource: OverrideSource;
  hasCustomWindow: boolean;
  effectiveStartHour: number;
  effectiveEndHour: number;
  badge: string;
  badgeStyle: string;
  category: "curfew" | "plugs" | "keep_on";
  action: string;
  dataReason: string;
  baseloadKw: number;
  unoccMeanKw: number;
  savedKwh: number;
  savedThb: number;
}

export function resolveFloorWindow(
  floor: number,
  buildingStart: number,
  buildingEnd: number,
  floorWindows?: Record<number, CircuitWindowOverride>
): { start_hour: number; end_hour: number; isOverridden: boolean } {
  const fw = floorWindows?.[floor];
  if (fw) return { start_hour: fw.start_hour, end_hour: fw.end_hour, isOverridden: true };
  return { start_hour: buildingStart, end_hour: buildingEnd, isOverridden: false };
}

export function resolveZoneWindow(
  floor: number,
  zone: string,
  buildingStart: number,
  buildingEnd: number,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>
): { start_hour: number; end_hour: number; isOverridden: boolean; source: "zone" | "floor" | "building" } {
  const zid = `F${floor}:${zone}`;
  const zw = zoneWindows?.[zid];
  if (zw) return { start_hour: zw.start_hour, end_hour: zw.end_hour, isOverridden: true, source: "zone" };
  const fw = floorWindows?.[floor];
  if (fw) return { start_hour: fw.start_hour, end_hour: fw.end_hour, isOverridden: false, source: "floor" };
  return { start_hour: buildingStart, end_hour: buildingEnd, isOverridden: false, source: "building" };
}

export function resolveCircuitWindow(
  floor: number,
  zone: string,
  circuitId: string,
  buildingStart: number,
  buildingEnd: number,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>,
  circuitWindows?: Record<string, CircuitWindowOverride>
): { start_hour: number; end_hour: number; source: OverrideSource } {
  const cw = circuitWindows?.[circuitId];
  if (cw) return { start_hour: cw.start_hour, end_hour: cw.end_hour, source: "circuit" };
  const zid = `F${floor}:${zone}`;
  const zw = zoneWindows?.[zid];
  if (zw) return { start_hour: zw.start_hour, end_hour: zw.end_hour, source: "zone" };
  const fw = floorWindows?.[floor];
  if (fw) return { start_hour: fw.start_hour, end_hour: fw.end_hour, source: "floor" };
  return { start_hour: buildingStart, end_hour: buildingEnd, source: "building" };
}

/** Flatten all floor/zone/circuit overrides into a per-circuit window map for backend AI Copilot context. */
export function buildEffectiveCircuitWindows(
  meta: Meta | null,
  buildingStart: number,
  buildingEnd: number,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>,
  circuitWindows?: Record<string, CircuitWindowOverride>
): Record<string, CircuitWindowOverride> {
  if (!meta) return {};
  const out: Record<string, CircuitWindowOverride> = {};
  for (const audit of meta.energy_audit) {
    for (const c of audit.circuits) {
      if (c.classification === "Critical Standby") continue;
      const win = resolveCircuitWindow(
        audit.floor,
        audit.zone,
        c.circuit_id,
        buildingStart,
        buildingEnd,
        floorWindows,
        zoneWindows,
        circuitWindows
      );
      if (win.source !== "building" || win.start_hour !== buildingStart || win.end_hour !== buildingEnd) {
        out[c.circuit_id] = { start_hour: win.start_hour, end_hour: win.end_hour };
      }
    }
  }
  return out;
}

export function recommend(a: EnergyAuditZone): ZoneRec {
  const kind = zoneUse(a.floor, a.zone)?.kind;
  if (a.preventable_count === 0) {
    return {
      rate: 0,
      action: "Leave on 24/7: every circuit here is critical standby",
    };
  }
  if (kind === "plant") {
    return {
      rate: 0,
      action: "Leave on 24/7: plant equipment must keep running",
    };
  }
  if (a.classification === "Mixed") {
    return {
      rate: 50,
      action: "Switch off preventable circuits at curfew; leave critical standby on 24/7",
    };
  }
  if (kind === "circulation") {
    return {
      rate: 50,
      action: "Switch off non-essential lighting after hours; keep safety baseload on",
    };
  }
  if (kind === "exterior") {
    return {
      rate: 50,
      action: "Leave security baseload on after hours",
    };
  }
  if (kind === "lobby") {
    return {
      rate: 75,
      action: "Switch off sitting hall circuits from 17:00 to 08:00",
    };
  }
  return {
    rate: 90,
    action: "Switch off from 17:00 to 08:00 outside office hours",
  };
}

export function findTimingScenario(
  scenarioList: Meta["afterhours_timing"][string] | undefined,
  startHour: number,
  endHour: number
) {
  if (!scenarioList || !scenarioList.length) return undefined;
  return (
    scenarioList.find((row) =>
      row.start_hour !== undefined
        ? row.start_hour === startHour && row.end_hour === endHour
        : row.cutoff_hour === startHour
    ) ??
    scenarioList.find((row) => row.cutoff_hour === startHour) ??
    scenarioList[0]
  );
}

/** Build a circuit schedule item using Circuit > Zone > Floor > Building precedence. */
export function getCircuitPlanInfo(
  audit: EnergyAuditZone,
  circuit: EnergyAuditCircuit,
  meta: Meta | null,
  month: string | null,
  buildingStartHour: number,
  buildingEndHour: number,
  circuitExemptions?: Record<string, boolean>,
  circuitWindows?: Record<string, CircuitWindowOverride>,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>
): CircuitPlanItem {
  const cid = circuit.circuit_id;
  const cleanName = cid.replace(/\(kW\)/i, "");
  const use = zoneUse(audit.floor, audit.zone);
  const spaceName = use?.name ?? `Zone ${audit.zone.slice(1)}`;

  const ratio = circuit.unocc_to_occ_ratio ?? 0;
  const cv = circuit.offhours_cv ?? 0;
  const isCritical = circuit.classification === "Critical Standby";
  const isExempt = !isCritical && !!circuitExemptions?.[cid];

  const resolved = resolveCircuitWindow(
    audit.floor,
    audit.zone,
    cid,
    buildingStartHour,
    buildingEndHour,
    floorWindows,
    zoneWindows,
    circuitWindows
  );
  const effStart = resolved.start_hour;
  const effEnd = resolved.end_hour;
  const hasCustomWindow = resolved.source !== "building";
  const endFmt = String(effEnd).padStart(2, "0");

  const timingList = meta?.afterhours_timing[`circuit:${cid}`] ?? [];
  const scen = findTimingScenario(timingList, effStart, effEnd);

  const unoccMeanKw =
    (month ? circuit.monthly[month]?.unocc_mean_kw : circuit.unocc_mean_kw) ??
    circuit.baseload_kw;
  const baseloadKw = circuit.baseload_kw;

  // 1. Critical Standby — locked ON 24/7
  if (isCritical) {
    return {
      circuit_id: cid,
      cleanName,
      floor: audit.floor,
      zone: audit.zone,
      spaceName,
      type: circuit.type,
      isCritical: true,
      isExempt: false,
      overrideSource: "building",
      hasCustomWindow: false,
      effectiveStartHour: buildingStartHour,
      effectiveEndHour: buildingEndHour,
      badge: "🔒 ON 24/7",
      badgeStyle: "badge-keep",
      category: "keep_on",
      action: "Locked ON 24/7",
      dataReason: `Critical Standby · Baseload ${baseloadKw.toFixed(2)} kW, Unoccupied ${unoccMeanKw.toFixed(2)} kW (Ratio ${ratio.toFixed(2)}, CV ${cv.toFixed(2)})`,
      baseloadKw,
      unoccMeanKw,
      savedKwh: 0,
      savedThb: 0,
    };
  }

  const rawKwh = month
    ? (scen?.monthly[month]?.kwh ?? circuit.monthly[month]?.surplus_kwh ?? 0)
    : (scen?.annual_kwh ?? circuit.annual_surplus_kwh);
  const rawThb = month
    ? (scen?.monthly[month]?.cost_thb ?? circuit.monthly[month]?.cost_thb ?? 0)
    : (scen?.annual_cost_thb ?? circuit.annual_cost_thb);

  // 2. Preventable Waste circuit manually exempted by FM (Kept ON 24/7)
  if (isExempt) {
    return {
      circuit_id: cid,
      cleanName,
      floor: audit.floor,
      zone: audit.zone,
      spaceName,
      type: circuit.type,
      isCritical: false,
      isExempt: true,
      overrideSource: "circuit",
      hasCustomWindow: false,
      effectiveStartHour: effStart,
      effectiveEndHour: effEnd,
      badge: "ON 24/7 (Exempt)",
      badgeStyle: "badge-keep",
      category: "keep_on",
      action: "Kept ON 24/7 (Manual Override)",
      dataReason: `Preventable Waste · Manually exempted from curfew (Baseload ${baseloadKw.toFixed(2)} kW, Unoccupied ${unoccMeanKw.toFixed(2)} kW)`,
      baseloadKw,
      unoccMeanKw,
      savedKwh: 0,
      savedThb: 0,
    };
  }

  const schedBadge = `Off ${effStart}:00–${endFmt}:00`;
  const isPlug = circuit.type.toLowerCase().includes("plug");
  const sourceNote =
    resolved.source === "circuit"
      ? " · Circuit override"
      : resolved.source === "zone"
        ? " · Zone override"
        : resolved.source === "floor"
          ? " · Floor override"
          : "";

  return {
    circuit_id: cid,
    cleanName,
    floor: audit.floor,
    zone: audit.zone,
    spaceName,
    type: circuit.type,
    isCritical: false,
    isExempt: false,
    overrideSource: resolved.source,
    hasCustomWindow,
    effectiveStartHour: effStart,
    effectiveEndHour: effEnd,
    badge: schedBadge,
    badgeStyle: hasCustomWindow ? "badge-amber" : "badge-curfew",
    category: isPlug ? "plugs" : "curfew",
    action: schedBadge,
    dataReason: `Preventable Waste · Baseload ${baseloadKw.toFixed(2)} kW vs Unoccupied ${unoccMeanKw.toFixed(2)} kW${sourceNote}`,
    baseloadKw,
    unoccMeanKw,
    savedKwh: rawKwh,
    savedThb: rawThb,
  };
}

/** Compile all circuit schedule items for a scope. */
export function getScopeCircuitPlan(
  meta: Meta,
  scope: Scope,
  buildingStartHour: number,
  buildingEndHour: number,
  month: string | null,
  circuitExemptions?: Record<string, boolean>,
  circuitWindows?: Record<string, CircuitWindowOverride>,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>
): CircuitPlanItem[] {
  const audits = meta.energy_audit.filter(
    (audit) =>
      (scope.floor === undefined || audit.floor === scope.floor) &&
      (!scope.zone || audit.zone === scope.zone)
  );
  const items: CircuitPlanItem[] = [];
  for (const audit of audits) {
    for (const circuit of audit.circuits) {
      items.push(
        getCircuitPlanInfo(
          audit,
          circuit,
          meta,
          month,
          buildingStartHour,
          buildingEndHour,
          circuitExemptions,
          circuitWindows,
          floorWindows,
          zoneWindows
        )
      );
    }
  }
  items.sort((a, b) => {
    if (a.isCritical && !b.isCritical) return 1;
    if (!a.isCritical && b.isCritical) return -1;
    return b.savedThb - a.savedThb;
  });
  return items;
}

/** Schedule savings under the active What-If hierarchy (Building -> Floor -> Zone -> Circuit). */
export function plannedScheduleSavings(
  meta: Meta,
  scope: Scope,
  startHourOrCutoff: number,
  endHourOrMonth?: number | string | null,
  monthParam?: string | null,
  circuitExemptions?: Record<string, boolean>,
  circuitWindows?: Record<string, CircuitWindowOverride>,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>
) {
  const isDual = typeof endHourOrMonth === "number";
  const startHour = startHourOrCutoff;
  const endHour = isDual ? (endHourOrMonth as number) : 8;
  const month = isDual ? (monthParam ?? null) : ((endHourOrMonth as string | null) ?? null);

  const items = getScopeCircuitPlan(
    meta,
    scope,
    startHour,
    endHour,
    month,
    circuitExemptions,
    circuitWindows,
    floorWindows,
    zoneWindows
  );
  return items.reduce(
    (total, item) => {
      total.energyKwh += item.savedKwh;
      total.costThb += item.savedThb;
      return total;
    },
    { energyKwh: 0, costThb: 0 }
  );
}

/** Compute a zone's post-curfew projected mean unoccupied load (kW) and remaining preventable kWh/THB for 3D map & grid in What-If mode. */
export function simulatedZoneAuditMetrics(
  meta: Meta | null,
  audit: EnergyAuditZone,
  buildingStartHour: number,
  buildingEndHour: number,
  month: string | null,
  circuitExemptions?: Record<string, boolean>,
  circuitWindows?: Record<string, CircuitWindowOverride>,
  floorWindows?: Record<number, CircuitWindowOverride>,
  zoneWindows?: Record<string, CircuitWindowOverride>
) {
  const baseLoadKw = month ? audit.monthly[month]?.unocc_mean_kw ?? null : audit.unocc_mean_kw;
  const baseKwh = month ? audit.monthly[month]?.surplus_kwh ?? null : audit.annual_surplus_kwh;
  const baseCost = month ? audit.monthly[month]?.cost_thb ?? null : audit.annual_cost_thb;
  const unoccHours = month ? audit.monthly[month]?.unocc_hours ?? 0 : audit.annual_unocc_hours;

  if (!meta) {
    return {
      beforeLoadKw: baseLoadKw,
      afterLoadKw: baseLoadKw,
      savedKwh: 0,
      savedThb: 0,
      remainingKwh: baseKwh,
      remainingThb: baseCost,
    };
  }

  const savings = plannedScheduleSavings(
    meta,
    { floor: audit.floor, zone: audit.zone },
    buildingStartHour,
    buildingEndHour,
    month,
    circuitExemptions,
    circuitWindows,
    floorWindows,
    zoneWindows
  );

  const kwReduction = unoccHours > 0 ? savings.energyKwh / unoccHours : 0;
  const afterLoadKw = baseLoadKw === null ? null : Math.max(0, baseLoadKw - kwReduction);
  const remainingKwh = baseKwh === null ? null : Math.max(0, baseKwh - savings.energyKwh);
  const remainingThb = baseCost === null ? null : Math.max(0, baseCost - savings.costThb);

  return {
    beforeLoadKw: baseLoadKw,
    afterLoadKw,
    savedKwh: savings.energyKwh,
    savedThb: savings.costThb,
    remainingKwh,
    remainingThb,
  };
}

/** Office-hour AC tariff, excluding VAT: 08:00–09:00 is off-peak (฿2.5849), 09:00–17:00 less lunch is peak (฿4.3297). */
export const OFFICE_AC_THB_PER_KWH = (2.5849 + 7 * 4.3297) / 8;

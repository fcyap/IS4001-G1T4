// The recommended plan: realistic physical controls for after-hours waste reduction
// based on zone type and circuit classification.
import type { EnergyAuditZone, Meta } from "./api";
import type { Scope } from "./store";
import { zoneUse } from "./zones";

export type PhysicalControlType = "bems_curfew" | "pir_sensor" | "critical_standby" | "facade_timer";

export interface ZoneRec {
  rate: number;
  action: string;
  controlType: PhysicalControlType;
  categoryLabel: string;
  hardwareMeasure: string;
}

export function recommend(a: EnergyAuditZone): ZoneRec {
  const kind = zoneUse(a.floor, a.zone)?.kind;
  if (a.preventable_count === 0) {
    return {
      rate: 0,
      action: "Leave on: every circuit here is critical standby",
      controlType: "critical_standby",
      categoryLabel: "24/7 Mission-Critical",
      hardwareMeasure: "Circuit whitelist lock (curfew sweep exempt)",
    };
  }
  if (kind === "plant") {
    return {
      rate: 0,
      action: "Leave on: plant equipment must keep running",
      controlType: "critical_standby",
      categoryLabel: "24/7 Plant Facility",
      hardwareMeasure: "Breaker interlock (curfew sweep exempt)",
    };
  }
  if (a.classification === "Mixed") {
    return {
      rate: 50,
      action: "Cut the schedule-driven circuits only; some are standby",
      controlType: "pir_sensor",
      categoryLabel: "PIR Motion Automation",
      hardwareMeasure: "PIR motion sensor + 15-min auto-off timer",
    };
  }
  if (kind === "circulation") {
    return {
      rate: 50,
      action: "Occupancy sensors on stair lighting; keep egress lighting on",
      controlType: "pir_sensor",
      categoryLabel: "PIR Motion Automation",
      hardwareMeasure: "PIR motion sensor + 15-min auto-off timer",
    };
  }
  if (kind === "exterior") {
    return {
      rate: 50,
      action: "Timer or photocell; keep security lighting on",
      controlType: "facade_timer",
      categoryLabel: "Photocell / Timer Relay",
      hardwareMeasure: "Astronomical time clock / photocell relay",
    };
  }
  if (kind === "lobby") {
    return {
      rate: 75,
      action: "Tie hall lighting to opening hours; keep a security level on",
      controlType: "pir_sensor",
      categoryLabel: "Lobby Step-Down Automation",
      hardwareMeasure: "2-stage contactor relay with security bypass",
    };
  }
  return {
    rate: 90,
    action: "Switch-off schedule at the end of the working day, with a late-work override",
    controlType: "bems_curfew",
    categoryLabel: "BEMS Curfew Sweep",
    hardwareMeasure: "BEMS scheduled contactor relay with local 2-hr override button",
  };
}

/** Schedule savings under the zone-specific rates and circuit exemptions. Supports both dual slider (start, end) and legacy cutoff. */
export function plannedScheduleSavings(
  meta: Meta,
  scope: Scope,
  startHourOrCutoff: number,
  endHourOrMonth?: number | string | null,
  monthParam?: string | null,
  circuitExemptions?: Record<string, boolean>
) {
  const isDual = typeof endHourOrMonth === "number";
  const startHour = startHourOrCutoff;
  const endHour = isDual ? (endHourOrMonth as number) : 8;
  const month = isDual ? (monthParam ?? null) : (endHourOrMonth as string | null);

  const findScenario = (scenarioList: Meta["afterhours_timing"][string] | undefined) => {
    if (!scenarioList || !scenarioList.length) return undefined;
    return (
      scenarioList.find((row) => (row.start_hour !== undefined ? row.start_hour === startHour && row.end_hour === endHour : row.cutoff_hour === startHour)) ??
      scenarioList.find((row) => row.cutoff_hour === startHour) ??
      scenarioList[0]
    );
  };

  return meta.energy_audit
    .filter((audit) => (scope.floor === undefined || audit.floor === scope.floor)
      && (!scope.zone || audit.zone === scope.zone))
    .reduce((total, audit) => {
      const rec = recommend(audit);
      const scenario = findScenario(meta.afterhours_timing[audit.id]);
      let energy = month ? scenario?.monthly[month]?.kwh ?? 0 : scenario?.annual_kwh ?? 0;
      let cost = month ? scenario?.monthly[month]?.cost_thb ?? 0 : scenario?.annual_cost_thb ?? 0;

      // Subtract savings for any circuit explicitly exempted by the user in this zone
      if (circuitExemptions) {
        for (const circuit of audit.circuits) {
          if (circuitExemptions[circuit.circuit_id]) {
            const circuitScenario = findScenario(meta.afterhours_timing[`circuit:${circuit.circuit_id}`]);
            const cEnergy = month ? circuitScenario?.monthly[month]?.kwh ?? 0 : circuitScenario?.annual_kwh ?? 0;
            const cCost = month ? circuitScenario?.monthly[month]?.cost_thb ?? 0 : circuitScenario?.annual_cost_thb ?? 0;
            energy = Math.max(0, energy - cEnergy);
            cost = Math.max(0, cost - cCost);
          }
        }
      }

      const fraction = rec.rate / 100;
      total.energyKwh += energy * fraction;
      total.costThb += cost * fraction;
      return total;
    }, { energyKwh: 0, costThb: 0 });
}

/** Office-hour AC tariff, excluding VAT: 08:00–09:00 is off-peak (฿2.5849), 09:00–17:00 less lunch is peak (฿4.3297). */
export const OFFICE_AC_THB_PER_KWH = (2.5849 + 7 * 4.3297) / 8;

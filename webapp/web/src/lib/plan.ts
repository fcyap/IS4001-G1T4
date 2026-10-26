// The recommended plan: how much preventable after-hours load to cut in each zone, from the zone's type of
// space and its circuit classification. These are rules of thumb for a facilities manager to start from,
// not fitted values; change the rates here.
import type { EnergyAuditZone, Meta } from "./api";
import type { Scope } from "./store";
import { zoneUse } from "./zones";

export interface ZoneRec { rate: number; action: string }

export function recommend(a: EnergyAuditZone): ZoneRec {
  const kind = zoneUse(a.floor, a.zone)?.kind;
  if (a.preventable_count === 0) return { rate: 0, action: "Leave on: every circuit here is critical standby" };
  if (kind === "plant") return { rate: 0, action: "Leave on: plant equipment must keep running" };
  if (a.classification === "Mixed") return { rate: 50, action: "Cut the schedule-driven circuits only; some are standby" };
  if (kind === "circulation") return { rate: 50, action: "Occupancy sensors on stair lighting; keep egress lighting on" };
  if (kind === "exterior") return { rate: 50, action: "Timer or photocell; keep security lighting on" };
  if (kind === "lobby") return { rate: 75, action: "Tie hall lighting to opening hours; keep a security level on" };
  return { rate: 90, action: "Switch-off schedule at the end of the working day, with a late-work override" };
}

/** Schedule savings under the zone-specific rates used by the Recommended Plan. */
export function plannedScheduleSavings(meta: Meta, scope: Scope, cutoff: number, month: string | null) {
  return meta.energy_audit
    .filter((audit) => (scope.floor === undefined || audit.floor === scope.floor)
      && (!scope.zone || audit.zone === scope.zone))
    .reduce((total, audit) => {
      const scenario = meta.afterhours_timing[audit.id]?.find((row) => row.cutoff_hour === cutoff);
      const energy = month ? scenario?.monthly[month]?.kwh ?? 0 : scenario?.annual_kwh ?? 0;
      const cost = month ? scenario?.monthly[month]?.cost_thb ?? 0 : scenario?.annual_cost_thb ?? 0;
      const fraction = recommend(audit).rate / 100;
      total.energyKwh += energy * fraction;
      total.costThb += cost * fraction;
      return total;
    }, { energyKwh: 0, costThb: 0 });
}

/** Office-hour AC tariff, excluding VAT: 08:00–09:00 is off-peak (฿2.5849), 09:00–17:00 less lunch is peak (฿4.3297). */
export const OFFICE_AC_THB_PER_KWH = (2.5849 + 7 * 4.3297) / 8;

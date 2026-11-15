// The facilities manager's first view: a short summary of the building (or a floor) for the open
// question, then ranked floors or zones to click into. The detailed sections sit below it.
// Cooling comfort shows only overcooling and AC; after-hours waste keeps its own summary.
import type { EnergyAuditZone, ZoneInfo, ZoneResult } from "../lib/api";
import { rollup, useData } from "../lib/data";
import { acThb, kwh, n0 } from "../lib/format";
import { monthLabel, useStore } from "../lib/store";
import { zoneUse } from "../lib/zones";
import { Section, Stat } from "./PanelPrimitives";

interface Group { key: string; label: string; sub?: string; zones: ZoneInfo[]; onPick?: () => void }
interface Row extends Group { kwh: number; thb: number; tooCool: number; hasComfort: boolean }

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const pct = (v: number, total: number) => (total > 0 ? `${n0((v / total) * 100)} %` : "–");

function useRows(groups: Group[]): Row[] {
  const { byId, auditById } = useData();
  const month = useStore((s) => s.month);
  return groups.map((g) => {
    const audits = g.zones.map((z) => auditById.get(z.id)).filter((a): a is EnergyAuditZone => !!a);
    const results = g.zones.map((z) => byId.get(z.id)).filter((r): r is ZoneResult => !!r);
    const c = rollup(results, false);
    return {
      ...g,
      kwh: audits.reduce((n, a) => n + (month ? a.monthly[month]?.surplus_kwh ?? 0 : a.annual_surplus_kwh), 0),
      thb: audits.reduce((n, a) => n + (month ? a.monthly[month]?.cost_thb ?? 0 : a.annual_cost_thb), 0),
      tooCool: c.pct_too_cool,
      hasComfort: c.periods > 0,
    };
  });
}

function RankedList({ rows, byWaste, total }: { rows: Row[]; byWaste: boolean; total: number }) {
  const sorted = [...rows].sort((a, b) => byWaste ? b.kwh - a.kwh
    : (b.hasComfort ? b.tooCool : -1) - (a.hasComfort ? a.tooCool : -1));
  const max = Math.max(...sorted.map((r) => byWaste ? r.kwh : r.hasComfort ? r.tooCool : 0), 1e-9);
  return <>
    <ol className="rank">
      {sorted.map((r) => {
        const v = byWaste ? r.kwh : r.hasComfort ? r.tooCool : 0;
        const Tag = r.onPick ? "button" : "div";
        return (
          <li key={r.key}>
            <Tag className="rank-row" onClick={r.onPick} type={r.onPick ? "button" : undefined}>
              <span className="rank-name"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
              <span className="rank-bar"><i style={{ width: `${(v / max) * 100}%`, background: byWaste ? "var(--warm)" : "var(--cool)" }} /></span>
              <span className="rank-val">
                <b>{byWaste ? kwh(r.kwh) : r.hasComfort ? `${n0(r.tooCool)} %` : "No sensor"}</b>
                <small>{byWaste ? `${pct(r.kwh, total)} of waste` : `${kwh(r.kwh)} waste`}</small>
              </span>
            </Tag>
          </li>
        );
      })}
    </ol>
  </>;
}

/** Floors when looking at the whole building, zones when looking at one floor. */
function useChildren(zones: ZoneInfo[]): Group[] {
  const scope = useStore((s) => s.scope);
  const select = useStore((s) => s.select);
  return scope.floor === undefined
    ? [...new Set(zones.map((z) => z.floor))].sort((a, b) => a - b).map((f) => ({
      key: `F${f}`, label: `Floor ${f}`, zones: zones.filter((z) => z.floor === f), onPick: () => select({ floor: f }),
    }))
    : zones.map((z) => ({
      key: z.id, label: `Zone ${z.zone.slice(1)}`, sub: zoneUse(z.floor, z.zone)?.name, zones: [z],
      onPick: () => select({ floor: z.floor, zone: z.zone }),
    }));
}

// --- Cooling comfort (Question 2): overcooling and AC only ------------------------------------
interface CoolRow extends Group { tooCool: number; comfortable: number; acKwh: number; hasComfort: boolean; noAc: boolean }

/** AC zones only: a stairwell (zone 3) has no AC, so no setpoint can change it. Only Floor 2's
 *  stairwell has a sensor, and counting it would pull that floor from 81 % to 60 % too cool. */
function useCoolRows(groups: Group[]): CoolRow[] {
  const { byId } = useData();
  return groups.map((g) => {
    const c = rollup(g.zones.filter((z) => z.has_ac).map((z) => byId.get(z.id)).filter((r): r is ZoneResult => !!r), false);
    return { ...g, tooCool: c.pct_too_cool, comfortable: c.pct_comfortable, acKwh: c.ac_kwh, hasComfort: c.periods > 0,
      noAc: g.zones.every((z) => !z.has_ac) };
  });
}

/** "Start here" picks the biggest saving among zones humid at most this share of office time after the change. */
const HUMID_OK_PCT = 20;
const mwhYr = (kwhYr: number) => `${(kwhYr / 1000).toFixed(1)} MWh/yr`;

function CoolingGlance({ zones }: { zones: ZoneInfo[] }) {
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const period = month ? monthLabel(month) : "All Sensor Months";
  const building = scope.floor === undefined;
  const [all] = useCoolRows([{ key: "all", label: "All", zones }]);
  const rows = useCoolRows(useChildren(zones));
  const zoneRows = useCoolRows(zones.map((z) => ({ key: z.id, label: z.zone, zones: [z] })));
  const sorted = [...rows].sort((a, b) => (b.hasComfort ? b.tooCool : -1) - (a.hasComfort ? a.tooCool : -1));
  const saving = (r: CoolRow) => r.zones.reduce((n, z) => n + (z.rule?.annual_kwh_saved ?? 0), 0);
  const name = (z: ZoneInfo) => (building ? `F${z.floor} z${z.zone.slice(1)}` : `Zone ${z.zone.slice(1)}`);

  // 1 · How much: Jul–Sep 2018 vs 2019, the zones with reliable sensors in both years.
  const reliable = zones.filter((z) => z.has_ac && !z.inspect && z.jul_sep);
  const yr = (y: "2018" | "2019") => {
    const p = reliable.reduce((n, z) => n + z.jul_sep![y].periods, 0);
    return { cool: p ? (reliable.reduce((n, z) => n + z.jul_sep![y].too_cool, 0) / p) * 100 : NaN };
  };
  const [y18, y19] = [yr("2018"), yr("2019")];

  // 2 · Where: the floor (or, on a floor, the zone) too cool most often, and the coldest reliable zone.
  const ranked = (building ? sorted : [...zoneRows].sort((a, b) => b.tooCool - a.tooCool))
    .filter((r) => r.hasComfort && !r.noAc && !(r.zones.length === 1 && r.zones[0].inspect));
  const [first, second] = ranked;
  const coldest = zoneRows.filter((r) => r.hasComfort && !r.noAc && !r.zones[0].inspect)
    .sort((a, b) => b.tooCool - a.tooCool)[0]?.zones[0];

  // 3 · Who first: the biggest yearly saving among zones the rule leaves no more than HUMID_OK_PCT humid.
  const candidates = zones.filter((z) => z.rule && z.rule.annual_kwh_saved > 0 && !z.inspect);
  const start = candidates.filter((z) => z.rule!.pct_humid_after <= HUMID_OK_PCT)
    .sort((a, b) => b.rule!.annual_kwh_saved - a.rule!.annual_kwh_saved)[0];

  return (
    <Section title={building ? "Building at a Glance" : `Floor ${scope.floor} at a Glance`}
      aside={<span className="aside">{period}</span>} className="glance">
      <div className="stats">
        {all.hasComfort && (
          <div>
            <Stat label="Office Time Too Cool" value={n0(all.tooCool)} unit="%" hint="PMV below −0.5, AC zones only" />
            {reliable.length > 0 && <p className="stat-note">Jul–Sep 2018: {n0(y18.cool)} %; 2019: {n0(y19.cool)} %</p>}
          </div>
        )}
        {first && (
          <div>
            <Stat label={building ? "Most Overcooled Floor" : "Most Overcooled Zone"}
              value={building ? first.label : name(first.zones[0])} unit={`${n0(first.tooCool)} % too cool`}
              hint="Share of office time too cool, AC zones only" />
            {building && coldest
              ? <p className="stat-note">Coldest zone: {name(coldest)} ({n0(zoneRows.find((r) => r.zones[0] === coldest)?.tooCool)} %)</p>
              : second && <p className="stat-note">Next: {name(second.zones[0])} ({n0(second.tooCool)} %)</p>}
          </div>
        )}
        <div>
          <Stat label="Start With" value={start ? name(start) : "–"}
            unit={start ? mwhYr(start.rule!.annual_kwh_saved) : "no low-risk zone"}
            hint={`Biggest yearly saving among zones no more than ${HUMID_OK_PCT} % humid after the change`} />
          {start && <p className="stat-note">Raise +{n0(start.rule!.typical_raise_c)} °C · {acThb(start.rule!.annual_kwh_saved)}/yr</p>}
        </div>
      </div>
      <h3 className="glance-h">{building ? "Floors" : "Zones"} by time too cool</h3>
      <ol className="rank rank-cool">
        {sorted.map((r) => {
          const Tag = r.onPick ? "button" : "div";
          return (
            <li key={r.key}>
              <Tag className="rank-row" onClick={r.onPick} type={r.onPick ? "button" : undefined}>
                <span className="rank-name"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
                <span className="rank-bar"><i style={{ width: `${r.hasComfort ? r.tooCool : 0}%`, background: "var(--cool)" }} /></span>
                <span className="rank-val">
                  <b>{r.hasComfort ? `${n0(r.tooCool)} %` : r.noAc ? "No AC" : "No sensor"}</b>
                  {r.hasComfort && <small>{saving(r) > 0 ? `Save ${(saving(r) / 1000).toFixed(1)} MWh · ${acThb(saving(r))}/yr` : "no saving set"}</small>}
                </span>
              </Tag>
            </li>
          );
        })}
      </ol>
      <p className="note">
        AC zones only. Stairwells (zone 3) have no AC; Floor 2’s is the only one with a sensor.
        {" "}Savings are per year under the recommended rule; baht at the office-hour AC tariff, excl. VAT.
      </p>
    </Section>
  );
}

export default function Overview({ zones }: { zones: ZoneInfo[] }) {
  const topic = useStore((s) => s.topic);
  return topic === "comfort" ? <CoolingGlance zones={zones} /> : <WasteGlance zones={zones} />;
}

// --- After-hours waste (Question 1) -----------------------------------------------------------
function WasteGlance({ zones }: { zones: ZoneInfo[] }) {
  const scope = useStore((s) => s.scope);
  const topic = useStore((s) => s.topic);
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.select);
  const byWaste = topic !== "comfort";
  const period = month ? monthLabel(month) : "Jul 2018–Jun 2019";

  const [all] = useRows([{ key: "all", label: "All", zones }]);

  // Floors when looking at the whole building, zones when looking at one floor.
  const children: Group[] = scope.floor === undefined
    ? [...new Set(zones.map((z) => z.floor))].sort((a, b) => a - b).map((f) => ({
      key: `F${f}`, label: `Floor ${f}`, zones: zones.filter((z) => z.floor === f), onPick: () => select({ floor: f }),
    }))
    : zones.map((z) => ({
      key: z.id, label: `Zone ${z.zone.slice(1)}`, sub: zoneUse(z.floor, z.zone)?.name, zones: [z],
      onPick: () => select({ floor: z.floor, zone: z.zone }),
    }));
  const childRows = useRows(children);

  const zoneRows = useRows(zones.map((z) => ({ key: z.id, label: `Floor ${z.floor}, zone ${z.zone.slice(1)}`, zones: [z] })));
  const top = [...zoneRows].sort((a, b) => b.kwh - a.kwh)[0];
  const topUse = top ? zoneUse(top.zones[0].floor, top.zones[0].zone) : null;
  const where = scope.floor === undefined ? "the building" : `Floor ${scope.floor}`;

  return (
    <Section title={scope.floor === undefined ? "Building at a Glance" : `Floor ${scope.floor} at a Glance`}
      aside={<span className="aside">{period}</span>} className="glance">
      <div className="stats">
        {byWaste && (
          <Stat label="After-hours Waste" value={kwh(all.kwh)} unit={thb(all.thb)}
            hint="Above circuit baseloads, excl. VAT" />
        )}
        {!byWaste && (
          <Stat label="Office Time Too Cool" value={all.hasComfort ? n0(all.tooCool) : "–"} unit="%"
            hint="PMV below −0.5, sensor zones only" />
        )}
      </div>
      {byWaste && top && top.kwh > 0 && topUse && (
        <p className="glance-lead">
          Biggest opportunity in {where}: <b>{top.label}</b> ({topUse.name.toLowerCase()}),
          {" "}{kwh(top.kwh)}, {pct(top.kwh, all.kwh)} of the total.{" "}
          <button type="button" className="link" onClick={() => select({ floor: top.zones[0].floor, zone: top.zones[0].zone })}>Open</button>
        </p>
      )}

      <h3 className="glance-h">{scope.floor === undefined ? "Floors" : "Zones"} by {byWaste ? "after-hours waste" : "time too cool"}</h3>
      <RankedList rows={childRows} byWaste={byWaste} total={all.kwh} />
    </Section>
  );
}

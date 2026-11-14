// The facilities manager's first view: a short summary of the building (or a floor) across both
// questions, then ranked floors or zones to click into. The detailed sections sit below it.
import type { EnergyAuditZone, ZoneInfo, ZoneResult } from "../lib/api";
import { rollup, useData } from "../lib/data";
import { kwh, n0 } from "../lib/format";
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

export default function Overview({ zones }: { zones: ZoneInfo[] }) {
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
            hint="Above circuit baselines, excl. VAT" />
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

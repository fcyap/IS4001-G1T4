import { useState } from "react";
import type { ZoneInfo } from "../lib/api";
import { useData } from "../lib/data";
import { kwh } from "../lib/format";
import { getScopeCircuitPlan } from "../lib/plan";
import { monthLabel, useStore } from "../lib/store";
import { Section } from "./PanelPrimitives";

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const SHOWN = 10;
const START_HOURS = [17, 18, 19, 20, 21, 22, 23];
const END_HOURS = [5, 6, 7, 8];

export default function QuestionAPlan(_props: { zones: ZoneInfo[] }) {
  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.select);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const floorWindows = useStore((s) => s.auditFloorWindows);
  const zoneWindows = useStore((s) => s.auditZoneWindows);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);
  const circuitWindows = useStore((s) => s.auditCircuitWindows);
  const toggleCircuitExemption = useStore((s) => s.toggleCircuitExemption);
  const setCircuitWindow = useStore((s) => s.setCircuitWindow);
  const clearCircuitWindow = useStore((s) => s.clearCircuitWindow);
  const resetCircuitExemptions = useStore((s) => s.resetCircuitExemptions);

  const [showAll, setShowAll] = useState(false);

  const period = month ? `in ${monthLabel(month)}` : "a year";

  const circuitItems = meta
    ? getScopeCircuitPlan(
        meta,
        scope,
        startHour,
        endHour,
        month,
        circuitExemptions,
        circuitWindows,
        floorWindows,
        zoneWindows
      )
    : [];

  const totalThb = circuitItems.reduce((acc, c) => acc + c.savedThb, 0);
  const totalKwh = circuitItems.reduce((acc, c) => acc + c.savedKwh, 0);
  const curfewCount = circuitItems.filter((c) => !c.isCritical && !c.isExempt).length;
  const criticalCount = circuitItems.filter((c) => c.isCritical).length;
  const overrideCount =
    Object.keys(floorWindows).length +
    Object.keys(zoneWindows).length +
    Object.keys(circuitExemptions).filter((k) => circuitExemptions[k]).length +
    Object.keys(circuitWindows).length;

  return (
    <Section
      title="Circuit Curfew Schedule"
      aside={
        overrideCount > 0 ? (
          <button type="button" className="link" onClick={resetCircuitExemptions}>
            Reset {overrideCount} Override{overrideCount > 1 ? "s" : ""}
          </button>
        ) : (
          <span className="aside">{month ? monthLabel(month) : "Per Year"}</span>
        )
      }
      className="plan"
      collapsible
      defaultOpen={true}
    >
      <div className="plan-total">
        <span className="stat-label">Schedule saves</span>
        <span className="big">{thb(totalThb)}</span>
        <span className="sub">
          {kwh(totalKwh)} {period} · <b>{curfewCount}</b> on curfew, <b>{criticalCount}</b> critical standby always on
        </span>
      </div>

      <p className="note plan-precedence">
        The most specific setting wins: circuit, then zone, floor, building.
      </p>

      <ol className="plan-zones">
        {(showAll ? circuitItems : circuitItems.slice(0, SHOWN)).map((c) => {
          const isCircuitModified = c.isExempt || c.overrideSource === "circuit";
          return (
            <li key={c.circuit_id} className="plan-circuit-row">
              <div className="plan-zone plan-circuit-item">
                {c.isCritical ? (
                  <span className="plan-rate badge-keep" title="Critical standby circuit, always on">
                    Always on
                  </span>
                ) : (
                  <div className="circuit-inline-controls">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!c.isExempt}
                      aria-label={`After-hours curfew for ${c.cleanName}`}
                      className={`plan-rate ${c.isExempt ? "badge-keep" : c.hasCustomWindow ? "badge-amber" : "badge-curfew"}`}
                      onClick={() => toggleCircuitExemption(c.circuit_id)}
                      title={c.isExempt ? "Put this circuit back on the after-hours curfew" : "Exempt this circuit so it stays on 24/7"}
                    >
                      {c.isExempt ? "Exempt" : "On curfew"}
                    </button>
                    {!c.isExempt && (
                      <div className="circuit-window-selects" role="group" aria-label={`Curfew hours for ${c.cleanName}`}>
                        <select
                          className="mini"
                          value={c.effectiveStartHour}
                          onChange={(e) => setCircuitWindow(c.circuit_id, +e.target.value, c.effectiveEndHour)}
                          aria-label="Curfew start hour"
                        >
                          {START_HOURS.map((h) => (
                            <option key={h} value={h}>{h}:00</option>
                          ))}
                        </select>
                        <span aria-hidden>–</span>
                        <select
                          className="mini"
                          value={c.effectiveEndHour}
                          onChange={(e) => setCircuitWindow(c.circuit_id, c.effectiveStartHour, +e.target.value)}
                          aria-label="Curfew end hour"
                        >
                          {END_HOURS.map((h) => (
                            <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <span className="plan-zone-name">
                  <button
                    type="button"
                    className="plan-zone-link"
                    onClick={() => select({ floor: c.floor, zone: c.zone })}
                    title={`Open Floor ${c.floor}, Zone ${c.zone.slice(1)}`}
                  >
                    F{c.floor} Z{c.zone.slice(1)} · {c.cleanName.replace(/^Floor\d+_/, "")} <small>({c.spaceName})</small>
                  </button>
                  <small>
                    {c.dataReason}
                    {isCircuitModified && (
                      <>
                        {" · "}
                        <button type="button" className="link" onClick={() => clearCircuitWindow(c.circuit_id)}>
                          Reset circuit
                        </button>
                      </>
                    )}
                  </small>
                </span>

                <span className="plan-zone-val">
                  {c.isCritical || c.isExempt ? "Always on" : thb(c.savedThb)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {circuitItems.length > SHOWN && (
        <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? `Show top ${SHOWN} circuits` : `Show all ${circuitItems.length} circuits`}
        </button>
      )}
    </Section>
  );
}

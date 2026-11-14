import { useState } from "react";
import type { ZoneInfo } from "../lib/api";
import { useData } from "../lib/data";
import { kwh } from "../lib/format";
import { getScopeCircuitPlan, useCurfewSettings } from "../lib/plan";
import { monthLabel, useStore } from "../lib/store";
import { Section } from "./PanelPrimitives";

const thb = (v: number) => `฿${Math.round(v).toLocaleString("en-US")}`;
const SHOWN = 10;

/** Read-only summary of every circuit's after-hours setting. Circuits are changed in their zone. */
export default function QuestionAPlan(_props: { zones: ZoneInfo[] }) {
  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.select);
  const curfew = useCurfewSettings();
  const [showAll, setShowAll] = useState(false);

  const period = month ? `in ${monthLabel(month)}` : "a year";
  const items = meta ? getScopeCircuitPlan(meta, scope, month, curfew) : [];
  const totalThb = items.reduce((acc, c) => acc + c.savedThb, 0);
  const totalKwh = items.reduce((acc, c) => acc + c.savedKwh, 0);
  const offCount = items.filter((c) => c.mode === "curfew").length;
  const keptOnCount = items.length - offCount;
  const changedCount = items.filter((c) => c.changedFromRecommendation).length;

  return (
    <Section
      title="Circuit Schedule"
      aside={<span className="aside">{month ? monthLabel(month) : "Per Year"}</span>}
      className="plan"
      collapsible
      defaultOpen={true}
    >
      <div className="plan-total">
        <span className="stat-label">Schedule saves</span>
        <span className="big">{thb(totalThb)}</span>
        <span className="sub">
          {kwh(totalKwh)} {period} · <b>{offCount}</b> off after hours, <b>{keptOnCount}</b> kept on 24/7
          {changedCount > 0 ? <> · <b>{changedCount}</b> changed from the recommendation</> : null}
        </span>
      </div>

      <p className="note plan-precedence">
        Each circuit starts with the model's recommendation. To change one, add an exception in the Curfew Plan above.
      </p>

      <ol className="plan-zones">
        {(showAll ? items : items.slice(0, SHOWN)).map((c) => (
          <li key={c.circuit_id} className="plan-circuit-row">
            <div className="plan-zone plan-circuit-item">
              <span
                className={`plan-rate ${c.mode === "keep_on" ? "badge-keep" : c.changedFromRecommendation || c.exception ? "badge-amber" : "badge-curfew"}`}
              >
                {c.mode === "keep_on" ? "Kept on" : c.changedFromRecommendation || c.exception ? "Exception" : "Default"}
              </span>

              <span className="plan-zone-name">
                <button
                  type="button"
                  className="plan-zone-link"
                  onClick={() => select({ floor: c.floor, zone: c.zone })}
                  title={`Open Floor ${c.floor}, Zone ${c.zone.slice(1)} to change this circuit`}
                >
                  F{c.floor} Z{c.zone.slice(1)} · {c.cleanName.replace(/^Floor\d+_/, "")} <small>({c.spaceName})</small>
                </button>
                <small>
                  {c.setting}
                  {c.changedFromRecommendation
                    ? ` · model recommends ${c.recommended === "keep_on" ? "keeping it on" : "switching it off"}`
                    : " · as recommended"}
                </small>
              </span>

              <span className="plan-zone-val">{c.mode === "keep_on" ? "–" : thb(c.savedThb)}</span>
            </div>
          </li>
        ))}
      </ol>

      {items.length > SHOWN && (
        <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? `Show top ${SHOWN} circuits` : `Show all ${items.length} circuits`}
        </button>
      )}
    </Section>
  );
}

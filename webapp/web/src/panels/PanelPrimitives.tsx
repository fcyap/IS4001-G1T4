import type { ReactNode } from "react";

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-head"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export function Stat({ label, value, after, unit, hint }: { label: string; value: string; after?: string | null; unit?: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {after ? <><s>{value}</s><b>{after}</b></> : <b>{value}</b>}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}


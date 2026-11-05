import { useId, useState, type ReactNode } from "react";

export function Section({ title, aside, children, collapsible = false, defaultOpen = true, className }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const bodyId = useId();

  if (!collapsible) {
    return (
      <section className={`sec ${className || ""}`}>
        <div className="sec-head"><h2>{title}</h2>{aside}</div>
        {children}
      </section>
    );
  }

  // The title is the disclosure button; the aside stays outside it because it can hold its own buttons.
  return (
    <section className={`sec ${className || ""}`}>
      <div className="sec-head">
        <h2>
          <button type="button" className="sec-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setIsOpen(!isOpen)}>
            <svg className="sec-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden>
              <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {title}
          </button>
        </h2>
        {aside}
      </div>
      <div id={bodyId} hidden={!isOpen}>{isOpen && children}</div>
    </section>
  );
}

export function Stat({ label, value, after, unit, hint, change }: {
  label: string;
  value: string;
  after?: string | null;
  unit?: string;
  hint?: string;
  change?: { value: number; type: 'pp' | 'pct'; isImprovement: boolean } | null;
}) {
  return (
    <div className="stat" title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {after ? <><s>{value}</s><b>{after}</b></> : <b>{value}</b>}
        {unit && <small>{unit}</small>}
      </span>
      {change && after && (
        <span className={`stat-change ${change.isImprovement ? "good" : "bad"}`}>
          {change.value > 0 ? "+" : ""}{change.value.toFixed(1)}{change.type === 'pp' ? ' pp' : '%'}
        </span>
      )}
    </div>
  );
}

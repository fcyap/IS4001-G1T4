import { useState, type ReactNode } from "react";

export function Section({ title, aside, children, collapsible = false, defaultOpen = true, className }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section className={`sec ${className || ""}`}>
        <div className="sec-head"><h2>{title}</h2>{aside}</div>
        {children}
      </section>
    );
  }

  return (
    <section className={`sec ${className || ""}`}>
      <div
        className="sec-head"
        style={{ cursor: "pointer", userSelect: "none", position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          <h2>{title}</h2>
          {aside}
        </div>
        <button
          style={{
            flexShrink: 0,
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            border: "none",
            background: "rgba(220, 226, 234, 0.85)",
            color: "#0a1628",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            fontWeight: "normal",
            cursor: "pointer",
            padding: 0,
            marginLeft: "16px",
            lineHeight: "0",
            fontFamily: "monospace",
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          aria-label={isOpen ? "Collapse section" : "Expand section"}
        >
          {isOpen ? "−" : "+"}
        </button>
      </div>
      {isOpen && children}
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


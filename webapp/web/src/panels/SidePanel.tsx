import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Summary, type ZoneInfo, type ZoneResult } from "../lib/api";
import { AUDIT_CLASS_COLORS, auditValueColor, C, MEASURES } from "../lib/colors";
import { acKw, replayValue, rollup, useData, useFetch, zoneValue } from "../lib/data";
import { kwh, n0, n1, pmvTxt, signedC } from "../lib/format";
import { isAuditMeasure, monthLabel, scenarioBody, scopeLabel, useStore, zoneId, zoneName, type AuditMeasure, type MapMeasure } from "../lib/store";
import { zoneLabel, zoneUse } from "../lib/zones";
import { HeatMap, Histogram, LoadChart, Sparkline } from "./Charts";
import { Section, Stat } from "./PanelPrimitives";
import Overview from "./Overview";
import Plan from "./Plan";
import QuestionAPanel from "./QuestionAPanel";

// --- Header -----------------------------------------------------------------------------------
/** Back to wherever the user came from, plus arrows to step through the zones on this floor. */
function ScopeNav() {
  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const history = useStore((s) => s.history);
  const back = useStore((s) => s.back);
  const select = useStore((s) => s.select);
  if (scope.floor === undefined) return null;
  const prev = history[history.length - 1] ?? (scope.zone ? { floor: scope.floor } : {});
  const siblings = scope.zone ? (meta?.zones ?? []).filter((z) => z.floor === scope.floor).map((z) => z.zone).sort() : [];
  const i = siblings.indexOf(scope.zone ?? "");
  const step = (d: number) => select({ floor: scope.floor, zone: siblings[(i + d + siblings.length) % siblings.length] }, true);
  return (
    <div className="scope-nav">
      <button type="button" className="scope-back" onClick={back} title="Back (Esc goes up one level)">
        <span aria-hidden>←</span> Back to {scopeLabel(prev)}
      </button>
      {siblings.length > 1 && i >= 0 && (
        <div className="scope-step" role="group" aria-label={`Zones on Floor ${scope.floor}`}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous zone on this floor">‹</button>
          <span>Zone {i + 1} of {siblings.length}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next zone on this floor">›</button>
        </div>
      )}
    </div>
  );
}

function ScopeHeader({ zones }: { zones: ZoneInfo[] }) {
  const { auditById } = useData();
  const scope = useStore((s) => s.scope);
  const measure = useStore((s) => s.measure);
  const month = useStore((s) => s.month);
  const auditLayer = isAuditMeasure(measure);
  const sensors = zones.filter((z) => z.has_sensor).length;
  if (scope.zone) {
    const z = zones[0];
    const audit = z ? auditById.get(z.id) : undefined;
    const use = zoneUse(scope.floor!, scope.zone);
    return (
      <div className="scope">
        <h1>Floor {scope.floor}, {zoneName(scope.zone).toLowerCase()}</h1>
        {use && <p className="zone-use">{use.name}</p>}
        <p>{auditLayer
          ? audit ? measure === "audit_load"
            ? `${audit.circuit_count} audited circuits · mean after-hours load for ${month ? monthLabel(month) : "all recorded months"}.`
            : `${audit.circuit_count} audited circuits · ${audit.preventable_count} preventable, ${audit.critical_count} critical standby.`
            : "No Question A circuit data for this zone."
          : z?.status === "nodata" ? z.note : z?.has_ac ? "Temperature, humidity and AC power metered." : "Temperature and humidity only; no AC circuit metered."}</p>
        {use && <p className="zone-lever">{use.lever}</p>}
        <div className="badges">
          {use && <span className="badge">{use.kindLabel}</span>}
          {auditLayer && audit && measure !== "audit_load" && <span className="badge" style={{ color: AUDIT_CLASS_COLORS[audit.classification], borderColor: AUDIT_CLASS_COLORS[audit.classification] }}>{audit.classification}</span>}
          {!auditLayer && z?.inspect && <span className="badge amber">Check First: {z.inspect}</span>}
          {!auditLayer && z?.baseline && (z.baseline.passes
            ? <span className="badge ok">Baseline Passes ASHRAE 14</span>
            : <span className="badge warn">Baseline Misses ASHRAE 14 (NMBE {n1(z.baseline.nmbe_pct)} %)</span>)}
        </div>
      </div>
    );
  }
  return (
    <div className="scope">
      <h1>{scope.floor ? `Floor ${scope.floor}` : "Whole Building"}</h1>
      <p>{auditLayer
        ? `${[...auditById.values()].filter((a) => scope.floor === undefined || a.floor === scope.floor).reduce((n, a) => n + a.circuit_count, 0)} audited circuits. ${measure === "audit_load"
          ? month ? `After-hours load is the mean of recorded unoccupied readings for ${monthLabel(month)}.` : "After-hours load is the clean-year mean for Jul 2018–Jun 2019."
          : month ? `Energy uses recorded after-hours readings for ${monthLabel(month)}; cost uses the peak/off-peak tariff.` : "Annual figures are estimates from the circuit audit."}`
        : <>{scope.floor ? `${zones.length} zones, ${sensors} with temperature and humidity sensors.`
          : "Office hours only: workdays 08:00–17:00, lunch hour excluded."}
          {scope.floor === 1 && " Floor 1 has no indoor sensors, so it can’t be scored for comfort."}</>}</p>
    </div>
  );
}

// --- Occupant Comfort Section ----------------------------------------------------------------
function OccupantComfortSection({ results, zones, zone }: { results: ZoneResult[]; zones: ZoneInfo[]; zone: ZoneInfo | null }) {
  const mode = useStore((s) => s.mode);
  const a = rollup(results, false);
  const b = rollup(results, true);
  const w = mode === "whatif";
  if (!results.length) return null;

  return (
    <Section title="Occupant Comfort" collapsible={true} defaultOpen={false}>
      <div className="stats">
        <Stat
          label="Indoor Air"
          value={n1(a.mean_temp_c)}
          after={w ? n1(b.mean_temp_c) : null}
          unit="°C"
          hint="Mean zone air temperature in office hours"
        />
        <Stat label="Outdoor Air" value={n1(a.mean_out_temp_c)} unit="°C" hint="Bangkok, Open-Meteo, same office hours" />
        <Stat
          label="Too Cool"
          value={n0(a.pct_too_cool)}
          after={w ? n0(b.pct_too_cool) : null}
          unit="% of time"
          hint="Share of office time with PMV below −0.5"
          change={w ? {
            value: b.pct_too_cool - a.pct_too_cool,
            type: 'pp',
            isImprovement: b.pct_too_cool < a.pct_too_cool // Less time too cool is better
          } : null}
        />
        <Stat
          label="Comfortable"
          value={n0(a.pct_comfortable)}
          after={w ? n0(b.pct_comfortable) : null}
          unit="% of time"
          hint="Share of office time with PMV within ±0.5"
          change={w ? {
            value: b.pct_comfortable - a.pct_comfortable,
            type: 'pp',
            isImprovement: b.pct_comfortable > a.pct_comfortable // More time comfortable is better
          } : null}
        />
      </div>
      <ComfortMix results={results} />
      {zone && zone.status === "data" && <ZoneDetailSection zone={zone} result={results[0]} />}
      <Heat zones={zones} />
    </Section>
  );
}

// --- Energy Section ---------------------------------------------------------------------------
function EnergySection({ results }: { results: ZoneResult[] }) {
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const a = rollup(results, false);
  const b = rollup(results, true);
  const w = mode === "whatif";
  if (!results.length) return null;

  // Calculate EUI (Energy Use Intensity) for building or floor level only
  const BUILDING_AREA_M2 = 11700;
  const FLOOR_AREA_M2 = BUILDING_AREA_M2 / 7;
  const OFFICE_HOURS_PER_YEAR = 2080;
  const showEUI = !scope.zone; // Show EUI for whole building or single floor, not for zones

  let euiBefore: number | null = null;
  let euiAfter: number | null = null;

  if (showEUI && a.periods > 0) {
    const area = scope.floor === undefined ? BUILDING_AREA_M2 : FLOOR_AREA_M2;
    // Convert kWh to annual kWh, then divide by area
    // periods are 15-min intervals, so divide by 0.25 to get hours
    const hoursInData = a.periods * 0.25;
    const annualKwhBefore = (a.ac_kwh / hoursInData) * OFFICE_HOURS_PER_YEAR;
    const annualKwhAfter = ((a.ac_kwh - b.saved_kwh) / hoursInData) * OFFICE_HOURS_PER_YEAR;
    euiBefore = annualKwhBefore / area;
    euiAfter = annualKwhAfter / area;
  }

  return (
    <Section title="Energy" collapsible={true} defaultOpen={false}>
      <div className="stats">
        <Stat
          label={`AC Energy, ${month ? monthLabel(month) : "All Months"}`}
          value={kwh(a.ac_kwh)}
          after={w ? kwh(a.ac_kwh - b.saved_kwh) : null}
          hint="Metered AC in office hours, zones with sensors"
          change={w && a.ac_kwh !== 0 ? {
            value: ((b.saved_kwh / a.ac_kwh) * 100) * -1, // Negative because saved_kwh is positive when energy decreases
            type: 'pct',
            isImprovement: b.saved_kwh > 0 // Positive saved_kwh means energy reduction, which is good
          } : null}
        />
        {showEUI && euiBefore !== null && (
          <Stat
            label="EUI (Annual)"
            value={n1(euiBefore)}
            after={w ? n1(euiAfter!) : null}
            unit="kWh/m²/year"
            hint={`Energy Use Intensity for ${scope.floor === undefined ? 'whole building (11,700 m²)' : `floor ${scope.floor} (${Math.round(FLOOR_AREA_M2)} m²)`}`}
            change={w && euiBefore !== 0 ? {
              value: ((euiAfter! - euiBefore) / euiBefore) * 100,
              type: 'pct',
              isImprovement: euiAfter! < euiBefore // Lower EUI is better
            } : null}
          />
        )}
      </div>
      <Load />
    </Section>
  );
}

function ComfortBar({ s, label }: { s: ReturnType<typeof rollup> | Summary; label: string }) {
  const parts = [
    { k: "too cool", v: s.pct_too_cool, c: C.cool },
    { k: "comfortable", v: s.pct_comfortable, c: C.comfy },
    { k: "too warm", v: s.pct_too_warm, c: C.warm },
  ];
  return (
    <div className="mix">
      <span className="mix-label">{label}</span>
      <div className="mix-bar" role="img" aria-label={parts.map((p) => `${p.k} ${n0(p.v)} %`).join(", ")}>
        {parts.map((p) => <i key={p.k} style={{ width: `${p.v}%`, background: p.c }} title={`${p.k}: ${n1(p.v)} %`} />)}
      </div>
      <span className="mix-num">{n0(s.pct_comfortable)} %</span>
    </div>
  );
}

function ComfortMix({ results }: { results: ZoneResult[] }) {
  const mode = useStore((s) => s.mode);
  if (!results.length) return null;
  const a = rollup(results, false), b = rollup(results, true);
  return (
    <Section title="Thermal Comfort in Office Hours" aside={<span className="aside">PMV, ISO 7730</span>}>
      <ComfortBar s={a} label={mode === "whatif" ? "Today" : "As Recorded"} />
      {mode === "whatif" && <ComfortBar s={b} label="After" />}
      <div className="mix-key">
        {([["Too Cool", "PMV < −0.5", C.cool, "pct_too_cool"], ["Comfortable", "−0.5 to +0.5", C.comfy, "pct_comfortable"],
          ["Too Warm", "PMV > +0.5", C.warm, "pct_too_warm"]] as const).map(([name, range, color, key]) => (
          <span key={key} title={range}>
            <i style={{ background: color }} />{name} <b>{n0(a[key])} %</b>
            {mode === "whatif" && <> → <b>{n0(b[key])} %</b></>}
          </span>
        ))}
      </div>
      <p className="note">The three shares add up to 100 % of office time (PMV comfort band −0.5 to +0.5).</p>
      <p className="note" style={{ marginBottom: "20px" }}>
        Humid (RH above 65 %): {n0(a.pct_humid)} % of office time{mode === "whatif" ? `, ${n0(b.pct_humid)} % after` : ""}.
        Mean PMV {pmvTxt(a.mean_pmv)}{mode === "whatif" ? ` → ${pmvTxt(b.mean_pmv)}` : ""}.
      </p>
    </Section>
  );
}

// --- What-if ----------------------------------------------------------------------------------
function WhatIf({ results, zones }: { results: ZoneResult[]; zones: ZoneInfo[] }) {
  const { meta } = useData();
  const whatif = useStore((s) => s.whatif);
  const setWhatif = useStore((s) => s.setWhatif);
  const setOverride = useStore((s) => s.setOverride);
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const b = rollup(results, true);
  const breaches = results.filter((z) => z.breach.length);
  const zone = scope.zone ? zones[0] : null;
  const zr = zone ? results[0] : null;
  const override = zone ? whatif.overrides[zone.id] : undefined;
  const nOverrides = Object.keys(whatif.overrides).length;
  const rules = meta?.rules;
  const limit = rules?.whatif_limit_c ?? 5;
  const extra = b.saved_kwh < 0;          // a lower setpoint costs AC energy instead of saving it

  return (
    <Section title="Setpoint What-If" collapsible={true} defaultOpen={false} aside={nOverrides ? <button className="link" onClick={() => setWhatif({ overrides: {} })}>Clear {nOverrides} Zone Override{nOverrides > 1 ? "s" : ""}</button> : null}>
      <div className="segmented wide">
        <button className={whatif.mode === "rule" ? "on" : ""} onClick={() => setWhatif({ mode: "rule" })}>Rule Recommendation</button>
        <button className={whatif.mode === "global" ? "on" : ""} onClick={() => setWhatif({ mode: "global" })}>Same Change Everywhere</button>
      </div>
      {whatif.mode === "global" ? (
        <label className="slider">
          <span>Change Every Zone’s Setpoint by <b>{signedC(whatif.globalC)}</b></span>
          <input type="range" min={-limit} max={limit} step={0.5} value={whatif.globalC} onChange={(e) => setWhatif({ globalC: +e.target.value })} />
        </label>
      ) : (
        <p className="note">
          Each zone and month: raise {rules?.raise_step_c ?? 1} °C at a time while more than {n0((rules?.raise_if_too_cool ?? 0.25) * 100)} % of office time is too cool,
          up to +{rules?.max_raise_c ?? 3} °C. Roll back a step if more than {n0((rules?.too_warm_tolerance ?? 0.1) * 100)} % would be too warm, or more time would be humid.
        </p>
      )}

      {zone && zone.simulated && (
        <label className="slider override">
          <span>This Zone: <b>{override !== undefined ? `${signedC(override)} (override)` : zr ? `${signedC(zr.raise_c)} from the ${whatif.mode === "rule" ? "rule" : "building setting"}` : "–"}</b></span>
          <input type="range" min={-limit} max={limit} step={0.5} value={override ?? zr?.raise_c ?? 0}
            onChange={(e) => setOverride(zone.id, +e.target.value)} />
          {override !== undefined && <button className="link" onClick={() => setOverride(zone.id, null)}>Use the {whatif.mode === "rule" ? "Rule" : "Building Setting"} Again</button>}
        </label>
      )}
      {zone && !zone.simulated && zone.status === "data" && <p className="note">No AC circuit metered here, so there’s no setpoint to simulate.</p>}

      <div className="result">
        <div>
          <span className="stat-label">{extra ? "Extra AC Energy" : "AC Energy Saved"}, {month ? monthLabel(month) : "Sensor Months"}</span>
          <span className={`big ${extra ? "bad" : ""}`}>{kwh(Math.abs(b.saved_kwh))}</span>
          <span className="sub">{n1(b.ac_kwh ? (Math.abs(b.saved_kwh) / b.ac_kwh) * 100 : 0)} % {extra ? "more" : "of"} this AC, about {kwh(Math.abs(b.annual_kwh_saved ?? 0))} a year</span>
        </div>
        <div>
          <span className="stat-label">Over the Guardrail</span>
          <span className={`big ${breaches.length ? "bad" : ""}`}>{breaches.length}</span>
          <span className="sub">{breaches.length ? `zones outside the comfort guardrail in at least one month: ${breaches.map((z) => z.id.replace(":", " ")).join(", ")}` : "no zone goes too warm, too humid or colder than today in any month"}</span>
        </div>
      </div>
      {Math.abs(whatif.mode === "global" ? whatif.globalC : 0) > (rules?.max_raise_c ?? 3) || Object.values(whatif.overrides).some((c) => Math.abs(c) > (rules?.max_raise_c ?? 3))
        ? <p className="note">Beyond ±{rules?.max_raise_c ?? 3} °C the energy and moisture slopes are extrapolated from smaller changes, so treat these figures as rough. A lower setpoint’s extra AC is capped at each zone’s highest metered power.</p>
        : null}
      {!scope.zone && <p className="note">Zones on the check-first list stay at today’s setpoint unless you override them. Annual figures scale the sensor months to {n0(meta?.rules.office_periods_per_year ? meta.rules.office_periods_per_year / 4 : 1944)} office hours a year.</p>}
    </Section>
  );
}

// --- Replay -----------------------------------------------------------------------------------
function ReplayReadout({ zones }: { zones: ZoneInfo[] }) {
  const { replay } = useData();
  const t = useStore((s) => s.replay.t);
  const after = useStore((s) => s.replay.after);
  const ids = zones.map((z) => z.id).filter((id) => replay?.zones[id]);
  const series = useMemo(() => {
    if (!replay) return { ac: [], pmv: [] };
    const steps = replay.times.length;
    const ac = Array.from({ length: steps }, (_, i) => {
      const v = ids.map((id) => replayValue(replay, id, "ac", i, after)).filter((x): x is number => x !== null);
      return v.length ? v.reduce((p, q) => p + q, 0) : null;
    });
    const pmv = Array.from({ length: steps }, (_, i) => {
      const v = ids.map((id) => replayValue(replay, id, "pmv", i, after)).filter((x): x is number => x !== null);
      return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null;
    });
    return { ac, pmv };
  }, [replay, ids.join(","), after]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!replay) return <p className="empty">Loading the day…</p>;
  if (!ids.length) return <p className="empty">No sensor data in this selection on this day.</p>;
  return (
    <Section title={`Live at ${replay.times[t] ?? "–"}`} aside={<span className="aside">{after ? "With Setpoint Change" : "As Recorded"}</span>}>
      <div className="stats">
        <Stat label="Outdoor Air" value={n1(replay.out_temp_c[t])} unit="°C" />
        <Stat label="AC Power" value={n1(series.ac[t])} unit="kW" />
        <Stat label="Mean PMV" value={pmvTxt(series.pmv[t])} />
      </div>
      <div className="spark">
        <span className="stat-label">AC Power Through the Day</span>
        <Sparkline values={series.ac} cursor={t} color={C.warm} />
        <span className="stat-label">Mean PMV Through the Day</span>
        <Sparkline values={series.pmv} cursor={t} color={C.cool} />
      </div>
    </Section>
  );
}

// --- Zones, alerts ----------------------------------------------------------------------------
function ZoneGrid({ zones, measureOverride, onZoneSelect }: { zones: ZoneInfo[]; measureOverride?: MapMeasure; onZoneSelect?: (measure: MapMeasure) => void }) {
  const { byId, auditById, replay } = useData();
  const mode = useStore((s) => s.mode);
  const storedMeasure = useStore((s) => s.measure);
  const measure = measureOverride ?? storedMeasure;
  const month = useStore((s) => s.month);
  const auditMeasure = measure;
  const t = useStore((s) => s.replay.t);
  const after = useStore((s) => s.replay.after);
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const hover = useStore((s) => s.hover);
  const floors = [...new Set(zones.map((z) => z.floor))].sort((a, b) => b - a);
  const m = mode === "replay" ? (measure === "ac" ? "ac" : "pmv") : isAuditMeasure(measure) ? "too_cool" : measure;
  const auditValues = [...auditById.values()].map((a) => auditMeasure === "audit_load"
    ? month ? a.monthly[month]?.unocc_mean_kw : a.unocc_mean_kw
    : month ? auditMeasure === "audit_cost" ? a.monthly[month]?.cost_thb : a.monthly[month]?.surplus_kwh
      : auditMeasure === "audit_cost" ? a.annual_cost_thb : a.annual_surplus_kwh).filter((v): v is number => v !== null);
  const auditMax = Math.max(...auditValues, 1);
  const auditTitle = auditMeasure === "audit_classification" ? "Waste status"
    : auditMeasure === "audit_load" ? `Mean after-hours load${month ? ` · ${monthLabel(month)}` : " · Jul 2018–Jun 2019"}`
      : `${auditMeasure === "audit_cost" ? "Cost opportunity" : "Preventable energy"}${month ? ` · ${monthLabel(month)}` : " · Jul 2018–Jun 2019"}`;
  const zoneTitle = measure === "audit_classification" ? "Waste Status by Zone"
    : measure === "audit_load" ? "After-hours Load by Zone"
      : measure === "audit_kwh" ? "Preventable Energy by Zone" : "Zones";
  return (
    <Section title={zoneTitle} collapsible={true} defaultOpen={false} aside={<span className="aside">{isAuditMeasure(measure) ? auditTitle : mode === "replay" ? (m === "ac" ? "AC Power Now" : "PMV Now") : MEASURES[m].label}</span>}>
      <div className="grid">
        {floors.map((f) => (
          <div className="grid-row" key={f}>
            <span className="grid-floor">{f}</span>
            {zones.filter((z) => z.floor === f).map((z) => {
              const audit = auditById.get(z.id);
              const v = isAuditMeasure(measure) ? audit ? measure === "audit_load"
                ? month ? audit.monthly[month]?.unocc_mean_kw ?? null : audit.unocc_mean_kw
                : month ? measure === "audit_cost" ? audit.monthly[month]?.cost_thb ?? null : measure === "audit_kwh" ? audit.monthly[month]?.surplus_kwh ?? null : null
                  : measure === "audit_cost" ? audit.annual_cost_thb : measure === "audit_kwh" ? audit.annual_surplus_kwh : null : null
                : z.status === "nodata" ? null : mode === "replay"
                ? replayValue(replay, z.id, m, t, after) : zoneValue(byId.get(z.id), m, mode === "whatif");
              const bg = isAuditMeasure(measure)
                ? !audit || (measure !== "audit_classification" && v === null) ? undefined : measure === "audit_classification" ? AUDIT_CLASS_COLORS[audit.classification] : auditValueColor(v ?? 0, auditMax)
                : v === null ? undefined : MEASURES[m].color(v);
              const preventableKwh = audit ? month
                ? audit.monthly[month]?.surplus_kwh ?? null
                : audit.annual_surplus_kwh : null;
              const breach = mode === "whatif" && (byId.get(z.id)?.breach.length ?? 0) > 0;
              const cellTitle = measure === "audit_classification" && audit
                ? `${zoneLabel(f, z.zone)} · ${audit.classification} · ${audit.preventable_count} preventable, ${audit.critical_count} critical standby · ${kwh(preventableKwh)} preventable energy${month ? ` in ${monthLabel(month)}` : " annually"}`
                : measure === "audit_load" && audit
                  ? v === null ? `${zoneLabel(f, z.zone)} · no after-hours readings${month ? ` in ${monthLabel(month)}` : " for the annual period"} · Waste Status: ${audit.classification}` : `${zoneLabel(f, z.zone)} · ${n1(v)} kW mean after-hours load${month ? ` in ${monthLabel(month)}` : " in Jul 2018–Jun 2019"} · Waste Status: ${audit.classification} · ${kwh(preventableKwh)} preventable energy${month ? ` in ${monthLabel(month)}` : " in Jul 2018–Jun 2019"}${month && audit ? ` · ${audit.monthly[month]?.load_coverage_pct ?? 0}% load readings` : ""}`
                  : measure === "audit_kwh" && audit
                    ? v === null ? `${zoneLabel(f, z.zone)} · no circuit readings in ${monthLabel(month!)}` : `${zoneLabel(f, z.zone)} · ${n1(v)} kWh preventable energy${month ? ` in ${monthLabel(month)}` : " in Jul 2018–Jun 2019"}${month && audit ? ` · ${audit.monthly[month]?.energy_coverage_pct ?? 0}% energy readings` : ""}`
                  : measure === "audit_cost" && audit
                    ? v === null ? `${zoneLabel(f, z.zone)} · no circuit readings in ${monthLabel(month!)}` : `${zoneLabel(f, z.zone)} · ฿${Math.round(v).toLocaleString("en-US")} cost opportunity, excluding VAT${month ? ` in ${monthLabel(month)}` : " in Jul 2018–Jun 2019"}${month ? ` · ${audit.monthly[month]?.energy_coverage_pct ?? 0}% energy readings` : ""}`
                  : `Floor ${f} ${zoneLabel(f, z.zone)}`;
              return (
                <button key={z.id} className={`dot ${hover === z.id ? "hot" : ""} ${isAuditMeasure(measure)
                  ? audit ? (measure !== "audit_classification" && v === null ? "nodata" : "") : "nodata"
                  : `${z.inspect ? "inspect" : ""} ${breach ? "breach" : ""} ${z.status}`}`}
                  style={{ background: bg }}
                  onMouseEnter={() => setHover(z.id)} onMouseLeave={() => setHover(null)}
                  onClick={() => { onZoneSelect?.(measure); select({ floor: z.floor, zone: z.zone }); }}
                  aria-label={cellTitle} title={cellTitle}>
                  <span>{z.zone.slice(1)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {isAuditMeasure(measure) && <div className="zone-heat-legend">
        {measure === "audit_classification"
          ? Object.entries(AUDIT_CLASS_COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)
          : <><span>0 {measure === "audit_kwh" ? "kWh" : "kW"}</span><i className="zone-heat-scale" style={{ background: `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map((t) => auditValueColor(auditMax * t * t, auditMax)).join(", ")})` }} /><span>{n1(auditMax)} {measure === "audit_kwh" ? "kWh" : "kW"}</span></>}
      </div>}
      {measure === "audit_load" && <p className="zone-map-note">Circle color shows mean after-hours load. Click a zone for its Waste Status, circuits, and energy details.</p>}
    </Section>
  );
}

interface Alert { id: string; level: "red" | "amber" | "grey"; title: string; detail: string }

function Alerts({ zones, results }: { zones: ZoneInfo[]; results: ZoneResult[] }) {
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);
  const alerts: Alert[] = [];
  if (mode === "whatif")
    for (const r of results.filter((z) => z.breach.length))
      alerts.push({ id: r.id, level: "red", title: `${r.id.replace(":", " ")} would go ${r.breach.join(" and ")}`,
        detail: `Fails the guardrail in ${r.breach_months.length} month${r.breach_months.length > 1 ? "s" : ""} (${r.breach_months.map(monthLabel).join(", ")}). Move this zone a step back towards today's setpoint in those months.` });
  for (const z of zones.filter((z) => z.inspect))
    alerts.push({ id: z.id, level: "amber", title: `${z.id.replace(":", " ")}: check before adjusting`, detail: z.inspect! });
  for (const z of zones.filter((z) => z.baseline && !z.baseline.passes))
    alerts.push({ id: z.id, level: "grey", title: `${z.id.replace(":", " ")}: baseline model misses ASHRAE 14`,
      detail: `CV(RMSE) ${n1(z.baseline!.cv_rmse_pct)} %, NMBE ${n1(z.baseline!.nmbe_pct)} % on Jul–Dec 2019. Treat its savings as indicative.` });
  if (!alerts.length) return null;
  const item = (a: Alert, i: number) => {
    const [f, z] = a.id.slice(1).split(":");
    return (
      <li key={i} className={a.level}>
        <button onClick={() => select({ floor: +f, zone: z })}>
          <b>{a.title}</b>
          <span>{a.detail}</span>
        </button>
      </li>
    );
  };
  const urgent = alerts.filter((a) => a.level !== "grey");
  const model = alerts.filter((a) => a.level === "grey");
  return (
    <Section title="Needs Attention" collapsible={true} defaultOpen={false} aside={<span className="aside">{alerts.length}</span>}>
      <ul className="alerts">
        {urgent.map(item)}
        {model.length > 1 ? (
          <li className="grey">
            <details>
              <summary>
                <b>{model.length} zones’ baseline models miss ASHRAE 14</b>
                <span>Mostly bias (NMBE above 10 %) on Jul–Dec 2019. Their savings are indicative. Show zones</span>
              </summary>
              <ul className="alerts nested">{model.map(item)}</ul>
            </details>
          </li>
        ) : model.map(item)}
      </ul>
    </Section>
  );
}

// --- Charts sections --------------------------------------------------------------------------
function Load() {
  const scope = useStore((s) => s.scope);
  const { data } = useFetch(`load|${scope.floor}|${scope.zone}`, (sig) => api.load(scope.floor, scope.zone, sig), 0);
  return (
    <Section title="AC Energy Against the Baseline" aside={<span className="aside">Weekly, Office Hours</span>}>
      {!data ? <div className="chart-ph" /> : data.weeks.length === 0
        ? <p className="empty">No baseline model for this selection (it needs metered AC with enough history).</p>
        : <>
          <LoadChart data={data} />
          <p className="note">
            The baseline predicts normal AC from outdoor weather (including sun and the past day’s heat), the zone’s
            lighting and plug use, hour, weekday and holidays. Trained Jul 2018 – Jun 2019, with closures and outages left out.
            {data.test_actual_kwh !== undefined && ` Test period: ${kwh(data.test_actual_kwh)} actual against ${kwh(data.test_baseline_kwh)} predicted.`}
          </p>
        </>}
    </Section>
  );
}

function Heat({ zones }: { zones: ZoneInfo[] }) {
  const { meta } = useData();
  const select = useStore((s) => s.select);
  const [key, setKey] = useState<"pct_too_cool" | "pct_comfortable" | "pct_humid">("pct_too_cool");
  const ids = new Set(zones.map((z) => z.id));
  const cells = (meta?.heatmap ?? []).filter((c) => ids.has(zoneId(c.floor, c.zone)));
  if (!cells.length) return null;
  return (
    <Section title="Comfort by Zone and Month" aside={
      <select className="mini" value={key} onChange={(e) => setKey(e.target.value as typeof key)} aria-label="Heat map measure">
        <option value="pct_too_cool">% Too Cool</option>
        <option value="pct_comfortable">% Comfortable</option>
        <option value="pct_humid">% Humid</option>
      </select>}>
      <HeatMap cells={cells} months={meta!.months} measure={key} onPick={(f, z) => select({ floor: f, zone: z })} />
      <p className="note">Mid-Sep 2018 to Feb 2019 is missing: the indoor sensors weren’t recording.</p>
    </Section>
  );
}

function ZoneDetailSection({ zone, result }: { zone: ZoneInfo; result?: ZoneResult }) {
  const { meta } = useData();
  const mode = useStore((s) => s.mode);
  const month = useStore((s) => s.month);
  const whatif = useStore((s) => s.whatif);
  const body = scenarioBody({ mode: mode === "replay" ? "overview" : mode, month, whatif });
  const { data } = useFetch(`zone|${zone.id}|${JSON.stringify(body)}`, (sig) => api.zone(zone.floor, zone.zone, body, sig));
  const recs = (meta?.monthly ?? []).filter((r) => r.floor === zone.floor && r.zone === zone.zone);
  const afterLabel = mode === "whatif" && result && (result.raise_max > 0 || result.raise_min < 0) ? signedC(result.raise_c) : null;
  return (
    <>
      {zone.kw_per_c !== null && (
        <Section title="What One Degree Is Worth Here">
          <div className="stats">
            <Stat label="AC Saved per +1 °C" value={n1(zone.kw_per_c)} unit="kW" hint={`${zone.kw_per_c_source} regression on daily office-hour data`} />
            <Stat label="Share of This Zone’s AC" value={n1(zone.pct_per_c)} unit="%" />
            <Stat label="Mean AC Power" value={result ? n1(acKw(result.before, false)) : "–"} unit="kW" />
          </div>
          <p className="note">
            Estimated from {zone.kw_per_c_source === "zone" ? "this zone’s own" : "the whole floor’s"} daily data: AC power against zone temperature, holding outdoor weather and weekday fixed.
            Moisture rises about {n1(zone.moisture_per_c)} g/kg per °C as the coil dehumidifies less.
          </p>
        </Section>
      )}
      <Section title="Distribution of Comfort" aside={<span className="aside">15-Minute Office Periods</span>}>
        {data ? <>
          <span className="stat-label">PMV</span>
          <Histogram detail={data} kind="pmv" afterLabel={afterLabel} />
          <span className="stat-label">Relative Humidity, %</span>
          <Histogram detail={data} kind="rh" afterLabel={afterLabel} />
        </> : <div className="chart-ph" />}
      </Section>
      {recs.length > 0 && (
        <Section title="Rule Recommendation by Month">
          <table className="tbl">
            <thead><tr><th>Month</th><th>Raise</th><th>Too Cool</th><th>Saved</th><th>Why</th></tr></thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.month} className={month === r.month ? "on" : ""}>
                  <td>{monthLabel(r.month)}</td>
                  <td>+{r.recommended_raise_c} °C</td>
                  <td>{n0(r.pct_too_cool_before)} → {n0(r.pct_too_cool_after)} %</td>
                  <td>{kwh(r.saved_kwh)}</td>
                  <td className="why">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

// --- Panel ------------------------------------------------------------------------------------
export default function SidePanel() {
  const { meta, byId, auditById } = useData();
  const scope = useStore((s) => s.scope);
  const mode = useStore((s) => s.mode);
  const measure = useStore((s) => s.measure);
  const topic = useStore((s) => s.topic);
  const [auditDetailMeasure, setAuditDetailMeasure] = useState<MapMeasure>("audit_load");
  const auditLayer = topic === "afterhours";
  const inner = useRef<HTMLDivElement>(null);
  // A new selection starts at the top of the panel, not wherever the last one was scrolled to.
  useEffect(() => { inner.current?.parentElement?.scrollTo({ top: 0 }); }, [scope.floor, scope.zone]);
  if (!meta) return <div className="side-inner"><p className="empty">Loading building data…</p></div>;

  const zones = meta.zones.filter((z) =>
    (scope.floor === undefined || z.floor === scope.floor) && (!scope.zone || z.zone === scope.zone));
  const results = zones.map((z) => byId.get(z.id)).filter((r): r is ZoneResult => !!r);
  const zone = scope.zone ? zones[0] : null;
  const auditZone = zone ? auditById.get(zone.id) : undefined;

  // Building and floor views lead with a summary; the detail stays one click away.
  const summaryFirst = !zone && mode === "overview";
  // What-if leads with the summary and the recommended plan; the simulation below starts from that plan.
  const planFirst = !zone && mode === "whatif";
  const detail = <>
      {auditLayer ? <QuestionAPanel zones={zones} measure={measure as AuditMeasure} scope={scope} auditZone={auditZone}
        detailMeasure={auditDetailMeasure} showPlanner={mode === "whatif"} /> : <>
        {mode === "replay" ? <ReplayReadout zones={zones} /> : <>
          {/* Setpoint What-If at the top in what-if mode */}
          {mode === "whatif" && <WhatIf results={results} zones={zones} />}

          {/* Occupant Comfort Section */}
          <OccupantComfortSection results={results} zones={zones} zone={zone} />

          {/* Energy Section */}
          <EnergySection results={results} />
        </>}
      </>}
      {/* Zones and Alerts at the bottom */}
      {!zone && !(mode === "whatif" && measure === "audit_load") && (auditLayer && measure === "audit_load" ? <>
        <ZoneGrid zones={zones} measureOverride="audit_load" onZoneSelect={setAuditDetailMeasure} />
        <ZoneGrid zones={zones} measureOverride="audit_classification" onZoneSelect={setAuditDetailMeasure} />
      </> : <ZoneGrid zones={zones} />)}
      {!auditLayer && <Alerts zones={zones} results={results} />}
  </>;

  return (
    <div className="side-inner" key={`${scope.floor}|${scope.zone}`} ref={inner}>
      <ScopeNav />
      <ScopeHeader zones={zones} />
      {summaryFirst ? <>
        <Overview zones={zones} />
        <Section title="Detailed Analysis" collapsible={true} defaultOpen={false} className="details">
          {detail}
        </Section>
      </> : planFirst ? <>
        <Overview zones={zones} />
        {detail}
        {!auditLayer && <Plan zones={zones} />}
      </> : detail}
    </div>
  );
}

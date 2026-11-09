import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BaselineFit, type LoadPattern, type Summary, type ZoneInfo, type ZoneResult } from "../lib/api";
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

// --- Baselines (ASHRAE Guideline 14) ----------------------------------------------------------
// Results are for the Jul–Dec 2019 test period. Zone baselines are for diagnosis; savings are
// verified against the floor baselines (whole-floor AC), where load shifting between zones cancels.
const passesBoth = (b: BaselineFit) => b.passes && b.passes_monthly;
const signed1 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;

/** The test-period criteria a baseline misses, e.g. ["hourly NMBE +16.2 %", "monthly NMBE +19.4 %"]. */
function baselineMisses(b: BaselineFit): string[] {
  const out: string[] = [];
  if (b.cv_rmse_pct > 30) out.push(`hourly CV(RMSE) ${n1(b.cv_rmse_pct)} %`);
  if (Math.abs(b.nmbe_pct) > 10) out.push(`hourly NMBE ${signed1(b.nmbe_pct)} %`);
  if (b.monthly_cv_rmse_pct > 15) out.push(`monthly CV(RMSE) ${n1(b.monthly_cv_rmse_pct)} %`);
  if (Math.abs(b.monthly_nmbe_pct) > 5) out.push(`monthly NMBE ${signed1(b.monthly_nmbe_pct)} %`);
  return out;
}

function BaselineBadge({ b, label }: { b: BaselineFit; label: string }) {
  const title = `Jul–Dec 2019 test: hourly CV(RMSE) ${n1(b.cv_rmse_pct)} %, NMBE ${signed1(b.nmbe_pct)} %; `
    + `monthly CV(RMSE) ${n1(b.monthly_cv_rmse_pct)} %, NMBE ${signed1(b.monthly_nmbe_pct)} %. `
    + "Limits: hourly 30 % and ±10 %, monthly 15 % and ±5 %."
    + (b.fit_passes ? " Its fit on Jul 2018–Jun 2019 passes." : "");
  if (passesBoth(b)) return <span className="badge ok" title={title}>{label} Baseline Passes ASHRAE 14</span>;
  if (b.passes) return <span className="badge warn" title={title}>{label} Baseline Passes ASHRAE 14 Hourly, Not Monthly</span>;
  return (
    <span className="badge warn" title={title}>
      {label} Baseline {b.fit_passes ? "Drifted in 2019 Test" : "Misses ASHRAE 14"} ({baselineMisses(b)[0]})
    </span>
  );
}

function FloorBaselineBadges({ floor }: { floor?: number }) {
  const { meta } = useData();
  const all = meta?.floor_baselines ?? [];
  if (floor !== undefined) {
    const b = all.find((x) => x.floor === floor);
    return b ? <div className="badges"><BaselineBadge b={b} label="Floor" /></div> : null;
  }
  if (!all.length) return null;
  const hourly = all.filter((b) => b.passes).length;
  const monthly = all.filter((b) => b.passes_monthly).length;
  return (
    <div className="badges">
      <span className={`badge ${hourly === all.length && monthly === all.length ? "ok" : "warn"}`}
        title="Each floor's whole-floor AC baseline on the Jul–Dec 2019 test. Savings are verified against these; zone baselines are for diagnosis.">
        Floor Baselines Pass ASHRAE 14: {hourly}/{all.length} Hourly, {monthly}/{all.length} Monthly
      </span>
    </div>
  );
}

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
  const { auditById, meta } = useData();
  const scope = useStore((s) => s.scope);
  const measure = useStore((s) => s.measure);
  const month = useStore((s) => s.month);
  const auditLayer = isAuditMeasure(measure);
  const sensors = zones.filter((z) => z.has_sensor).length;
  if (scope.zone) {
    const z = zones[0];
    const audit = z ? auditById.get(z.id) : undefined;
    const use = zoneUse(scope.floor!, scope.zone);
    const floorBase = meta?.floor_baselines?.find((b) => b.floor === scope.floor);
    return (
      <div className="scope">
        <h1>Floor {scope.floor}, {zoneName(scope.zone).toLowerCase()}</h1>
        {use && <p className="zone-use">{use.name}</p>}
        <p>{auditLayer
          ? audit ? `${audit.circuit_count} circuits · ${audit.preventable_count} preventable, ${audit.critical_count} critical standby`
            : "No circuit data for this zone."
          : z?.status === "nodata" ? z.note : z?.has_ac ? "Temperature, humidity and AC metered." : "Temperature and humidity only, no AC meter."}</p>
        {use && <p className="zone-lever">{use.lever}</p>}
        <div className="badges">
          {use && <span className="badge">{use.kindLabel}</span>}
          {auditLayer && audit && measure !== "audit_load" && <span className="badge" style={{ color: AUDIT_CLASS_COLORS[audit.classification], borderColor: AUDIT_CLASS_COLORS[audit.classification] }}>{audit.classification}</span>}
          {!auditLayer && z?.inspect && <span className="badge amber">Check First: {z.inspect}</span>}
          {!auditLayer && z?.baseline && <BaselineBadge b={z.baseline} label="Zone" />}
          {/* When the zone baseline is off, point to the one that savings are verified against. */}
          {!auditLayer && z?.baseline && !passesBoth(z.baseline) && floorBase &&
            <BaselineBadge b={floorBase} label={`Floor ${scope.floor}`} />}
        </div>
      </div>
    );
  }
  return (
    <div className="scope">
      <h1>{scope.floor ? `Floor ${scope.floor}` : "Whole Building"}</h1>
      <p>{auditLayer
        ? `${[...auditById.values()].filter((a) => scope.floor === undefined || a.floor === scope.floor).reduce((n, a) => n + a.circuit_count, 0)} audited circuits · ${month ? monthLabel(month) : "Jul 2018–Jun 2019"}`
        : <>{scope.floor ? `${zones.length} zones, ${sensors} with sensors.`
          : "Office hours: workdays 08:00–17:00, excluding lunch."}
          {scope.floor === 1 && " No indoor sensors on Floor 1."}</>}</p>
      {!auditLayer && <FloorBaselineBadges floor={scope.floor} />}
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
  const { meta } = useData();
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const month = useStore((s) => s.month);
  const a = rollup(results, false);
  const b = rollup(results, true);
  const w = mode === "whatif";
  if (!results.length) return null;

  // Cooling EUI (office-hours AC per m²) for building or floor level only
  const BUILDING_AREA_M2 = 11700;
  const FLOOR_AREA_M2 = BUILDING_AREA_M2 / 7;
  const periodsPerYear = meta?.rules.office_periods_per_year ?? 7776;
  const showEUI = !scope.zone; // Show EUI for whole building or single floor, not for zones

  let euiBefore: number | null = null;
  let euiAfter: number | null = null;

  if (showEUI && a.periods > 0) {
    const area = scope.floor === undefined ? BUILDING_AREA_M2 : FLOOR_AREA_M2;
    // Annualise each zone on its own periods, then sum: zones' periods overlap in time,
    // so dividing the pooled kWh by the pooled periods would give one average zone, not the building.
    const annualKwh = (after: boolean) => results.reduce((n, z) => z.before.periods
      ? n + ((after ? z.before.ac_kwh - z.after.saved_kwh : z.before.ac_kwh) / z.before.periods) * periodsPerYear : n, 0);
    euiBefore = annualKwh(false) / area;
    euiAfter = annualKwh(true) / area;
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
            label="Cooling EUI (Office Hours)"
            value={n1(euiBefore)}
            after={w ? n1(euiAfter!) : null}
            unit="kWh/m²/year"
            hint={`Office-hours AC over ${n0(periodsPerYear / 4)} h a year, per m² of ${scope.floor === undefined ? 'the building (11,700 m²)' : `floor ${scope.floor} (${Math.round(FLOOR_AREA_M2)} m²)`}`}
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
      <p className="note">
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
  const reliable = rules?.reliable_change_c ?? 3;
  const extra = b.saved_kwh < 0;          // a lower setpoint costs AC energy instead of saving it

  return (
    <Section title="Setpoint What-If" collapsible={true} defaultOpen={true} aside={nOverrides ? <button className="link" onClick={() => setWhatif({ overrides: {} })}>Clear {nOverrides} Zone Override{nOverrides > 1 ? "s" : ""}</button> : null}>
      <div className="segmented wide" role="group" aria-label="Setpoint scenario">
        <button type="button" className={whatif.mode === "rule" ? "on" : ""} aria-pressed={whatif.mode === "rule"} onClick={() => setWhatif({ mode: "rule" })}>Rule Recommendation</button>
        <button type="button" className={whatif.mode === "global" ? "on" : ""} aria-pressed={whatif.mode === "global"} onClick={() => setWhatif({ mode: "global" })}>Same Change Everywhere</button>
      </div>
      {whatif.mode === "global" ? (
        <label className="slider">
          <span>Change Every Zone’s Setpoint by <b>{signedC(whatif.globalC)}</b></span>
          <input type="range" min={-limit} max={limit} step={0.5} value={whatif.globalC} onChange={(e) => setWhatif({ globalC: +e.target.value })} />
        </label>
      ) : (
        <p className="note">
          Per zone and month: {rules?.raise_step_c ?? 1} °C steps up while over {n0((rules?.raise_if_too_cool ?? 0.25) * 100)} % of office time is too cool, to +{rules?.max_raise_c ?? 5} °C, or down while over {n0((rules?.lower_if_too_warm ?? 0.25) * 100)} % is too warm, to -{rules?.max_lower_c ?? 5} °C.
          Stops before over {n0((rules?.too_warm_tolerance ?? 0.1) * 100)} % overshoots the comfort band or humid time rises.
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
      {zone && !zone.simulated && zone.status === "data" && <p className="note">No AC meter here, so nothing to simulate.</p>}

      <div className="result">
        <div>
          <span className="stat-label">{extra ? "Extra AC Energy" : "AC Energy Saved"}, {month ? monthLabel(month) : "Sensor Months"}</span>
          <span className={`big ${extra ? "bad" : ""}`}>{kwh(Math.abs(b.saved_kwh))}</span>
          <span className="sub">{n1(b.ac_kwh ? (Math.abs(b.saved_kwh) / b.ac_kwh) * 100 : 0)} % {extra ? "more" : "of"} this AC, about {kwh(Math.abs(b.annual_kwh_saved ?? 0))} a year</span>
        </div>
        <div>
          <span className="stat-label">Over the Guardrail</span>
          <span className={`big ${breaches.length ? "bad" : ""}`}>{breaches.length}</span>
          <span className="sub">{breaches.length ? breaches.map((z) => z.id.replace(":", " ")).join(", ") : "No zone too warm, humid or too cool"}</span>
        </div>
      </div>
      {whatif.mode === "rule" || Math.abs(whatif.globalC) > reliable || Object.values(whatif.overrides).some((c) => Math.abs(c) > reliable)
        ? <p className="note">Beyond ±{reliable} °C these figures are extrapolated. Treat them as rough.</p>
        : null}
      {!scope.zone && <p className="note">Check-first zones keep today’s setpoint unless overridden. Annual figures assume {n0(meta?.rules.office_periods_per_year ? meta.rules.office_periods_per_year / 4 : 1944)} office hours.</p>}
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
    </Section>
  );
}

interface Alert { id: string; level: "red" | "amber" | "grey"; title: string; detail: string }

function Alerts({ zones, results }: { zones: ZoneInfo[]; results: ZoneResult[] }) {
  const { meta } = useData();
  const mode = useStore((s) => s.mode);
  const select = useStore((s) => s.select);
  const alerts: Alert[] = [];
  if (mode === "whatif")
    for (const r of results.filter((z) => z.breach.length))
      alerts.push({ id: r.id, level: "red", title: `${r.id.replace(":", " ")} would go ${r.breach.join(" and ")}`,
        detail: `In ${r.breach_months.map(monthLabel).join(", ")}. Step it back toward today's setpoint.` });
  for (const z of zones.filter((z) => z.inspect))
    alerts.push({ id: z.id, level: "amber", title: `${z.id.replace(":", " ")}: check before adjusting`, detail: z.inspect! });
  const floorBase = new Map((meta?.floor_baselines ?? []).map((b) => [b.floor, b]));
  for (const z of zones.filter((z) => z.baseline && !passesBoth(z.baseline))) {
    const b = z.baseline!;
    const fb = floorBase.get(z.floor);
    const what = !b.passes ? (b.fit_passes ? "drifted" : "misses ASHRAE 14") : "misses ASHRAE 14 monthly";
    const pointer = fb && passesBoth(fb) ? `; use the Floor ${z.floor} baseline, which passes`
      : fb?.passes ? `; the Floor ${z.floor} baseline passes hourly` : "";
    alerts.push({ id: z.id, level: "grey", title: `${z.id.replace(":", " ")}: zone baseline ${what}`,
      detail: `Jul–Dec 2019 test: ${baselineMisses(b).join(", ")}. Not reliable for verifying savings in this zone${pointer}.` });
  }
  if (!alerts.length) return null;
  const item = (a: Alert, i: number) => {
    const [f, z] = a.id.slice(1).split(":");
    return (
      <li key={i} className={a.level}>
        <button type="button" onClick={() => select({ floor: +f, zone: z })}>
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
                <b>{model.length} zones’ baselines miss ASHRAE 14 in the 2019 test</b>
                <span>Not reliable for verifying savings there. Show zones</span>
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
const LOAD_NOTE: Record<NonNullable<LoadPattern["level"]>, string> = {
  zone: "Zone baseline from weather, the zone's lighting and plug use, hour, weekday and holidays, trained Jul 2018–Jun 2019.",
  floor: "Floor baseline (whole-floor AC) from weather, the floor's lighting and plug use, hour, weekday and holidays, "
    + "trained Jul 2018–Jun 2019. This is the baseline to verify savings against.",
  building: "Sum of the floor baselines (whole-floor AC on Floors 2–7), trained Jul 2018–Jun 2019.",
  zones: "Sum of the zone baselines, from weather, lighting and plug use, hour, weekday and holidays, trained Jul 2018–Jun 2019.",
};

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
            {LOAD_NOTE[data.level ?? "zones"]}
            {data.test_actual_kwh !== undefined && ` Test period: ${kwh(data.test_actual_kwh)} actual, ${kwh(data.test_baseline_kwh)} predicted.`}
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
      <p className="note">No sensor data from mid-Sep 2018 to Feb 2019.</p>
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
            <Stat label="AC Saved per +1 °C" value={n1(zone.kw_per_c)} unit="kW" />
            <Stat label="Share of This Zone’s AC" value={n1(zone.pct_per_c)} unit="%" />
            <Stat label="Mean AC Power" value={result ? n1(acKw(result.before, false)) : "–"} unit="kW" />
          </div>
          <p className="note">
            From {zone.kw_per_c_source === "zone" ? "this zone’s" : "the floor’s"} daily data, controlling for weather and weekday.
            Moisture rises about {n1(zone.moisture_per_c)} g/kg per °C.
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
            <thead><tr><th>Month</th><th>Change</th><th>Too Cool</th><th>Saved</th><th>Why</th></tr></thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.month} className={month === r.month ? "on" : ""}>
                  <td>{monthLabel(r.month)}</td>
                  <td>{signedC(r.recommended_raise_c)}</td>
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
      {!zone && (!auditLayer || mode !== "whatif") && (
        <ZoneGrid zones={zones} onZoneSelect={setAuditDetailMeasure} />
      )}
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
        {!auditLayer && <Overview zones={zones} />}
        {detail}
        {!auditLayer && <Plan zones={zones} />}
      </> : detail}
    </div>
  );
}

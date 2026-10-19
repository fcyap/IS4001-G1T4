import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type EnergyAuditZone, type Meta, type Replay, type Summary, type WhatIfResult, type ZoneResult } from "./api";
import type { Measure } from "./store";
import { scenarioBody, useStore } from "./store";

interface Data {
  meta: Meta | null;
  result: WhatIfResult | null;
  byId: Map<string, ZoneResult>;
  auditById: Map<string, EnergyAuditZone>;
  replay: Replay | null;
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<Data>({ meta: null, result: null, byId: new Map(), auditById: new Map(), replay: null, loading: true, error: null });
export const useData = () => useContext(Ctx);

/** Fetch with abort + small debounce, so dragging a slider sends one request, not twenty. */
function useFetch<T>(key: string, fn: ((signal: AbortSignal) => Promise<T>) | null, delay = 120) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>(
    { data: null, loading: !!fn, error: null });
  useEffect(() => {
    if (!fn) { setState({ data: null, loading: false, error: null }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      fn(ctrl.signal)
        .then((data) => setState({ data, loading: false, error: null }))
        .catch((e) => { if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, error: String(e.message ?? e) })); });
    }, delay);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
export { useFetch };

export function DataProvider({ children }: { children: ReactNode }) {
  const mode = useStore((s) => s.mode);
  const month = useStore((s) => s.month);
  const whatif = useStore((s) => s.whatif);
  const date = useStore((s) => s.replay.date);
  const setReplay = useStore((s) => s.setReplay);

  const meta = useFetch("meta", () => api.meta(), 0);
  const body = scenarioBody({ mode, month, whatif });
  const result = useFetch(JSON.stringify(body), (sig) => api.whatif(body, sig));
  const rbody = scenarioBody({ mode, month, whatif }, true);
  const replay = useFetch(mode === "replay" && date ? `${date}|${JSON.stringify(rbody)}` : "none",
    mode === "replay" && date ? (sig) => api.replay(date, rbody, sig) : null);

  useEffect(() => {          // default replay day: a hot weekday in the middle of the sensor months
    if (meta.data && !date) {
      const days = meta.data.office_days;
      setReplay({ date: days.includes("2019-05-14") ? "2019-05-14" : days[Math.floor(days.length / 2)] });
    }
  }, [meta.data, date, setReplay]);

  const value = useMemo<Data>(() => ({
    meta: meta.data,
    result: result.data,
    byId: new Map((result.data?.zones ?? []).map((z) => [z.id, z])),
    auditById: new Map((meta.data?.energy_audit ?? []).map((z) => [z.id, z])),
    replay: replay.data,
    loading: meta.loading || result.loading || replay.loading,
    error: meta.error ?? result.error ?? replay.error,
  }), [meta, result, replay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// --- Values shown for a zone ---------------------------------------------------------------
export const acKw = (s: Summary, after: boolean) =>
  s.periods ? ((after ? s.ac_kwh - s.saved_kwh : s.ac_kwh) / (s.periods * 0.25)) : 0;

export function zoneValue(z: ZoneResult | undefined, measure: Measure, after: boolean): number | null {
  if (!z) return null;
  const s = after ? z.after : z.before;
  switch (measure) {
    case "too_cool": return s.pct_too_cool;
    case "comfortable": return s.pct_comfortable;
    case "pmv": return s.mean_pmv;
    case "ac": return acKw(z.before, after);
    case "saved": return z.after.saved_kwh;
  }
}

/** Value at replay step t (PMV or AC kW). */
export function replayValue(r: Replay | null, id: string, measure: Measure, t: number, after: boolean): number | null {
  const z = r?.zones[id];
  if (!z) return null;
  const key = measure === "ac" ? (after ? "ac_after" : "ac_before") : (after ? "pmv_after" : "pmv_before");
  return z[key][t] ?? null;
}

/** Weighted roll-up of zone summaries (counts make the percentages exact). */
export function rollup(zones: ZoneResult[], after: boolean) {
  const n = zones.reduce((a, z) => a + (after ? z.after : z.before).periods, 0);
  const sum = (f: (s: Summary) => number) => zones.reduce((a, z) => a + f(after ? z.after : z.before), 0);
  const w = (f: (s: Summary) => number) => (n ? sum((s) => f(s) * s.periods) / n : NaN);
  return {
    periods: n,
    pct_too_cool: n ? (sum((s) => s.n_too_cool) / n) * 100 : NaN,
    pct_comfortable: n ? (sum((s) => s.n_comfortable) / n) * 100 : NaN,
    pct_too_warm: n ? (sum((s) => s.n_too_warm) / n) * 100 : NaN,
    pct_humid: n ? (sum((s) => s.n_humid) / n) * 100 : NaN,
    mean_temp_c: w((s) => s.mean_temp_c),
    mean_rh_pct: w((s) => s.mean_rh_pct),
    mean_pmv: w((s) => s.mean_pmv),
    ac_kwh: sum((s) => s.ac_kwh),
    saved_kwh: zones.reduce((a, z) => a + z.after.saved_kwh, 0),
    annual_kwh_saved: zones.reduce((a, z) => a + (z.after.annual_kwh_saved ?? 0), 0),
    mean_out_temp_c: n ? zones.reduce((a, z) => a + z.mean_out_temp_c * z.before.periods, 0) / n : NaN,
  };
}

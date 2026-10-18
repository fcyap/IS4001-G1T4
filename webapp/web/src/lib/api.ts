// Types and fetchers for the FastAPI backend (webapp/api/main.py).

export interface ZoneInfo {
  id: string; floor: number; zone: string;
  status: "data" | "nodata"; note: string | null;
  has_sensor: boolean; has_ac: boolean; simulated: boolean;
  inspect: string | null;
  kw_per_c: number | null; kw_per_c_source: string | null; pct_per_c: number | null;
  moisture_per_c: number | null;
  baseline: { model: string; cv_rmse_pct: number; nmbe_pct: number; r2: number; passes: boolean } | null;
}

export interface HeatCell {
  floor: number; zone: string; month: string; periods: number;
  pct_too_cool: number; pct_comfortable: number; pct_too_warm: number; pct_humid: number;
  median_temp_c: number; median_rh_pct: number; mean_pmv: number;
}

export interface MonthlyRec {
  floor: number; zone: string; month: string; periods: number;
  recommended_raise_c: number; reason: string;
  temp_before_c: number; temp_after_c: number;
  pct_too_cool_before: number; pct_too_cool_after: number;
  pct_comfortable_before: number; pct_comfortable_after: number;
  pct_too_warm_after: number; pct_humid_before: number; pct_humid_after: number;
  ac_kwh: number; saved_kwh: number; pct_ac_saved: number;
}

export interface Meta {
  floors: number[];
  zones: ZoneInfo[];
  months: string[];
  office_days: string[];
  rules: { raise_step_c: number; max_raise_c: number; raise_if_too_cool: number; too_warm_tolerance: number; office_periods_per_year: number };
  heatmap: HeatCell[];
  monthly: MonthlyRec[];
}

export interface Summary {
  periods: number;
  n_too_cool: number; n_comfortable: number; n_too_warm: number; n_humid: number;
  pct_too_cool: number; pct_comfortable: number; pct_too_warm: number; pct_humid: number;
  mean_temp_c: number; mean_rh_pct: number; mean_pmv: number;
  ac_kwh: number; saved_kwh: number; pct_ac_saved: number;
  annual_kwh_saved?: number;
}

export interface ZoneResult {
  id: string; raise_c: number; raise_max: number;
  mean_out_temp_c: number; before: Summary; after: Summary; breach: string[]; breach_months: string[];
}

export interface WhatIfResult {
  zones: ZoneResult[];
}

export interface ZoneDetail {
  pmv_bins: number[]; rh_bins: number[];
  pmv_before: number[]; pmv_after: number[]; rh_before: number[]; rh_after: number[];
}

export type Series = (number | null)[];
export interface Replay {
  date: string; times: string[]; out_temp_c: Series;
  zones: Record<string, Record<
    "temp_before" | "temp_after" | "pmv_before" | "pmv_after" | "rh_before" | "rh_after" | "ac_before" | "ac_after",
    Series>>;
}

export interface LoadPattern {
  weeks: string[]; actual: number[]; baseline: number[]; test_start: string;
  test_actual_kwh?: number; test_baseline_kwh?: number;
}

export interface ScenarioBody {
  mode: "global" | "rule"; global_c: number; overrides: Record<string, number>; months: string[];
}

async function req<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, body === undefined ? { signal } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  whatif: (b: ScenarioBody, s?: AbortSignal) => req<WhatIfResult>("/api/whatif", b, s),
  zone: (floor: number, zone: string, b: ScenarioBody, s?: AbortSignal) =>
    req<ZoneDetail>(`/api/zone/${floor}/${zone}`, b, s),
  replay: (date: string, b: ScenarioBody, s?: AbortSignal) => req<Replay>(`/api/replay/${date}`, b, s),
  load: (floor?: number, zone?: string, s?: AbortSignal) => {
    const q = new URLSearchParams();
    if (floor !== undefined) q.set("floor", String(floor));
    if (zone !== undefined) q.set("zone", zone);
    return req<LoadPattern>(`/api/load?${q}`, undefined, s);
  },
};

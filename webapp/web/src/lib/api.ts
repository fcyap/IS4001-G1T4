// Types and fetchers for the FastAPI backend (webapp/api/main.py).

/** ASHRAE Guideline 14 results of a zone or floor baseline on the Jul–Dec 2019 test period.
 *  fit_passes: whether its fit on the baseline period (Jul 2018–Jun 2019) passes, hourly and monthly. */
export interface BaselineFit {
  model: string; cv_rmse_pct: number; nmbe_pct: number; r2: number; passes: boolean;
  monthly_cv_rmse_pct: number; monthly_nmbe_pct: number; passes_monthly: boolean;
  fit_passes: boolean | null;
}
export interface FloorBaseline extends BaselineFit { floor: number }

export interface ZoneInfo {
  id: string; floor: number; zone: string;
  status: "data" | "nodata"; note: string | null;
  has_sensor: boolean; has_ac: boolean; simulated: boolean;
  inspect: string | null;
  kw_per_c: number | null; kw_per_c_source: string | null; pct_per_c: number | null;
  moisture_per_c: number | null;
  baseline: BaselineFit | null;
}

export type AuditClassification = "Preventable Waste" | "Critical Standby" | "Mixed";
export interface EnergyAuditCircuit {
  circuit_id: string;
  type: string;
  classification: Exclude<AuditClassification, "Mixed">;
  /** K-Means behaviour group: "Critical Standby (24/7 Steady)", "Extended-Hours / Scheduled" or "Occupancy-Following". */
  behaviour_group?: string;
  unocc_to_occ_ratio?: number;
  offhours_cv?: number;
  unocc_mean_kw: number | null; baseload_kw: number;
  annual_unocc_hours: number; annual_expected_unocc_hours: number;
  /** WASTE: after-hours load above the dynamic P2.5 baseload (lights and plugs). */
  annual_surplus_kwh: number;
  annual_cost_thb: number;
  /** CURFEW MAXIMUM: what a full curfew would save (lights fully off, plugs down to their baseload). */
  annual_curfew_max_kwh: number;
  annual_curfew_max_cost_thb: number;
  monthly: Record<string, EnergyAuditPeriod>;
}
export interface EnergyAuditPeriod {
  /** Waste above the baseload. */
  surplus_kwh: number | null;
  cost_thb: number | null;
  /** Theoretical maximum a full curfew would save. */
  curfew_max_kwh: number | null;
  curfew_max_cost_thb: number | null;
  unocc_mean_kw: number | null;
  unocc_hours: number; expected_unocc_hours: number;
  energy_coverage_pct: number; load_coverage_pct: number;
}
export interface EnergyAuditZone {
  id: string; floor: number; zone: string;
  classification: AuditClassification;
  circuit_count: number; preventable_count: number; critical_count: number;
  annual_surplus_kwh: number; annual_cost_thb: number; unocc_mean_kw: number | null;
  annual_curfew_max_kwh: number; annual_curfew_max_cost_thb: number;
  annual_unocc_hours: number; annual_expected_unocc_hours: number;
  annual_energy_coverage_pct: number; annual_load_coverage_pct: number;
  monthly: Record<string, EnergyAuditPeriod>;
  circuits: EnergyAuditCircuit[];
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
  floor_baselines?: FloorBaseline[];
  energy_audit: EnergyAuditZone[];
  afterhours_timing: Record<string, { cutoff_hour: number; start_hour?: number; end_hour?: number; weekends_off?: boolean; annual_kwh: number; annual_cost_thb: number;
    annual_load_kw: number; annual_projected_load_kw: number; annual_preventable_load_kw: number;
    monthly: Record<string, { kwh: number; cost_thb: number; load_kw: number;
      projected_load_kw: number; preventable_load_kw: number }> }[]>;
  months: string[];
  office_days: string[];
  rules: { raise_step_c: number; max_raise_c: number; max_lower_c: number; reliable_change_c: number; whatif_limit_c: number; raise_if_too_cool: number; lower_if_too_warm: number; too_warm_tolerance: number; office_periods_per_year: number };
  heatmap: HeatCell[];
  monthly: MonthlyRec[];
  ai_configured?: boolean;
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
  id: string; raise_c: number; raise_max: number; raise_min: number;
  mean_out_temp_c: number; before: Summary; after: Summary; breach: string[]; breach_months: string[];
  /** Every sensor month, whatever month is picked: [before, after] % of office time. */
  monthly?: Record<string, { too_cool: [number, number]; comfortable: [number, number]; humid: [number, number] }>;
  /** AC kWh saved per week (week ending Sunday, as in LoadPattern.weeks); negative = extra AC. */
  weekly_saved_kwh?: Record<string, number>;
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
  /** zone: the zone's own baseline; floor: the floor baseline; building: sum of floor baselines;
   *  zones: sum of zone baselines (floor baselines not built). */
  level?: "zone" | "floor" | "building" | "zones";
  test_actual_kwh?: number; test_baseline_kwh?: number;
}

export interface ScenarioBody {
  mode: "global" | "rule"; global_c: number; overrides: Record<string, number>; months: string[];
}

export interface CircuitWindowOverride {
  start_hour: number;
  end_hour: number;
  /** true: also off all day on weekends & public holidays; false: the same hours every day. Inherited when absent. */
  weekends_off?: boolean;
}

/** What happens to a circuit after hours. The K-Means class gives the recommendation; the FM can change it. */
export type CircuitMode = "keep_on" | "curfew";

/** One exception to the building-wide default. The most specific exception wins: circuit > zone > floor. */
export interface CurfewException {
  /** "F1", "F1:z4" or "F1:z4:Floor1_z4_Light(kW)"; one exception per target. */
  id: string;
  floor: number;
  zone?: string;
  circuit?: string;
  mode: "keep_on" | "hours";
  start_hour: number;
  end_hour: number;
  weekends_off: boolean;
}

export interface AIChatRequest {
  message: string;
  history: { role: "user" | "bot"; text: string }[];
  floor?: number;
  zone?: string;
  month?: string | null;
  start_hour: number;
  end_hour: number;
  weekends_off: boolean;
  kept_on: string[];
  circuit_windows?: Record<string, CircuitWindowOverride>;
  api_key?: string | null;
}

export interface AIChatResponse {
  source: "gemini" | "telemetry_engine";
  reply: string;
}

const GEMINI_KEY_STORAGE = "chamchuri_gemini_api_key";

export function getStoredGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setStoredGeminiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
    window.dispatchEvent(new CustomEvent("gemini-key-change"));
  } catch {
    // ignore storage errors
  }
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
  aiChat: (b: AIChatRequest, s?: AbortSignal) => req<AIChatResponse>("/api/ai/chat", b, s),
};

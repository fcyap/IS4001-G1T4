import { create } from "zustand";
import type { ScenarioBody } from "./api";

export type Mode = "overview" | "whatif" | "replay";
export type Measure = "too_cool" | "comfortable" | "pmv" | "ac" | "saved";
export type AuditMeasure = "audit_classification" | "audit_load" | "audit_kwh" | "audit_cost";
export type MapMeasure = Measure | AuditMeasure;
export const isAuditMeasure = (measure: MapMeasure): measure is AuditMeasure => measure.startsWith("audit_");
export interface Scope { floor?: number; zone?: string }

interface State {
  scope: Scope;
  mode: Mode;
  month: string | null;             // null = all months available to the active view
  measure: MapMeasure;
  auditCaptureRates: Record<string, number>;
  view: "3d" | "plan";
  hover: string | null;
  whatif: { mode: "global" | "rule"; globalC: number; overrides: Record<string, number> };
  replay: { date: string | null; t: number; playing: boolean; speed: number; after: boolean };

  select: (s: Scope) => void;
  up: () => void;
  setMode: (m: Mode) => void;
  setMonth: (m: string | null) => void;
  setMeasure: (m: MapMeasure) => void;
  setAuditCaptureRate: (zoneId: string, rate: number) => void;
  setAuditCaptureRates: (zoneIds: string[], rate: number) => void;
  setView: (v: "3d" | "plan") => void;
  setHover: (id: string | null) => void;
  setWhatif: (p: Partial<State["whatif"]>) => void;
  setOverride: (id: string, c: number | null) => void;
  setReplay: (p: Partial<State["replay"]>) => void;
}

// Deep links for demos, e.g. ?mode=whatif&floor=4&zone=z2
const q = new URLSearchParams(window.location.search);
const initialScope: Scope = q.get("floor") ? { floor: +q.get("floor")!, zone: q.get("zone") ?? undefined } : {};
const initialMode = (["overview", "whatif", "replay"].includes(q.get("mode") ?? "") ? q.get("mode") : "overview") as Mode;

export const useStore = create<State>((set, get) => ({
  scope: initialScope,
  mode: initialMode,
  month: null,
  measure: initialMode === "replay" ? "pmv" : initialMode === "whatif" ? "saved" : "too_cool",
  auditCaptureRates: {},
  view: q.get("view") === "plan" ? "plan" : "3d",
  hover: null,
  whatif: { mode: "rule", globalC: 1, overrides: {} },
  replay: { date: null, t: 0, playing: false, speed: 4, after: false },

  select: (scope) => set({ scope }),
  up: () => {
    const { scope } = get();
    set({ scope: scope.zone ? { floor: scope.floor } : {} });
  },
  setMode: (mode) => set((s) => ({
    mode,
    measure: mode === "replay" ? (s.measure === "ac" ? "ac" : "pmv")
      : mode === "whatif" ? "saved"
      : s.measure === "saved" || isAuditMeasure(s.measure) ? "too_cool" : s.measure,
    replay: { ...s.replay, playing: false },
  })),
  setMonth: (month) => set({ month }),
  setMeasure: (measure) => set({ measure }),
  setAuditCaptureRate: (zoneId, rate) => set((s) => ({ auditCaptureRates: { ...s.auditCaptureRates, [zoneId]: rate } })),
  setAuditCaptureRates: (zoneIds, rate) => set((s) => ({ auditCaptureRates: {
    ...s.auditCaptureRates, ...Object.fromEntries(zoneIds.map((id) => [id, rate])),
  } })),
  setView: (view) => set({ view }),
  setHover: (hover) => set({ hover }),
  setWhatif: (p) => set((s) => ({ whatif: { ...s.whatif, ...p } })),
  setOverride: (id, c) => set((s) => {
    const overrides = { ...s.whatif.overrides };
    if (c === null) delete overrides[id]; else overrides[id] = c;
    return { whatif: { ...s.whatif, overrides } };
  }),
  setReplay: (p) => set((s) => ({ replay: { ...s.replay, ...p } })),
}));

/** The scenario the backend should simulate. Overview shows today, so it asks for no change. */
export function scenarioBody(s: Pick<State, "mode" | "month" | "whatif">, forReplay = false): ScenarioBody {
  const active = s.mode === "whatif" || (forReplay && s.mode === "replay");
  return {
    mode: active ? s.whatif.mode : "global",
    global_c: active ? s.whatif.globalC : 0,
    overrides: active ? s.whatif.overrides : {},
    months: s.month && !forReplay ? [s.month] : [],
  };
}

export const zoneId = (floor: number, zone: string) => `F${floor}:${zone}`;
export const zoneName = (zone: string) => `Zone ${zone.slice(1)}`;
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleString("en-GB", { month: "short", year: "numeric" });

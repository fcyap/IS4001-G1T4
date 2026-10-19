import { create } from "zustand";
import type { ScenarioBody } from "./api";

export type Topic = "home" | "afterhours" | "comfort";   // landing page, Question A, Question B
export type Mode = "overview" | "whatif" | "replay";
export type Measure = "too_cool" | "comfortable" | "pmv" | "ac" | "saved";
export type AuditMeasure = "audit_classification" | "audit_load" | "audit_kwh" | "audit_cost";
export type MapMeasure = Measure | AuditMeasure;
export const isAuditMeasure = (measure: MapMeasure): measure is AuditMeasure => measure.startsWith("audit_");
export interface Scope { floor?: number; zone?: string }

interface State {
  topic: Topic;
  scope: Scope;
  mode: Mode;
  month: string | null;             // null = all months available to the active view
  measure: MapMeasure;
  auditCaptureRates: Record<string, number>;
  view: "3d" | "plan";
  hover: string | null;
  whatif: { mode: "global" | "rule"; globalC: number; overrides: Record<string, number> };
  replay: { date: string | null; t: number; playing: boolean; speed: number; after: boolean };
  fading: boolean;                  // the current view is fading out before a question change
  entering: boolean;                // a question has mounted but the layout still shows the landing page

  setTopic: (t: Topic) => void;
  navigate: (t: Topic, mode?: Mode) => void;
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

// Deep links for demos, e.g. ?topic=afterhours or ?mode=whatif&floor=4&zone=z2.
// Without ?topic, any other link parameter opens cooling comfort; a bare URL opens the landing page.
const q = new URLSearchParams(window.location.search);
const initialScope: Scope = q.get("floor") ? { floor: +q.get("floor")!, zone: q.get("zone") ?? undefined } : {};
const initialMode = (["overview", "whatif", "replay"].includes(q.get("mode") ?? "") ? q.get("mode") : "overview") as Mode;
const initialTopic: Topic = ["home", "afterhours", "comfort"].includes(q.get("topic") ?? "") ? q.get("topic") as Topic
  : ["mode", "floor", "view"].some((k) => q.has(k)) ? "comfort" : "home";
const comfortMeasure = (mode: Mode): Measure => mode === "replay" ? "pmv" : mode === "whatif" ? "saved" : "too_cool";

/** The modes each question offers: after-hours waste has no day replay. */
export const MODES_BY_TOPIC: Record<Topic, Mode[]> = {
  home: [], afterhours: ["overview", "whatif"], comfort: ["overview", "whatif", "replay"],
};
const modeFor = (topic: Topic, mode: Mode): Mode => MODES_BY_TOPIC[topic].includes(mode) ? mode : "overview";
const measureFor = (topic: Topic, mode: Mode): MapMeasure => topic === "afterhours" ? "audit_load" : comfortMeasure(mode);
const startMode = modeFor(initialTopic, initialMode);
const FADE_MS = 220;                // keep in step with --fade in theme.css
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const useStore = create<State>((set, get) => ({
  topic: initialTopic,
  scope: initialTopic === "home" ? {} : initialScope,
  mode: startMode,
  month: null,
  measure: measureFor(initialTopic, startMode),
  auditCaptureRates: {},
  view: q.get("view") === "plan" ? "plan" : "3d",
  hover: null,
  whatif: { mode: "rule", globalC: 1, overrides: {} },
  replay: { date: null, t: 0, playing: false, speed: 4, after: false },
  fading: false,
  entering: false,

  // Change question with a short fade: the current view fades out, then the new one slides in (see theme.css).
  navigate: (topic, mode) => {
    // Mount the new question while the layout still shows the landing page, so its one-off layout cost lands on a
    // still frame; two frames later the panel and top bar start gliding open.
    const go = () => {
      get().setTopic(topic);
      if (mode) get().setMode(mode);
      set({ fading: false, entering: topic !== "home" });
      if (topic !== "home") requestAnimationFrame(() => requestAnimationFrame(() => set({ entering: false })));
    };
    if (get().fading || topic === get().topic) return;
    if (reducedMotion()) return go();
    set({ fading: true });
    setTimeout(go, FADE_MS);
  },
  setTopic: (topic) => set((s) => {
    const mode = modeFor(topic, s.mode);      // keep the mode when the new question has it, e.g. What-if to What-if
    return { topic, mode, measure: measureFor(topic, mode), scope: topic === "home" ? {} : s.scope,
      replay: { ...s.replay, playing: false } };
  }),
  select: (scope) => set({ scope }),
  up: () => {
    const { scope } = get();
    if (scope.floor === undefined) get().navigate("home");     // already at the whole building: back to the landing page
    else set({ scope: scope.zone ? { floor: scope.floor } : {} });
  },
  setMode: (mode) => set((s) => ({
    mode,
    measure: s.topic === "afterhours" ? "audit_load"           // one layer for after-hours, in Today and What-if
      : mode === "replay" ? (s.measure === "ac" ? "ac" : "pmv")
      : mode === "whatif" ? "saved"
      : s.measure === "saved" ? "too_cool" : s.measure,
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

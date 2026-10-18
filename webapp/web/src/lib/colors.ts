// The thermal scale is the identity of the whole view: ice blue = too cool, sage = comfortable,
// amber = too warm. Every zone, dot, bar and chart uses these same stops.
import type { Measure } from "./store";

export const C = {
  cool: "#5fa8e8",
  comfy: "#7cc8a4",
  warm: "#f0924f",
  alert: "#ef5b55",
  inspect: "#e8b54a",
  nodata: "#2b3a50",
  ink: "#e4ebf3",
  muted: "#8a9bb3",
  line: "#22344d",
  panel: "#13223a",
  night: "#0c1829",
};

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
};
const ramp = (stops: string[], t: number) => {
  const u = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(u), stops.length - 2);
  return mix(stops[i], stops[i + 1], u - i);
};

const COOL_RAMP = ["#3a4658", "#3a5878", "#3b74ad", "#3d93e0", "#5cb6ff"];
const COMFY_RAMP = ["#3a4658", "#3c5a58", "#468a6c", "#5fb487", "#86e0ae"];
const AC_RAMP = ["#283c58", "#55618a", "#b0709a", "#f0924f"];
const SAVED_RAMP = ["#22384a", "#2f6a63", "#4fae8a", "#a6f0c8"];

/** PMV: diverging around the comfort band; -2 deep blue ... 0 sage ... +2 amber. */
export function pmvColor(pmv: number | null | undefined): string {
  if (pmv === null || pmv === undefined || Number.isNaN(pmv)) return C.nodata;
  if (pmv < -0.5) return ramp([C.cool, "#2f6fb4"], (-pmv - 0.5) / 1.5);
  if (pmv > 0.5) return ramp([C.warm, "#d9542f"], (pmv - 0.5) / 1.5);
  return mix(C.comfy, pmv < 0 ? C.cool : C.warm, Math.abs(pmv) / 0.5 * 0.25);
}

export interface MeasureDef { label: string; unit: string; color: (v: number) => string; domain: [number, number]; legend: string[] }

export const MEASURES: Record<Measure, MeasureDef> = {
  too_cool: { label: "Office Time Too Cool", unit: "%", domain: [0, 100],
    color: (v) => ramp(COOL_RAMP, v / 100), legend: COOL_RAMP },
  comfortable: { label: "Office Time Comfortable", unit: "%", domain: [0, 100],
    color: (v) => ramp(COMFY_RAMP, v / 100), legend: COMFY_RAMP },
  pmv: { label: "Mean PMV", unit: "", domain: [-2, 2],
    color: pmvColor, legend: ["#2f6fb4", C.cool, C.comfy, C.warm, "#d9542f"] },
  ac: { label: "Mean AC Power", unit: "kW", domain: [0, 40],
    color: (v) => ramp(AC_RAMP, v / 40), legend: AC_RAMP },
  saved: { label: "AC Energy Saved", unit: "kWh", domain: [0, 8000],
    color: (v) => ramp(SAVED_RAMP, Math.sqrt(v / 8000)), legend: SAVED_RAMP },
};

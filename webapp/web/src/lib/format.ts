export const n0 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Math.round(v).toLocaleString("en-GB"));
export const n1 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(1));
export const n3 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(3));
export const pmvTxt = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
export const kwh = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : v >= 10000 ? `${(v / 1000).toFixed(1)} MWh` : `${n0(v)} kWh`;
/** Setpoint change with its sign, e.g. "+2.0 °C", "−1.5 °C", "0.0 °C". */
export const signedC = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} °C`;
export const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

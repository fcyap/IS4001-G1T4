import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { HeatCell, LoadPattern, ZoneDetail } from "../lib/api";
import { C, MEASURES } from "../lib/colors";
import { monthLabel } from "../lib/store";

const axis = {
  axisLine: { lineStyle: { color: C.line } },
  axisTick: { show: false },
  axisLabel: { color: C.muted, fontSize: 11, fontFamily: "inherit" },
  splitLine: { lineStyle: { color: "rgba(34,52,77,0.6)" } },
};
const tooltip = {
  backgroundColor: "#0f1d31", borderColor: "#2a4062", textStyle: { color: C.ink, fontSize: 12, fontFamily: "inherit" },
};
const base = { backgroundColor: "transparent", textStyle: { fontFamily: "Plus Jakarta Sans Variable, Segoe UI, sans-serif" }, animationDuration: 400 };

export function LoadChart({ data, height = 190 }: { data: LoadPattern; height?: number }) {
  const option = useMemo(() => {
    const testIdx = data.weeks.findIndex((w) => w >= data.test_start);
    return {
      ...base,
      grid: { left: 44, right: 22, top: 26, bottom: 22 },
      legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: C.muted, fontSize: 11 },
        data: ["Actual", "Baseline Model"] },
      tooltip: { ...tooltip, trigger: "axis", valueFormatter: (v: number) => `${Math.round(v).toLocaleString()} kWh` },
      xAxis: { type: "category", data: data.weeks, ...axis, splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, formatter: (w: string) => monthLabel(w.slice(0, 7)), interval: 12 } },
      yAxis: { type: "value", ...axis, name: "kWh / week", nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : v) } },
      series: [
        { name: "Actual", type: "line", data: data.actual, symbol: "none", lineStyle: { width: 1.5, color: "#9fb2cc" },
          markArea: testIdx >= 0 ? { silent: true, itemStyle: { color: "rgba(95,168,232,0.08)" },
            label: { color: C.muted, fontSize: 10, position: "insideTopLeft" },
            data: [[{ name: "Test Period", xAxis: data.weeks[testIdx] }, { xAxis: data.weeks[data.weeks.length - 1] }]] } : undefined },
        { name: "Baseline Model", type: "line", data: data.baseline, symbol: "none", lineStyle: { width: 1.5, color: C.cool, type: [4, 3] } },
      ],
    };
  }, [data]);
  return <ReactECharts option={option} style={{ height }} notMerge />;
}

type HeatKey = "pct_too_cool" | "pct_comfortable" | "pct_humid";
const HEAT_RAMP: Record<HeatKey, string[]> = {
  pct_too_cool: MEASURES.too_cool.legend,
  pct_comfortable: MEASURES.comfortable.legend,
  pct_humid: ["#24324a", "#4b4f7a", "#9e6aa8", "#e3a0c8"],
};

export function HeatMap({ cells, months, measure, onPick }: {
  cells: HeatCell[]; months: string[]; measure: HeatKey; onPick?: (floor: number, zone: string) => void;
}) {
  const rows = useMemo(() => [...new Set(cells.map((c) => `F${c.floor} z${c.zone.slice(1)}`))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [cells]);
  const option = useMemo(() => ({
    ...base,
    grid: { left: 52, right: 8, top: 4, bottom: 40 },
    tooltip: { ...tooltip, formatter: (p: { value: [number, number, number] }) =>
      `${rows[p.value[1]]}, ${monthLabel(months[p.value[0]])}<br/><b>${p.value[2].toFixed(0)} %</b>` },
    xAxis: { type: "category", data: months.map((m) => monthLabel(m).replace(" 20", " ’")), ...axis, splitArea: { show: false },
      axisLabel: { ...axis.axisLabel, rotate: 45, fontSize: 10 } },
    yAxis: { type: "category", data: rows, ...axis, axisLabel: { ...axis.axisLabel, fontSize: 10 } },
    visualMap: { show: false, min: 0, max: 100, inRange: { color: HEAT_RAMP[measure] } },
    series: [{
      type: "heatmap",
      data: cells.map((c) => [months.indexOf(c.month), rows.indexOf(`F${c.floor} z${c.zone.slice(1)}`), c[measure]]),
      itemStyle: { borderColor: C.panel, borderWidth: 2, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: "#fff" } },
    }],
  }), [cells, months, rows, measure]);
  const onEvents = onPick ? { click: (p: { value: [number, number] }) => {
    const [f, z] = rows[p.value[1]].split(" ");
    onPick(+f.slice(1), z);
  } } : undefined;
  return <ReactECharts option={option} style={{ height: Math.max(90, rows.length * 17 + 50) }} onEvents={onEvents} notMerge />;
}

export function Histogram({ detail, kind, afterLabel }: { detail: ZoneDetail; kind: "pmv" | "rh"; afterLabel: string | null }) {
  const option = useMemo(() => {
    const bins = kind === "pmv" ? detail.pmv_bins : detail.rh_bins;
    const mids = bins.slice(0, -1).map((b, i) => +((b + bins[i + 1]) / 2).toFixed(2));
    const before = kind === "pmv" ? detail.pmv_before : detail.rh_before;
    const after = kind === "pmv" ? detail.pmv_after : detail.rh_after;
    const colorOf = (x: number) => kind === "rh" ? (x > 65 ? C.alert : "#7f93b0")
      : x < -0.5 ? C.cool : x > 0.5 ? C.warm : C.comfy;
    return {
      ...base,
      grid: { left: 34, right: 8, top: 22, bottom: 22 },
      tooltip: { ...tooltip, trigger: "axis" },
      legend: afterLabel ? { top: 0, right: 0, itemWidth: 10, itemHeight: 8, textStyle: { color: C.muted, fontSize: 11 } } : undefined,
      xAxis: { type: "category", data: mids, ...axis, splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, interval: kind === "pmv" ? 9 : 4, formatter: (v: string) => (kind === "pmv" ? (+v).toFixed(0) : v) } },
      yAxis: { type: "value", ...axis, axisLabel: { show: false } },
      series: [
        { name: "As Recorded", type: "bar", barGap: "-100%", barCategoryGap: "8%", data: before,
          itemStyle: afterLabel ? { color: "rgba(138,155,179,0.28)" } : { color: (p: { dataIndex: number }) => colorOf(mids[p.dataIndex]) } },
        ...(afterLabel ? [{ name: afterLabel, type: "bar", data: after,
          itemStyle: { color: (p: { dataIndex: number }) => colorOf(mids[p.dataIndex]), opacity: 0.9 } }] : []),
      ],
    };
  }, [detail, kind, afterLabel]);
  return <ReactECharts option={option} style={{ height: 150 }} notMerge />;
}

export function Sparkline({ values, cursor, color, height = 54 }: { values: (number | null)[]; cursor: number; color: string; height?: number }) {
  const option = useMemo(() => ({
    ...base, animation: false,
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: { type: "category", show: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: "dataMin" },
    series: [{ type: "line", data: values, symbol: "none", smooth: true, lineStyle: { color, width: 1.5 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}55` }, { offset: 1, color: `${color}00` }] } },
      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.ink, width: 1, type: "solid" }, data: [{ xAxis: cursor }] } }],
  }), [values, cursor, color]);
  return <ReactECharts option={option} style={{ height }} notMerge />;
}

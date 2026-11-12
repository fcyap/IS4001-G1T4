import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { EnergyAuditCircuit, EnergyAuditPeriod, HeatCell, LoadPattern, ZoneDetail } from "../lib/api";
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
const base = { aria: { enabled: true }, backgroundColor: "transparent", textStyle: { fontFamily: "Plus Jakarta Sans Variable, Segoe UI, sans-serif" }, animationDuration: 400 };

export function LoadChart({ data, after, height = 190 }: { data: LoadPattern; after?: (number | null)[] | null; height?: number }) {
  const option = useMemo(() => {
    const testIdx = data.weeks.findIndex((w) => w >= data.test_start);
    return {
      ...base,
      grid: { left: 44, right: 22, top: 26, bottom: 22 },
      legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: C.muted, fontSize: 11 },
        data: after ? ["Actual", "With Setpoint Change", "Baseline Model"] : ["Actual", "Baseline Model"] },
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
        ...(after ? [{ name: "With Setpoint Change", type: "line", data: after, symbol: "none", lineStyle: { width: 1.5, color: C.comfy } }] : []),
        { name: "Baseline Model", type: "line", data: data.baseline, symbol: "none", lineStyle: { width: 1.5, color: C.cool, type: [4, 3] } },
      ],
    };
  }, [data, after]);
  return <ReactECharts option={option} style={{ height }} notMerge />;
}

export function PreventableEnergyChart({ monthly, selectedMonth }: {
  monthly: Record<string, EnergyAuditPeriod>; selectedMonth: string | null;
}) {
  const months = Object.keys(monthly).sort();
  const option = useMemo(() => ({
    ...base,
    grid: { left: 42, right: 10, top: 12, bottom: 36 },
    tooltip: { ...tooltip, trigger: "axis", formatter: (items: { dataIndex: number }[]) => {
      const index = items[0]?.dataIndex ?? 0;
      const period = monthly[months[index]];
      if (!period || period.surplus_kwh === null) return `${monthLabel(months[index])}<br/><b>No circuit readings</b>`;
      return `${monthLabel(months[index])}<br/><b>${Math.round(period.surplus_kwh).toLocaleString()} kWh preventable</b><br/>฿${Math.round(period.cost_thb ?? 0).toLocaleString()} estimated cost (excl. VAT)<br/>Coverage ${period.energy_coverage_pct}%`;
    } },
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false },
      axisLabel: { ...axis.axisLabel, rotate: 45, fontSize: 10, formatter: (value: string) => monthLabel(value).replace(" 20", " ’") } },
    yAxis: { type: "value", ...axis, name: "kWh", nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
      axisLabel: { ...axis.axisLabel, fontSize: 10, formatter: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}` } },
    series: [{ type: "bar", barMaxWidth: 20,
      data: months.map((month) => ({ value: monthly[month]?.surplus_kwh ?? null,
        itemStyle: { color: month === selectedMonth ? "#f49a4b" : "#5fa8e8", borderRadius: [3, 3, 0, 0] } })),
    }],
  }), [monthly, months, selectedMonth]);
  return <ReactECharts option={option} style={{ height: 176 }} notMerge />;
}

export function AfterHoursLoadChart({ monthly, selectedMonth, baselineKw }: {
  monthly: Record<string, EnergyAuditPeriod>; selectedMonth: string | null; baselineKw: number;
}) {
  const months = Object.keys(monthly).sort();
  const option = useMemo(() => ({
    ...base,
    grid: { left: 44, right: 70, top: 26, bottom: 27 },
    legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: C.muted, fontSize: 10 },
      data: ["Mean load", "Baseload"] },
    tooltip: { ...tooltip, trigger: "axis", formatter: (items: { dataIndex: number }[]) => {
      const index = items[0]?.dataIndex ?? 0;
      const month = months[index];
      const period = monthly[month];
      if (!period || period.unocc_mean_kw === null) return `${monthLabel(month)}<br/><b>No circuit readings</b><br/>Circuit baseload ${baselineKw.toFixed(3)} kW`;
      const energyText = period.surplus_kwh === null ? "Preventable energy unavailable" : `${Math.round(period.surplus_kwh).toLocaleString()} kWh preventable`;
      return `${monthLabel(month)}<br/><b>${period.unocc_mean_kw.toFixed(3)} kW mean after-hours load</b><br/>Circuit baseload ${baselineKw.toFixed(3)} kW<br/>${energyText}<br/>Coverage ${period.load_coverage_pct}%`;
    } },
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false },
      axisLabel: { ...axis.axisLabel, interval: Math.max(1, Math.ceil(months.length / 9)), fontSize: 10,
        formatter: (value: string) => monthLabel(value).replace(" 20", " ’") } },
    yAxis: { type: "value", ...axis,
      axisLabel: { ...axis.axisLabel, fontSize: 10, formatter: (value: number) => value.toFixed(value < 1 ? 2 : 1) } },
    series: [
      { name: "Mean load", type: "bar", barMaxWidth: 20,
        data: months.map((month) => ({ value: monthly[month]?.unocc_mean_kw ?? null,
        itemStyle: { color: month === selectedMonth ? "#f49a4b" : "#5fa8e8", borderRadius: [3, 3, 0, 0] } })),
      },
      { name: "Baseload", type: "line", data: months.map((month) => monthly[month]?.unocc_mean_kw == null ? null : baselineKw),
        symbol: "none", connectNulls: false, lineStyle: { color: "#f3bf65", width: 2, type: "dashed" },
        endLabel: { show: true, formatter: `${baselineKw.toFixed(3)} kW`, color: "#f3bf65", fontSize: 10, distance: 3 } },
    ],
  }), [monthly, months, selectedMonth, baselineKw]);
  return <ReactECharts option={option} style={{ height: 196 }} notMerge />;
}

export function FloorEnergyChart({ data, periodLabel }: {
  data: { floor: number; energyKwh: number | null; costThb: number | null; coveragePct: number }[];
  periodLabel: string;
}) {
  const option = useMemo(() => ({
    ...base,
    grid: { left: 48, right: 12, top: 8, bottom: 28 },
    tooltip: { ...tooltip, trigger: "axis", formatter: (items: { dataIndex: number }[]) => {
      const item = data[items[0]?.dataIndex ?? 0];
      return item.energyKwh === null ? `Floor ${item.floor}<br/><b>No circuit readings</b>` : `Floor ${item.floor}<br/><b>${Math.round(item.energyKwh).toLocaleString()} kWh preventable</b><br/>฿${Math.round(item.costThb ?? 0).toLocaleString()} estimated cost (excl. VAT)<br/>Coverage ${item.coveragePct.toFixed(1)}%`;
    } },
    xAxis: { type: "category", data: data.map((item) => `Floor ${item.floor}`), ...axis,
      splitLine: { show: false }, axisLabel: { ...axis.axisLabel, fontSize: 10 } },
    yAxis: { type: "value", ...axis, name: "kWh", nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
      axisLabel: { ...axis.axisLabel, fontSize: 10, formatter: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}` } },
    series: [{ type: "bar", barMaxWidth: 32,
      data: data.map((item) => ({ value: item.energyKwh, itemStyle: { color: "#5fa8e8", borderRadius: [4, 4, 0, 0] } })) }],
  }), [data]);
  return <div className="floor-energy-chart" aria-label={`Preventable energy by floor, ${periodLabel}`}><ReactECharts option={option} style={{ height: 190 }} notMerge /></div>;
}

export function CircuitEnergyHeatmap({ circuits, selectedMonth }: {
  circuits: EnergyAuditCircuit[]; selectedMonth: string | null;
}) {
  const months = [...new Set(circuits.flatMap((circuit) => Object.keys(circuit.monthly)))].sort();
  const rows = [...circuits].sort((a, b) => a.circuit_id.localeCompare(b.circuit_id, undefined, { numeric: true }));
  const values = rows.flatMap((circuit, row) => months.map((month, col) => ({
    name: circuit.circuit_id,
    value: [col, row, circuit.monthly[month]?.surplus_kwh ?? -1],
    itemStyle: { borderColor: month === selectedMonth ? C.warm : "#172840", borderWidth: month === selectedMonth ? 2 : 1 },
  })));
  const max = Math.max(...values.map((item) => item.value[2] as number).filter((value) => value > 0), 1);
  const height = Math.min(720, Math.max(340, rows.length * 12 + 82));
  const option = useMemo(() => ({
    ...base,
    grid: { left: 132, right: 12, top: 10, bottom: 62 },
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { dataIndex: number }) => {
      const item = values[params.dataIndex];
      const col = item.value[0] as number;
      const raw = item.value[2] as number;
      return `${item.name}<br/>${monthLabel(months[col])}<br/><b>${raw < 0 ? "No meter readings" : `${raw.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh preventable`}</b>`;
    } },
    xAxis: { type: "category", data: months, ...axis, splitArea: { show: false },
      axisLabel: { ...axis.axisLabel, rotate: 45, fontSize: 10, formatter: (value: string) => monthLabel(value).replace(" 20", " ’"),
        color: (value: string) => value === selectedMonth ? C.warm : C.muted, fontWeight: 600 } },
    yAxis: { type: "category", data: rows.map((circuit) => circuit.circuit_id), inverse: true, ...axis,
      axisLabel: { ...axis.axisLabel, fontSize: 10, width: 124, overflow: "truncate" }, splitArea: { show: false } },
    visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 2,
      text: ["High", "0"], textStyle: { color: C.muted, fontSize: 10 }, inRange: { color: ["#53677e", "#8c6540", "#bd8245", "#f1b45e"] },
      outOfRange: { color: "rgba(0,0,0,0)" } },
    series: [{ type: "heatmap", data: values, progressive: 0,
      emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1 } } }],
  }), [months, rows, values, max, selectedMonth]);
  return <ReactECharts option={option} style={{ height }} notMerge />;
}

type HeatKey = "pct_too_cool" | "pct_comfortable" | "pct_humid";
const HEAT_RAMP: Record<HeatKey, string[]> = {
  pct_too_cool: MEASURES.too_cool.legend,
  pct_comfortable: MEASURES.comfortable.legend,
  pct_humid: ["#24324a", "#4b4f7a", "#9e6aa8", "#e3a0c8"],
};

export function HeatMap({ cells, months, measure, onPick }: {
  cells: Pick<HeatCell, "floor" | "zone" | "month" | HeatKey>[]; months: string[]; measure: HeatKey; onPick?: (floor: number, zone: string) => void;
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

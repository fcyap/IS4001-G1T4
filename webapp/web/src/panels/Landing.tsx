import { useData } from "../lib/data";
import { kwh, n0 } from "../lib/format";
import { useStore, type Topic } from "../lib/store";

function UseCase({ topic, eyebrow, title, value, unit, line, detail, action }: {
  topic: Topic; eyebrow: string; title: string; value: string; unit: string; line: string; detail: string; action: string;
}) {
  const navigate = useStore((s) => s.navigate);
  const open = () => navigate(topic, "overview");                 // every question starts on Today
  return (
    <button type="button" className={`usecase usecase-${topic}`} onClick={open}>
      <span className="usecase-eyebrow">{eyebrow}</span>
      <span className="usecase-title">{title}</span>
      <span className="usecase-value"><b>{value}</b> {unit}</span>
      <span className="usecase-line">{line}</span>
      <span className="usecase-detail">{detail}</span>
      <span className="usecase-action">Recommended: {action}</span>
      <span className="usecase-go" aria-hidden>Explore →</span>
    </button>
  );
}

/** Landing page: the building on its own, with one way into each question. */
export default function Landing() {
  const { meta } = useData();
  const audits = meta?.energy_audit ?? [];
  const wasteful = audits.filter((a) => a.preventable_count > 0).length;
  const wasteKwh = audits.reduce((n, a) => n + a.annual_surplus_kwh, 0);
  const wasteThb = audits.reduce((n, a) => n + a.annual_cost_thb, 0);
  const cells = meta?.heatmap ?? [];
  const periods = cells.reduce((n, c) => n + c.periods, 0);
  const tooCool = periods ? cells.reduce((n, c) => n + c.pct_too_cool * c.periods, 0) / periods : null;
  const recs = meta?.monthly ?? [];
  const acKwh = recs.reduce((n, r) => n + r.ac_kwh, 0);
  const acSaved = acKwh ? recs.reduce((n, r) => n + r.saved_kwh, 0) / acKwh * 100 : null;

  return (
    <div className="landing">
      <h1>Chamchuri 5</h1>
      <div className="usecases">
        <UseCase topic="afterhours" eyebrow="After-hours waste" title="Switch off what runs after hours"
          value={meta ? `${wasteful} of ${audits.length}` : "…"} unit="zones"
          line="carry preventable load outside office hours"
          detail={meta ? `${kwh(wasteKwh)} · ${n0(wasteThb)} THB a year (Jul 2018–Jun 2019)` : ""}
          action="BEMS curfew on preventable circuits" />
        <UseCase topic="comfort" eyebrow="Cooling comfort" title="Stop overcooling, save AC"
          value={tooCool === null ? "…" : `${n0(tooCool)} %`} unit="of office time"
          line="is too cool (PMV below −0.5)"
          detail={acSaved === null ? "" : `The setpoint rule saves about ${n0(acSaved)} % of AC energy`}
          action="raise setpoints in overcooled zones" />
      </div>
    </div>
  );
}

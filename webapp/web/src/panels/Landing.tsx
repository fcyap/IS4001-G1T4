import { useData } from "../lib/data";
import { kwh, n0 } from "../lib/format";
import { useStore, type Topic } from "../lib/store";

function UseCase({ topic, label, value, line, detail, action }: {
  topic: Topic; label: string; value: string; line: string; detail: string; action: string;
}) {
  const navigate = useStore((s) => s.navigate);
  const open = () => navigate(topic, "overview");                 // every question starts on Today
  return (
    <button type="button" className={`usecase usecase-${topic}`} onClick={open}>
      <span className="usecase-label">{label}<span className="usecase-go" aria-hidden>→</span></span>
      <span className="usecase-line"><b>{value}</b> {line}</span>
      {detail && <span className="usecase-detail">{detail}</span>}
      <span className="usecase-action">{action}</span>
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
      <header>
        <h1>Chamchuri 5</h1>
        <p className="landing-sub">Chulalongkorn University{meta ? ` · ${audits.length} zones` : ""}</p>
      </header>
      <div className="usecases">
        <UseCase topic="afterhours" label="After hours"
          value={meta ? `${wasteful} of ${audits.length}` : "…"}
          line="zones still draw load they don't need outside office hours."
          detail={meta ? `${kwh(wasteKwh)} and ${n0(wasteThb)} THB over Jul 2018–Jun 2019.` : ""}
          action="Next step: put those circuits on a BEMS curfew." />
        <UseCase topic="comfort" label="Cooling"
          value={tooCool === null ? "…" : `${n0(tooCool)} %`}
          line="of office hours are colder than comfortable (PMV below −0.5)."
          detail={acSaved === null ? "" : `Raising setpoints in those zones saves about ${n0(acSaved)} % of AC energy.`}
          action="Next step: nudge setpoints up where it's too cold." />
      </div>
    </div>
  );
}

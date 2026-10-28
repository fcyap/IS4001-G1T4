import { useEffect, useRef } from "react";
import Building3D from "./building/Building3D";
import { DataProvider } from "./lib/data";
import { useStore } from "./lib/store";
import Copilot from "./panels/Copilot";
import Landing from "./panels/Landing";
import SidePanel from "./panels/SidePanel";
import Stage from "./panels/Stage";
import TopBar from "./panels/TopBar";

export default function App() {
  const up = useStore((s) => s.up);
  const topic = useStore((s) => s.topic);
  const fading = useStore((s) => s.fading);
  const entering = useStore((s) => s.entering);
  const home = topic === "home";
  const topbar = useRef<HTMLDivElement>(null);
  useEffect(() => { if (topbar.current) topbar.current.inert = home; }, [home]);   // folded-away bar: not focusable
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) up();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up]);

  // The top bar stays mounted so it folds away smoothly on the landing page; the side panel and the
  // map controls are keyed by question so each question fades in fresh (transitions in theme.css).
  return (
    <DataProvider>
      <div className={`app ${home || entering ? "app--home" : ""} ${fading ? "is-fading" : ""}`}>
        <div className="topbar-wrap" ref={topbar}><div><TopBar /></div></div>
        <main className="split">
          <aside className="side" aria-label="Overview" aria-hidden={home}>
            {!home && <div className="side-enter" key={topic}><SidePanel /></div>}
          </aside>
          <section className="stage" aria-label="Building view">
            <Building3D />
            {home ? <Landing /> : <Stage key={topic} />}
          </section>
        </main>
        {topic === "afterhours" && <Copilot />}
      </div>
    </DataProvider>
  );
}

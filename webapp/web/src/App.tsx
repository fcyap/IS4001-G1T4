import { useEffect } from "react";
import Building3D from "./building/Building3D";
import { DataProvider } from "./lib/data";
import { useStore } from "./lib/store";
import SidePanel from "./panels/SidePanel";
import Stage from "./panels/Stage";
import TopBar from "./panels/TopBar";

export default function App() {
  const up = useStore((s) => s.up);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) up();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up]);

  return (
    <DataProvider>
      <div className="app">
        <TopBar />
        <main className="split">
          <aside className="side" aria-label="Overview"><SidePanel /></aside>
          <section className="stage" aria-label="Building view">
            <Building3D />
            <Stage />
          </section>
        </main>
      </div>
    </DataProvider>
  );
}

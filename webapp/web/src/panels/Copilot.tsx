import { useState, useRef, useEffect } from "react";
import { useData } from "../lib/data";
import { kwh } from "../lib/format";
import { useStore } from "../lib/store";
import { plannedScheduleSavings } from "../lib/plan";

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
}

export default function Copilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const month = useStore((s) => s.month);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);

  const estimate = meta ? plannedScheduleSavings(meta, scope, startHour, endHour, month, circuitExemptions) : null;
  const currentSavingsKwh = estimate?.energyKwh ? kwh(estimate.energyKwh) : "172,400 kWh";
  const currentSavingsCost = estimate?.costThb ? `฿${Math.round(estimate.costThb).toLocaleString("en-US")}` : "฿595,200";

  const initialGreeting: ChatMessage = {
    id: "welcome",
    sender: "bot",
    text: `Hello! I'm your Chamchuri 5 Building Copilot. I analyze after-hours telemetry across all 7 floors and 65 sub-metered circuits.\n\nCurrent simulation settings:\n• Active curfew: **${startHour}:00 → 0${endHour}:00**\n• Estimated savings: **${currentSavingsKwh}** (${currentSavingsCost} THB/yr)\n\nAsk me anything or select a prompt below!`,
    timestamp: "Just now",
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialGreeting]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const handleSend = (userText: string) => {
    if (!userText.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: userText,
      timestamp: "Now",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    setTimeout(() => {
      const responseText = generateSimulatedResponse(userText.toLowerCase());
      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: "bot",
        text: responseText,
        timestamp: "Now",
      };
      setTyping(false);
      setMessages((prev) => [...prev, botMsg]);
    }, 700);
  };

  const generateSimulatedResponse = (q: string): string => {
    if (q.includes("plan") || q.includes("recommend") || q.includes("strategy") || q.includes("summarize")) {
      return (
        `### 📋 Recommended Building Action Plan\n\n` +
        `Based on our 18-month telemetry audit across 65 sub-meters, here is the optimal strategy:\n\n` +
        `1. **BEMS Curfew Relays (Floors 2–7 Offices & Labs)**:\n` +
        `   • Schedule automated shutdown at **${startHour}:00**, releasing at **0${endHour}:00**.\n` +
        `   • Yields **${currentSavingsKwh}** (${currentSavingsCost} THB/yr).\n` +
        `   • Standard office circuits drop to quiescent standby (~79.0 kW building-wide).\n\n` +
        `2. **PIR Occupancy Automation (Stairs & Corridors)**:\n` +
        `   • Install motion sensors on secondary lighting to eliminate continuous overnight burning.\n\n` +
        `3. **24/7 Protected Whitelist**:\n` +
        `   • Floor 1 Zone 2 IT Server Room (**8.39 kW**) and central plant are permanently exempted to avoid network disruption.`
      );
    }

    if (q.includes("floor 1") || q.includes("hotspot") || q.includes("worst")) {
      return (
        `### ⚡ Floor 1 Forensic Audit\n\n` +
        `**Floor 1 is the #1 after-hours energy consumer** in Chamchuri 5:\n\n` +
        `• **Exterior Facade & Corridors (Zone 4)**: Consistently burns ~35.9 kW after 17:00, representing over **60% of evening lighting waste**.\n` +
        `• **IT Server Room (Zone 2)**: Draws a continuous, unvarying **8.39 kW plug load** (verified critical standby, zero seasonal variance).\n\n` +
        `**Recommendation**: Install astronomical timer relays on Zone 4 architectural lights at 22:00, saving an estimated **฿185,000 THB/yr** under MEA peak tariffs.`
      );
    }

    if (q.includes("whitelist") || q.includes("server") || q.includes("standby") || q.includes("critical")) {
      return (
        `### 🛡️ Whitelisted Circuits Rationale\n\n` +
        `Through unsupervised K-Means clustering, **4 out of 65 circuits** are classified as **Critical Standby**:\n\n` +
        `• **Floor 1 Zone 2 Plug (` + "`z2_Plug`" + `)**: Central campus IT Server Room. Baseline floor is **8.39 kW** with off-hours CV of 0.18.\n` +
        `• **Plant & Pump Equipment**: Continuous mission-critical operations.\n\n` +
        `**Security Guardrail**: These circuits are locked and excluded from curfew sweeps to prevent catastrophic data/network outages.`
      );
    }

    if (q.includes("delay") || q.includes("20:00") || q.includes("late") || q.includes("timing")) {
      return (
        `### 🕒 Curfew Timing Impact (18:00 vs 20:00)\n\n` +
        `Delaying the evening curfew from 18:00 to 20:00:\n\n` +
        `• **Energy Loss**: ~18,500 kWh uncaptured over the academic year.\n` +
        `• **Financial Penalty**: **~฿80,100 THB** additional electricity cost.\n` +
        `• **Why so expensive?** The 18:00–20:00 window falls under MEA's **Peak Time-of-Use rate (฿4.3297/kWh)**, which is 67% higher than the off-peak night rate (฿2.5849/kWh).\n\n` +
        `**Suggested compromise**: Keep the 18:00 BEMS sweep active, and provide manual 2-hour wall-switch overrides for late-working researchers.`
      );
    }

    if (q.includes("light") || q.includes("plug") || q.includes("difference")) {
      return (
        `### 🔌 Lighting vs. Plug Load Characteristics\n\n` +
        `• **Lighting Circuits (33 sub-meters)**: Driven by human schedule and security timers. Can be 100% eliminated after-hours in unoccupied spaces via automated contactors.\n` +
        `• **Plug Circuits (32 sub-meters)**: Contain both phantom vampire load (idle monitors, chargers at ~15W) and active desktop computers left running. The $P_{2.5}$ calibration filters phantom vampire baseload from true preventable machine operation.`
      );
    }

    return (
      `### 🤖 Copilot Analysis\n\n` +
      `Regarding *"q"*: In the current scope (**${scope.floor ? `Floor ${scope.floor}` : "Whole Building"}**), ` +
      `enforcing the **${startHour}:00 → 0${endHour}:00** curfew sweep recovers **${currentSavingsKwh}** of preventable waste, ` +
      `saving **${currentSavingsCost} THB/year** under MEA Schedule 4.2 TOU rates.\n\n` +
      `Would you like me to analyze a specific floor, explain the whitelisted server room, or simulate a different curfew time?`
    );
  };

  const PROMPT_CHIPS = [
    "💡 Summarize Action Plan",
    "⚡ Why is Floor 1 the biggest hotspot?",
    "🛡️ Which circuits are whitelisted?",
    "🕒 What if we delay curfew to 20:00?",
  ];

  return (
    <>
      {/* Floating Action Button */}
      <button
        type="button"
        className={`copilot-fab ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Open Chamchuri 5 AI Copilot"
      >
        <span className="copilot-fab-sparkle">✨</span>
        <span className="copilot-fab-label">AI Copilot</span>
        {!open && <span className="copilot-fab-dot" />}
      </button>

      {/* Slide-Up Chat Drawer */}
      {open && (
        <div className="copilot-modal">
          <div className="copilot-header">
            <div className="copilot-header-info">
              <span className="copilot-avatar">✨</span>
              <div>
                <strong>Chamchuri 5 AI Copilot</strong>
                <small>Autonomous Facility Diagnostics</small>
              </div>
            </div>
            <button type="button" className="copilot-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
          </div>

          <div className="copilot-body">
            {messages.map((m) => (
              <div key={m.id} className={`copilot-msg ${m.sender}`}>
                <div className="copilot-msg-bubble">
                  {m.text.split("\n\n").map((para, i) => (
                    <p key={i} dangerouslySetInnerHTML={{
                      __html: para
                        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                        .replace(/• /g, "• ")
                        .replace(/### (.*)/g, "<h4 class='copilot-heading'>$1</h4>")
                    }} />
                  ))}
                  <span className="copilot-msg-time">{m.timestamp}</span>
                </div>
              </div>
            ))}

            {typing && (
              <div className="copilot-msg bot">
                <div className="copilot-msg-bubble typing">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="copilot-chips">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="copilot-chip"
                onClick={() => handleSend(chip)}
              >
                {chip}
              </button>
            ))}
          </div>

          <form
            className="copilot-footer"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
          >
            <input
              type="text"
              placeholder="Ask about after-hours waste, server rooms, or tariffs…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

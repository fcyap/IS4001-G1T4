import { useState, useRef, useEffect } from "react";
import { api, getStoredGeminiKey, setStoredGeminiKey } from "../lib/api";
import { useData } from "../lib/data";
import { kwh } from "../lib/format";
import { monthLabel, scopeLabel, useStore } from "../lib/store";
import { buildEffectiveCircuitWindows, plannedScheduleSavings } from "../lib/plan";

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
  source?: "gemini" | "telemetry_engine";
}

function formatSafeMarkdown(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.*)$/gm, "<h4 class='copilot-heading'>$1</h4>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
}

export default function Copilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showKeyBar, setShowKeyBar] = useState(false);
  const [keyDraft, setKeyDraft] = useState(() => getStoredGeminiKey());
  const [storedKey, setStoredKey] = useState(() => getStoredGeminiKey());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { meta } = useData();
  const scope = useStore((s) => s.scope);
  const startHour = useStore((s) => s.auditStartHour);
  const endHour = useStore((s) => s.auditEndHour);
  const month = useStore((s) => s.month);
  const floorWindows = useStore((s) => s.auditFloorWindows);
  const zoneWindows = useStore((s) => s.auditZoneWindows);
  const circuitExemptions = useStore((s) => s.auditCircuitExemptions);
  const circuitWindows = useStore((s) => s.auditCircuitWindows);

  useEffect(() => {
    const onKeyChange = () => {
      const k = getStoredGeminiKey();
      setStoredKey(k);
      setKeyDraft(k);
    };
    window.addEventListener("gemini-key-change", onKeyChange);
    return () => window.removeEventListener("gemini-key-change", onKeyChange);
  }, []);

  const estimate = meta
    ? plannedScheduleSavings(
        meta,
        scope,
        startHour,
        endHour,
        month,
        circuitExemptions,
        circuitWindows,
        floorWindows,
        zoneWindows
      )
    : null;
  const endFmt = String(endHour).padStart(2, "0");
  const currentSavingsKwh = estimate ? kwh(estimate.energyKwh) : "…";
  const currentSavingsCost = estimate
    ? `฿${Math.round(estimate.costThb).toLocaleString("en-US")}`
    : "…";
  const activeScopeName = scopeLabel(scope);
  const activePeriodName = month ? monthLabel(month) : "Annual (Jul 2018–Jun 2019)";
  const hasGemini = !!meta?.ai_configured || !!storedKey;
  const manualOverrideCount =
    Object.keys(floorWindows).length +
    Object.keys(zoneWindows).length +
    Object.keys(circuitExemptions).filter((id) => circuitExemptions[id]).length +
    Object.keys(circuitWindows).length;

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, open]);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredGeminiKey(keyDraft);
    setStoredKey(keyDraft.trim());
    setShowKeyBar(false);
  };

  const handleSend = async (userText: string) => {
    const clean = userText.trim();
    if (!clean || typing) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: clean,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.sender,
      text: m.text,
    }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    try {
      const exemptions = Object.keys(circuitExemptions).filter((id) => circuitExemptions[id]);
      const effectiveCircuitWindows = buildEffectiveCircuitWindows(
        meta,
        startHour,
        endHour,
        floorWindows,
        zoneWindows,
        circuitWindows
      );
      const res = await api.aiChat({
        message: clean,
        history: historyPayload,
        floor: scope.floor,
        zone: scope.zone,
        month,
        start_hour: startHour,
        end_hour: endHour,
        exemptions,
        circuit_windows: effectiveCircuitWindows,
        api_key: storedKey || null,
      });

      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: "bot",
        text: res.reply,
        source: res.source,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: "bot",
        text: `### 🤖 Telemetry Summary (${activeScopeName})\n\nEnforcing the **${startHour}:00 → ${endFmt}:00** curfew across **${activeScopeName}** (${activePeriodName}) recovers **${currentSavingsKwh}** and saves **${currentSavingsCost}** (excl. VAT).`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setTyping(false);
    }
  };

  const PROMPT_CHIPS = [
    "🎛️ What did my manual adjustments change?",
    "⚡ Why is Floor 1 Zone 1 the biggest hotspot?",
    "🔒 Which 4 circuits are locked ON 24/7?",
    "💡 Summarize the active curfew savings",
  ];

  return (
    <>
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

      {open && (
        <div className="copilot-modal">
          <div className="copilot-header">
            <div className="copilot-header-info">
              <span className="copilot-avatar">✨</span>
              <div>
                <strong>Chamchuri 5 AI Copilot</strong>
                <small>
                  {hasGemini ? "Gemini 2.5 Flash · Live Dashboard & Telemetry" : "Telemetry Diagnostics · Click 🔑 for Gemini AI"}
                </small>
              </div>
            </div>
            <div className="copilot-header-actions">
              <button
                type="button"
                className={`copilot-key-toggle ${hasGemini ? "active" : ""}`}
                onClick={() => setShowKeyBar((v) => !v)}
                title={hasGemini ? "Gemini API key active" : "Set Gemini API key"}
              >
                🔑
              </button>
              <button type="button" className="copilot-close" onClick={() => setOpen(false)} aria-label="Close chat">
                ✕
              </button>
            </div>
          </div>

          {showKeyBar && (
            <form className="copilot-key-bar" onSubmit={handleSaveKey}>
              <input
                type="password"
                placeholder={meta?.ai_configured ? "Server .env key active (optional override)…" : "Paste Gemini API Key (AIzaSy…)"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button type="submit">Save</button>
            </form>
          )}

          <div className="copilot-body">
            {/* Always-live welcome & context card */}
            <div className="copilot-msg bot">
              <div className="copilot-msg-bubble">
                <p>
                  Ask me anything about the after-hours energy audit across all 7 floors and 65 circuits in{" "}
                  <strong>Chamchuri 5</strong>, or about any manual adjustments you make on the dashboard.
                </p>
                <p>
                  <strong>Active Dashboard State:</strong>
                  <br />• Scope: <strong>{activeScopeName}</strong> ({activePeriodName})
                  <br />• Building Default: <strong>{startHour}:00 → {endFmt}:00</strong>
                  {manualOverrideCount > 0 && (
                    <>
                      <br />• Manual Overrides (Floor/Zone/Circuit): <strong>{manualOverrideCount} active</strong>
                    </>
                  )}
                  <br />• Simulated Savings: <strong>{currentSavingsKwh}</strong> (<strong>{currentSavingsCost}</strong> excl. VAT)
                </p>
                <span className="copilot-msg-time">Live Context</span>
              </div>
            </div>

            {messages.map((m) => (
              <div key={m.id} className={`copilot-msg ${m.sender}`}>
                <div className="copilot-msg-bubble">
                  {m.text.split("\n\n").map((para, i) => (
                    <p
                      key={i}
                      dangerouslySetInnerHTML={{
                        __html: formatSafeMarkdown(para),
                      }}
                    />
                  ))}
                  <span className="copilot-msg-time">
                    {m.timestamp}
                    {m.sender === "bot" && m.source === "gemini" ? " · Gemini AI" : ""}
                  </span>
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
                disabled={typing}
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
              placeholder="Ask about any floor, circuit, or manual schedule change…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" disabled={!input.trim() || typing}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

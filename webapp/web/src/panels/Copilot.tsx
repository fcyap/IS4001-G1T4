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
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, typing, open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  const close = () => { setOpen(false); fabRef.current?.focus(); };

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
        text: `### Telemetry summary (${activeScopeName})\n\nEnforcing the **${startHour}:00 → ${endFmt}:00** curfew across **${activeScopeName}** (${activePeriodName}) recovers **${currentSavingsKwh}** and saves **${currentSavingsCost}** (excl. VAT).`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setTyping(false);
    }
  };

  const PROMPT_CHIPS = [
    "What did my manual adjustments change?",
    "Why is Floor 1 Zone 1 the biggest hotspot?",
    "Which circuits stay on 24/7?",
    "Summarise the active curfew savings",
  ];

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`copilot-fab ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="copilot-panel"
        aria-label="Ask the copilot about this data"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9l-4 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5Z"
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="copilot-fab-label">Copilot</span>
      </button>

      {open && (
        <div id="copilot-panel" className="copilot-modal" role="dialog" aria-labelledby="copilot-title"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
          <div className="copilot-header">
            <div className="copilot-header-info">
              <strong id="copilot-title">Copilot</strong>
              <small>
                {hasGemini ? "Gemini 2.5 Flash" : "Offline summaries. Add a Gemini key for full answers."}
              </small>
            </div>
            <div className="copilot-header-actions">
              <button
                type="button"
                className={`copilot-key-toggle ${hasGemini ? "active" : ""}`}
                onClick={() => setShowKeyBar((v) => !v)}
                aria-expanded={showKeyBar}
              >
                {hasGemini ? "Key set" : "Add key"}
              </button>
              <button type="button" className="copilot-close" onClick={close} aria-label="Close copilot">
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                  <path d="M2.5 2.5l7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {showKeyBar && (
            <form className="copilot-key-bar" onSubmit={handleSaveKey}>
              <input
                type="password"
                aria-label="Gemini API key"
                autoComplete="off"
                placeholder={meta?.ai_configured ? "Server .env key active (optional override)…" : "Paste Gemini API Key (AIzaSy…)"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button type="submit">Save</button>
            </form>
          )}

          <div className="copilot-body" role="log" aria-live="polite" aria-busy={typing}>
            {/* Always-live welcome & context card */}
            <div className="copilot-msg bot">
              <div className="copilot-msg-bubble">
                <p>Ask about the after-hours audit or your changes.</p>
                <dl className="copilot-context">
                  <dt>Scope</dt><dd>{activeScopeName}, {activePeriodName}</dd>
                  <dt>Default curfew</dt><dd>{startHour}:00–{endFmt}:00</dd>
                  {manualOverrideCount > 0 && <><dt>Overrides</dt><dd>{manualOverrideCount} floor, zone or circuit settings</dd></>}
                  <dt>Simulated savings</dt><dd>{currentSavingsKwh}, {currentSavingsCost} excl. VAT</dd>
                </dl>
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
                <div className="copilot-msg-bubble typing" aria-label="Copilot is typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
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
              ref={inputRef}
              type="text"
              aria-label="Question for the copilot"
              placeholder="Ask about a floor, circuit or schedule change…"
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

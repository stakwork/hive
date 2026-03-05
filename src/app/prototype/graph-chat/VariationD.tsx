"use client";

/**
 * Variation D — Minimal Pill + Popover Thread
 *
 * Default state: just a single slim input pill floating at the bottom.
 * Zero visual weight — graph is almost completely unobstructed.
 *
 * When messages exist OR the user focuses the input:
 *   • A popover "thread panel" slides up from the pill (above it).
 *   • The panel has a fixed max height with internal scroll.
 *   • The popover has a subtle arrow pointing down to the input.
 *   • Action buttons (sources, feature, share, clear) are
 *     a compact icon tray in the TOP-RIGHT corner of the popover.
 *   • Follow-up chips appear at the bottom of the popover, above the pill.
 *
 * Provenance appears as a toggle-able second column inside the popover.
 *
 * The pill itself only contains: [img] [textarea+send].
 */

import { useState, useRef } from "react";
import {
  Send,
  X,
  Lightbulb,
  Eye,
  Share2,
  Image as ImageIcon,
  Zap,
} from "lucide-react";
import { DashboardShell } from "./DashboardShell";
import { MOCK_MESSAGES, MOCK_FOLLOW_UPS } from "./mockData";

export default function VariationD() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [input, setInput] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(true);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [
      ...m,
      { id: Date.now().toString(), role: "user", content: input.trim(), timestamp: new Date() },
    ]);
    setInput("");
    setPopoverOpen(true);
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-1.5">

        {/* ── POPOVER thread — slides up from pill ── */}
        {hasMessages && popoverOpen && (
          <div className="flex gap-3">
            {/* Main thread panel */}
            <div className="flex-1 rounded-2xl border border-border/40 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden">

              {/* Popover header: message count + action tray */}
              <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-border/25">
                <span className="text-xs text-muted-foreground flex-1">
                  {messages.length} messages
                </span>

                {/* Compact icon tray */}
                <button
                  onClick={() => setProvenanceOpen((o) => !o)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    provenanceOpen
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  title="Sources"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Create feature"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Share"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-3.5 bg-border/40 mx-0.5" />
                <button
                  onClick={() => setMessages([])}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Clear all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPopoverOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Collapse"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M4 10l4 4 4-4M4 6L8 2l4 4" />
                  </svg>
                </button>
              </div>

              {/* Messages */}
              <div className="max-h-48 overflow-y-auto px-3 py-3 space-y-2.5">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary/90 text-primary-foreground"
                          : "bg-muted/30 text-foreground/90 border border-border/20"
                      }`}
                      dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                          .replace(/`(.*?)`/g, "<code class='bg-background/30 px-1 rounded text-xs font-mono'>$1</code>"),
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Follow-up chips */}
              <div className="px-3 pb-3 flex flex-wrap gap-1.5 justify-end">
                {MOCK_FOLLOW_UPS.map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); setPopoverOpen(true); }}
                    className="rounded-full border border-border/40 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Provenance side panel */}
            {provenanceOpen && (
              <div className="w-56 shrink-0 rounded-2xl border border-border/40 bg-card/75 backdrop-blur-xl shadow-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/25">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground flex-1">Sources</span>
                  <button onClick={() => setProvenanceOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  {[
                    { file: "src/services/auth/token.ts", lines: "42–78", type: "Function" },
                    { file: "src/services/auth/session.ts", lines: "12–34", type: "Datamodel" },
                    { file: "src/services/email/mailer.ts", lines: "1–20", type: "Service" },
                    { file: "src/lib/audit-logger.ts", lines: "88–102", type: "Function" },
                  ].map((s) => (
                    <div key={s.file} className="flex gap-2 items-start rounded-lg border border-border/30 bg-muted/20 p-2 cursor-pointer hover:bg-muted/40 transition-colors">
                      <Zap className="w-2.5 h-2.5 mt-0.5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] text-foreground truncate">{s.file.split("/").pop()}</p>
                        <p className="text-[10px] text-muted-foreground">{s.type}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* "Show chat" button when popover is closed but messages exist */}
        {hasMessages && !popoverOpen && (
          <div className="flex justify-center">
            <button
              onClick={() => setPopoverOpen(true)}
              className="px-3 py-1 rounded-full text-xs border border-border/40 bg-muted/30 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              {messages.length} messages · tap to expand
            </button>
          </div>
        )}

        {/* ── INPUT PILL — always visible ── */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2"
        >
          <button
            type="button"
            className="shrink-0 h-10 w-10 rounded-full border-2 border-border/20 hover:border-primary/40 bg-background/5 backdrop-blur-sm flex items-center justify-center transition-colors"
          >
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="relative flex-1 min-w-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => { if (hasMessages) setPopoverOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask me about your codebase..."
              rows={1}
              className="w-full px-4 py-3 pr-12 rounded-2xl bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all backdrop-blur-sm"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="absolute right-1.5 bottom-2.5 h-8 w-8 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 transition-opacity"
            >
              <Send className="w-4 h-4 text-primary-foreground" />
            </button>
          </div>
        </form>
      </div>
    </DashboardShell>
  );
}

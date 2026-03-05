"use client";

/**
 * Final direction — "Split Zones" (based on Variation C feedback)
 *
 * Stack from bottom to top:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  [img]  [ textarea .................. [▶] ] │  ← input bar (always visible)
 *   ├─────────────────────────────────────────────┤
 *   │  [◎ Sources] [💡 Create Feature] [↗ Share] [✕ Clear]  │  ← action pills row (only when messages)
 *   ├───────────────────────────────┬─────────────┤
 *   │  messages (scroll, fade top)  │  provenance │  ← thread + optional sources sidebar
 *   │                               │  sidebar    │
 *   │  follow-up questions          │  (ref style)│
 *   │  stacked right-aligned        │             │
 *   └───────────────────────────────┴─────────────┘
 *
 * Key decisions:
 * • Follow-up questions: stacked vertically, right-aligned (matching original reference)
 * • Action pills: labelled pill row between the thread and the input (Variation C style)
 * • Sources: slides in as a sidebar BESIDE the messages (matching original Variation A / reference)
 * • Messages float over the graph with no card border — top fades into graph via mask
 * • Input bar: original production style (glass bg, send btn inside textarea)
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

const PROVENANCE_SOURCES = [
  { file: "src/services/auth/token.ts", lines: "42–78", type: "Function" },
  { file: "src/services/auth/session.ts", lines: "12–34", type: "Datamodel" },
  { file: "src/services/email/mailer.ts", lines: "1–20", type: "Service" },
  { file: "src/lib/audit-logger.ts", lines: "88–102", type: "Function" },
];

export default function FinalVariation() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [input, setInput] = useState("");
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [
      ...m,
      {
        id: Date.now().toString(),
        role: "user" as const,
        content: input.trim(),
        timestamp: new Date(),
      },
    ]);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <DashboardShell>
      {/* pointer-events-none wrapper matches production — children opt back in */}
      <div className="pointer-events-none flex flex-col justify-end max-h-[85vh]">

        {/* ══════════════════════════════════════════
            ZONE 1 — Message thread + provenance sidebar
            Only rendered when there are messages
        ══════════════════════════════════════════ */}
        {hasMessages && (
          <div className="flex gap-4 min-h-0">

            {/* Message column */}
            <div className="flex-1 min-w-0 flex flex-col">

              {/* Scrollable message area — top fades into graph */}
              <div
                className="overflow-y-auto px-2 space-y-2 pointer-events-auto"
                style={{
                  maxHeight: "46vh",
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, black 14%, black 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, black 14%, black 100%)",
                }}
              >
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex justify-center w-full"
                  >
                    <div
                      className={`max-w-[600px] ${msg.role === "user" ? "" : "w-full"}`}
                    >
                      <div
                        className={`rounded-2xl px-4 py-3 shadow-sm backdrop-blur-sm text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-white/90 dark:bg-white/10 text-gray-900 dark:text-white inline-block"
                            : "bg-muted/10 text-foreground/90"
                        }`}
                        dangerouslySetInnerHTML={{
                          __html: msg.content
                            .replace(
                              /\*\*(.*?)\*\*/g,
                              "<strong>$1</strong>"
                            )
                            .replace(
                              /`(.*?)`/g,
                              "<code class='bg-background/30 px-1 rounded text-xs font-mono'>$1</code>"
                            ),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Follow-up questions — stacked vertically, right-aligned */}
              <div className="pointer-events-auto pt-2 pb-1 px-2">
                <div className="flex flex-col items-end gap-1.5">
                  {MOCK_FOLLOW_UPS.map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="rounded-full border border-border/50 bg-muted/30 backdrop-blur-sm px-3 py-1.5 text-xs text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Provenance sidebar — slides in beside messages (reference style) */}
            {provenanceOpen && (
              <div className="w-72 shrink-0 overflow-y-auto max-h-[60vh] pointer-events-auto">
                <div className="backdrop-blur-md bg-background/20 border border-border/50 rounded-lg p-4 shadow-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Sources
                    </p>
                    <button
                      onClick={() => setProvenanceOpen(false)}
                      className="p-0.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {PROVENANCE_SOURCES.map((s) => (
                    <div
                      key={s.file}
                      className="flex gap-2 items-start rounded-lg border border-border/30 bg-muted/20 p-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <Zap className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-foreground truncate">
                          {s.file}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Lines {s.lines} · {s.type}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            ZONE 2 — Action pills row
            Sits between the thread and the input bar
            Only visible when there are messages
        ══════════════════════════════════════════ */}
        {hasMessages && (
          <div className="pointer-events-auto flex items-center justify-end gap-1.5 px-1 pt-2 pb-1.5">
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all">
              <Lightbulb className="w-3 h-3" />
              Create Feature
            </button>

            <button
              onClick={() => setProvenanceOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                provenanceOpen
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/50 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border"
              }`}
            >
              <Eye className="w-3 h-3" />
              Sources
            </button>

            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all">
              <Share2 className="w-3 h-3" />
              Share
            </button>

            <button
              onClick={() => {
                setMessages([]);
                setProvenanceOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border transition-all"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════
            ZONE 3 — Input bar (always visible)
            Matches original production style exactly
        ══════════════════════════════════════════ */}
        <div className="pointer-events-auto shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 px-1"
          >
            {/* Image upload */}
            <button
              type="button"
              className="relative h-10 w-10 rounded-full border-2 border-border/20 hover:border-primary/50 bg-background/5 flex items-center justify-center shrink-0 transition-colors"
            >
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Textarea + send */}
            <div className="relative flex-1 min-w-0 leading-none">
              <textarea
                ref={inputRef}
                placeholder="Ask me about your codebase..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                className="w-full px-4 py-3 pr-12 rounded-2xl bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute right-1.5 bottom-2.5 h-8 w-8 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 transition-opacity hover:opacity-90"
              >
                <Send className="w-4 h-4 text-primary-foreground" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardShell>
  );
}

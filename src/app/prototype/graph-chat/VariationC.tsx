"use client";

/**
 * Variation C — Split Input / Thread
 *
 * Two distinct zones, visually separated:
 *
 * ZONE 1 – Message thread (rises above input)
 *   • Slim fixed-height scrollable ribbon, max ~40vh
 *   • Top edge fades into the graph with a gradient mask
 *   • No border/card — messages float directly over the graph
 *   • Follow-up chips appear right-aligned at the bottom of the thread
 *
 * ZONE 2 – Input bar (pinned to the bottom)
 *   • Single frosted pill: [img] [textarea+send]
 *   • Secondary actions (create feature, sources, share, clear) are
 *     small icon buttons arranged in a row ABOVE the input pill,
 *     right-aligned — only visible when there are messages.
 *
 * This keeps the input stable and the graph mostly unobstructed.
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

export default function VariationC() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [input, setInput] = useState("");
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
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-0">

        {/* ── ZONE 1: Message thread ── */}
        {hasMessages && (
          <div className="relative flex flex-col">
            {/* Top gradient mask — blends into graph */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-transparent to-transparent z-10" />

            {/* Scrollable message area */}
            <div
              className="overflow-y-auto px-2 space-y-2"
              style={{
                maxHeight: "42vh",
                maskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 12%, black 100%)",
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm backdrop-blur-sm ${
                      msg.role === "user"
                        ? "bg-white/90 dark:bg-white/10 text-gray-900 dark:text-white"
                        : "bg-muted/20 text-foreground/90"
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
            <div className="flex flex-wrap gap-1.5 justify-end py-2 px-2">
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
        )}

        {/* ── Provenance panel (slides between thread and input) ── */}
        {hasMessages && provenanceOpen && (
          <div className="mb-2 rounded-xl border border-border/40 bg-card/75 backdrop-blur-md px-3 py-3 grid grid-cols-3 gap-2">
            {[
              { file: "src/services/auth/token.ts", lines: "42–78", type: "Function" },
              { file: "src/services/auth/session.ts", lines: "12–34", type: "Datamodel" },
              { file: "src/services/email/mailer.ts", lines: "1–20", type: "Service" },
            ].map((s) => (
              <div key={s.file} className="flex gap-2 items-start rounded-lg border border-border/30 bg-muted/20 p-2 cursor-pointer hover:bg-muted/40 transition-colors">
                <Zap className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-foreground truncate">{s.file}</p>
                  <p className="text-[10px] text-muted-foreground">{s.type} · {s.lines}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── ZONE 2: Secondary actions row (only with messages) ── */}
        {hasMessages && (
          <div className="flex items-center justify-end gap-1 px-1 pb-1.5">
            <button
              onClick={() => setProvenanceOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all border ${
                provenanceOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/40 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Eye className="w-3 h-3" />
              Sources
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/40 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all">
              <Lightbulb className="w-3 h-3" />
              Create feature
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/40 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all">
              <Share2 className="w-3 h-3" />
              Share
            </button>
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border/40 bg-muted/20 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
        )}

        {/* ── ZONE 2: Input pill ── */}
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

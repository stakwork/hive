"use client";

/**
 * Variation B — Frosted Card
 *
 * The entire chat (messages + input) lives inside one contained frosted-glass card.
 * • When empty: just the input bar — slim and unobtrusive.
 * • When messages exist: card grows upward, messages scroll inside a fixed-height region.
 * • Action buttons (create feature, provenance, share) sit INSIDE the card header
 *   so the input row stays clean — just textarea + send.
 * • Provenance pops out as a panel below the card header (toggleable).
 * • Card has a subtle gradient top edge to show scroll continuation.
 */

import { useState, useRef } from "react";
import {
  Send,
  X,
  Lightbulb,
  Eye,
  Share2,
  Image as ImageIcon,
  ChevronDown,
  Zap,
} from "lucide-react";
import { DashboardShell } from "./DashboardShell";
import { MOCK_MESSAGES, MOCK_FOLLOW_UPS } from "./mockData";

export default function VariationB() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [input, setInput] = useState("");
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [
      ...m,
      { id: Date.now().toString(), role: "user", content: input.trim(), timestamp: new Date() },
    ]);
    setInput("");
    setCollapsed(false);
  };

  return (
    <DashboardShell>
      <div className="flex flex-col">
        {/* The card */}
        <div className="rounded-2xl border border-border/40 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden">

          {/* ── Card header (only shown with messages) ── */}
          {hasMessages && (
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-background/10">
              <span className="text-xs font-medium text-muted-foreground flex-1">
                Graph Chat · {messages.length} messages
              </span>

              {/* Action buttons moved to header */}
              <button
                onClick={() => setProvenanceOpen((o) => !o)}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
                  provenanceOpen
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                title="Sources"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="text-[11px]">Sources</span>
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
              <div className="w-px h-4 bg-border/40 mx-1" />
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={collapsed ? "Expand" : "Collapse"}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Provenance panel ── */}
          {hasMessages && provenanceOpen && !collapsed && (
            <div className="border-b border-border/30 bg-background/5 px-4 py-3 grid grid-cols-3 gap-2">
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

          {/* ── Message thread (hidden when collapsed) ── */}
          {hasMessages && !collapsed && (
            <div className="relative">
              {/* Gradient top edge to hint scroll */}
              <div className="pointer-events-none absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-card/80 to-transparent z-10" />
              <div className="max-h-52 overflow-y-auto px-4 py-4 space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary/90 text-primary-foreground"
                          : "bg-muted/40 text-foreground border border-border/20"
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

              {/* Follow-up chips inside the card */}
              <div className="px-4 pb-3 flex flex-wrap gap-1.5 justify-end">
                {MOCK_FOLLOW_UPS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-2.5 py-1 rounded-full border border-border/40 bg-muted/20 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-border transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Input row — always visible, clean ── */}
          <div className={`px-3 py-3 ${hasMessages ? "border-t border-border/30 bg-background/10" : ""}`}>
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex items-end gap-2"
            >
              <button
                type="button"
                className="shrink-0 h-9 w-9 rounded-full border border-border/20 hover:border-primary/40 bg-background/5 flex items-center justify-center transition-colors"
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
                  className="w-full px-4 py-2.5 pr-11 rounded-xl bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="absolute right-1.5 bottom-1.5 h-7 w-7 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 transition-opacity"
                >
                  <Send className="w-3.5 h-3.5 text-primary-foreground" />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

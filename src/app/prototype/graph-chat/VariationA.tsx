"use client";

/**
 * Variation A — Current (reference)
 * Faithfully reproduces the existing DashboardChat layout so users have
 * a baseline to compare against.
 *
 * - Messages stack as individual floating bubbles (centered, pointer-events-none wrapper)
 * - Clear (×) button top-right of the thread
 * - Follow-up chips right-aligned below last assistant message
 * - Provenance sidebar slides in to the right when toggled
 * - Input row: [img upload] [textarea + send btn] [create feature] [provenance] [share]
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

export default function VariationA() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [input, setInput] = useState("");
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      {/* Exact production wrapper */}
      <div className="pointer-events-none flex flex-col justify-end max-h-[85vh]">

        {messages.length > 0 && (
          <div className="flex flex-col min-h-0">
            {/* Clear button */}
            <div className="flex justify-end px-2 pb-0.5">
              <button
                onClick={() => setMessages([])}
                className="pointer-events-auto p-1.5 rounded-full bg-muted/50 hover:bg-muted opacity-70 hover:opacity-100 transition-opacity"
              >
                <X className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>

            <div className="flex gap-4 flex-1 min-h-0">
              {/* Message thread */}
              <div className="flex-1 max-h-[60vh] overflow-y-auto pb-2">
                <div className="space-y-2 px-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className="flex justify-center w-full">
                      <div
                        className={`pointer-events-auto max-w-[600px] ${msg.role === "user" ? "" : "w-full"}`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm backdrop-blur-sm text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-white/90 dark:bg-white/10 text-gray-900 dark:text-white inline-block"
                              : "bg-muted/10 text-foreground/90"
                          }`}
                          dangerouslySetInnerHTML={{
                            __html: msg.content
                              .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                              .replace(/`(.*?)`/g, "<code class='bg-background/30 px-1 rounded text-xs font-mono'>$1</code>"),
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Follow-up chips */}
                  <div className="pointer-events-auto pt-2">
                    <div className="flex flex-col items-end gap-1.5">
                      {MOCK_FOLLOW_UPS.map((q) => (
                        <button
                          key={q}
                          onClick={() => setInput(q)}
                          className="rounded-full border border-border/50 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground transition-all"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Provenance sidebar */}
              {provenanceOpen && (
                <div className="w-72 overflow-y-auto max-h-[60vh] pointer-events-auto shrink-0">
                  <div className="backdrop-blur-md bg-background/20 border border-border/50 rounded-lg p-4 shadow-lg space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sources</p>
                    {[
                      { file: "src/services/auth/token.ts", lines: "42–78", type: "Function" },
                      { file: "src/services/auth/session.ts", lines: "12–34", type: "Datamodel" },
                      { file: "src/services/email/mailer.ts", lines: "1–20", type: "Service" },
                    ].map((s) => (
                      <div key={s.file} className="flex gap-2 items-start rounded-lg border border-border/30 bg-muted/20 p-2.5">
                        <Zap className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] text-foreground truncate">{s.file}</p>
                          <p className="text-[10px] text-muted-foreground">Lines {s.lines} · {s.type}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input row — exact production layout */}
        <div className="pointer-events-auto shrink-0 mt-1">
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex items-end gap-2 px-1"
          >
            {/* Image upload button */}
            <button
              type="button"
              className="relative h-10 w-10 rounded-full border-2 border-border/20 hover:border-primary/50 bg-background/5 flex items-center justify-center shrink-0"
            >
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Textarea */}
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask me about your codebase..."
                rows={1}
                className="w-full px-4 py-3 pr-12 rounded-2xl bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute right-1.5 bottom-2.5 h-8 w-8 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 transition-opacity"
              >
                <Send className="w-4 h-4 text-primary-foreground" />
              </button>
            </div>

            {/* Create feature */}
            {messages.length > 0 && (
              <button
                type="button"
                className="shrink-0 rounded-full h-10 w-10 border border-border bg-background flex items-center justify-center hover:bg-accent transition-colors"
                title="Create Feature"
              >
                <Lightbulb className="w-4 h-4" />
              </button>
            )}

            {/* Provenance toggle */}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setProvenanceOpen((o) => !o)}
                className={`shrink-0 rounded-full h-10 w-10 border flex items-center justify-center transition-colors ${
                  provenanceOpen
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-accent"
                }`}
                title={provenanceOpen ? "Hide sources" : "Show sources"}
              >
                <Eye className="w-4 h-4" />
              </button>
            )}

            {/* Share */}
            {messages.length > 0 && (
              <button
                type="button"
                className="shrink-0 rounded-full h-10 w-10 border border-border bg-background flex items-center justify-center hover:bg-accent transition-colors"
                title="Share conversation"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      </div>
    </DashboardShell>
  );
}

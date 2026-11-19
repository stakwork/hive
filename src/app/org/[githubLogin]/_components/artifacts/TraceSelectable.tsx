"use client";

import React, { useCallback, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatOrgLogin } from "./useArtifactPanel";
import { useTraceSelection, type UseTraceSelectionOptions } from "./useTraceSelection";

/**
 * Wraps text that can be traced: a Jamie reply, a strut job-card reply, or
 * the markdown artifact panel. On mouseup with a non-empty selection
 * inside, shows a small "Trace this" button near the selection; clicking
 * it posts to the trace route and opens the resulting artifact.
 *
 * One listener per surface — the selection itself is read straight off
 * `window.getSelection()`, never lifted into state, so this costs nothing
 * while nothing is selected.
 */
export function TraceSelectable({ conversationId, messageId, run, children, className }: UseTraceSelectionOptions & { children: ReactNode; className?: string }) {
  const githubLogin = useChatOrgLogin();
  const { pending, traceSelection } = useTraceSelection(githubLogin, { conversationId, messageId, run });
  const containerRef = useRef<HTMLDivElement>(null);
  const [button, setButton] = useState<{ x: number; y: number; text: string } | null>(null);

  const onMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !containerRef.current || selection!.rangeCount === 0) {
      setButton(null);
      return;
    }
    const range = selection!.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setButton(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const host = containerRef.current.getBoundingClientRect();
    setButton({ x: rect.left - host.left + rect.width / 2, y: rect.top - host.top, text });
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)} onMouseUp={onMouseUp}>
      {children}
      {button && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void traceSelection(button.text);
            setButton(null);
          }}
          style={{ left: button.x, top: button.y }}
          className="absolute z-10 -translate-x-1/2 -translate-y-full rounded-full border border-border bg-popover px-2 py-1 text-xs font-medium shadow-md hover:bg-accent disabled:opacity-50 flex items-center gap-1"
        >
          <Search className="h-3 w-3" />
          {pending ? "Tracing…" : "Trace this"}
        </button>
      )}
    </div>
  );
}

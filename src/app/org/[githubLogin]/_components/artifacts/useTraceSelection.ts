"use client";

import { useCallback, useRef, useState } from "react";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import type { ArtifactRef } from "../../_state/canvasChatArtifacts";

const MAX_SELECTION = 2000;

export interface TraceSelectionState {
  /** True while the request is in flight, for a "Tracing…" state on the popover. */
  pending: boolean;
  error: string | null;
}

export interface UseTraceSelectionOptions {
  conversationId: string | null;
  /** The message the selection was read from — the `id` the server stores the ref under. */
  messageId: string;
  /** A strut run the text itself is strut output of, when it is not Jamie's own reply text. */
  run?: { workspace: string; run: string };
}

/**
 * "Trace this": posts a browser text selection to
 * `POST /api/orgs/[githubLogin]/canvas/trace`, merges the resulting
 * `trace` artifact ref into the local conversation (the server already
 * appended the same ref to the same message), and opens it on the panel.
 * One call in flight at a time; a stale response (conversation switched
 * meanwhile) is dropped.
 */
export function useTraceSelection(githubLogin: string, options: UseTraceSelectionOptions) {
  const [state, setState] = useState<TraceSelectionState>({ pending: false, error: null });
  const addArtifactToMessage = useCanvasChatStore((s) => s.addArtifactToMessage);
  const openArtifactPanel = useCanvasChatStore((s) => s.openArtifactPanel);
  const requestId = useRef(0);

  const traceSelection = useCallback(
    async (selection: string) => {
      const trimmed = selection.trim();
      if (!trimmed || trimmed.length > MAX_SELECTION || !options.conversationId) return;
      const mine = ++requestId.current;
      setState({ pending: true, error: null });
      try {
        const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/canvas/trace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: options.conversationId,
            messageId: options.messageId,
            selection: trimmed,
            ...(options.run ? { run: options.run } : {}),
          }),
        });
        if (!res.ok) throw new Error(`Trace failed (${res.status})`);
        const { artifact }: { artifact: ArtifactRef } = await res.json();
        if (mine !== requestId.current || !options.conversationId) return;
        addArtifactToMessage(options.conversationId, options.messageId, artifact);
        openArtifactPanel(`id:${artifact.id}`);
        setState({ pending: false, error: null });
      } catch (err) {
        if (mine !== requestId.current) return;
        setState({ pending: false, error: err instanceof Error ? err.message : "Could not trace that selection" });
      }
    },
    [githubLogin, options.conversationId, options.messageId, options.run, addArtifactToMessage, openArtifactPanel],
  );

  return { ...state, traceSelection };
}

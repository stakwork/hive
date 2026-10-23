"use client";

import { useEffect, useRef } from "react";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { artifactIdentity } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { useActiveArtifacts } from "@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel";

export const ARTIFACT_PARAM = "artifact";

/** Sets or removes `?artifact=` in place (replace, no navigation), keeping other params, the hash and history state. */
export function writeArtifactParam(identity: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (identity) url.searchParams.set(ARTIFACT_PARAM, identity);
  else url.searchParams.delete(ARTIFACT_PARAM);
  const next = url.pathname + url.search + url.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.replaceState(window.history.state, "", next);
}

/**
 * Keeps the artifact panel's selection and `?artifact=<id>` in step, for the
 * chats view and the canvas view (they share one store).
 *
 * - A selection writes the param; closing the panel removes it.
 * - A param present on load opens the matching artifact once the active chat
 *   holds it — only once; an unknown id is ignored and dropped as soon as the
 *   user selects something else or switches chats.
 */
export function useArtifactUrlParam(): void {
  const identity = useCanvasChatStore((s) => s.artifactPanel?.identity ?? null);
  const conversationId = useCanvasChatStore((s) => s.activeConversationId);
  const artifacts = useActiveArtifacts();
  const pending = useRef<string | null>(null);
  const initialized = useRef(false);
  const prevConversation = useRef<string | null>(null);

  if (!initialized.current && typeof window !== "undefined") {
    initialized.current = true;
    pending.current = new URLSearchParams(window.location.search).get(ARTIFACT_PARAM) || null;
  }

  // Switching chats abandons a deep link that has not resolved.
  useEffect(() => {
    if (prevConversation.current && conversationId !== prevConversation.current) pending.current = null;
    prevConversation.current = conversationId;
  }, [conversationId]);

  // Apply the deep link once, when the artifact shows up.
  useEffect(() => {
    const wanted = pending.current;
    if (!wanted) return;
    if (artifacts.some((a) => artifactIdentity(a) === wanted)) {
      pending.current = null;
      useCanvasChatStore.getState().openArtifactPanel(wanted);
    }
  }, [artifacts]);

  // Selection -> URL (held back while a deep link is still waiting to resolve).
  useEffect(() => {
    if (pending.current) {
      if (identity === null) return;
      pending.current = null; // the user chose something themselves
    }
    writeArtifactParam(identity);
  }, [identity]);
}

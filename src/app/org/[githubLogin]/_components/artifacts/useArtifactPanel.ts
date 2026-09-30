"use client";

import { useShallow } from "zustand/react/shallow";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { listArtifacts, type ArtifactRef } from "../../_state/canvasChatArtifacts";

/**
 * The active conversation's artifacts, oldest first. Selected through
 * `useShallow`, so a consumer re-renders when an artifact changes and not
 * on every streamed chunk.
 */
export function useActiveArtifacts(): ArtifactRef[] {
  return useCanvasChatStore(
    useShallow((s) =>
      listArtifacts(s.activeConversationId ? s.conversations[s.activeConversationId]?.messages : undefined),
    ),
  );
}

/** True while the artifact panel has something to show: one is open and the active conversation holds it. */
export function useArtifactPanelOpen(): boolean {
  return useCanvasChatStore((s) => {
    const panel = s.artifactPanel;
    if (!panel || !s.activeConversationId) return false;
    const messages = s.conversations[s.activeConversationId]?.messages;
    return !!messages?.some((m) => m.artifacts?.some((a) => a.id === panel.artifactId));
  });
}

/** The org the active conversation belongs to — where a stored page an artifact points at lives. */
export function useChatOrgLogin(): string {
  return useCanvasChatStore(
    (s) => (s.activeConversationId ? s.conversations[s.activeConversationId]?.context.githubLogin : undefined) ?? "",
  );
}

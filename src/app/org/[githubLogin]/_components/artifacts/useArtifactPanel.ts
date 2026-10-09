"use client";

import { useShallow } from "zustand/react/shallow";
import { selectActiveMessages, useCanvasChatStore } from "../../_state/canvasChatStore";
import { artifactIdentity, jobIdOfArtifact, listArtifacts, type ArtifactRef } from "../../_state/canvasChatArtifacts";

/**
 * The active conversation's artifacts, oldest first. Selected through
 * `useShallow`, so a consumer re-renders when an artifact changes and not
 * on every streamed chunk.
 */
export function useActiveArtifacts(): ArtifactRef[] {
  return useCanvasChatStore(useShallow((s) => listArtifacts(selectActiveMessages(s))));
}

/** True while the artifact panel has something to show: one is open and the active conversation holds it. */
export function useArtifactPanelOpen(): boolean {
  return useCanvasChatStore((s) => {
    const panel = s.artifactPanel;
    if (!panel) return false;
    // Proposal-derived graph artifacts count too: their card is the proposal card.
    return listArtifacts(selectActiveMessages(s)).some((a) => artifactIdentity(a) === panel.identity);
  });
}

/** The strut job that reported an artifact, when a Job row did — what a viewer's action (the pull-request panel's Fix) sends to. */
export function useArtifactJobId(artifact: ArtifactRef): string | undefined {
  return useCanvasChatStore((s) => jobIdOfArtifact(selectActiveMessages(s), artifact));
}

/** The org the active conversation belongs to — where a stored page an artifact points at lives. */
export function useChatOrgLogin(): string {
  return useCanvasChatStore(
    (s) => (s.activeConversationId ? s.conversations[s.activeConversationId]?.context.githubLogin : undefined) ?? "",
  );
}

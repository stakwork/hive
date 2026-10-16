"use client";

import { useMemo } from "react";
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

/** True while the artifact panel has something to show: the index of a chat that has artifacts, one the active conversation holds, or a job's live one. */
export function useArtifactPanelOpen(): boolean {
  return useCanvasChatStore((s) => {
    const panel = s.artifactPanel;
    if (!panel) return false;
    if (panel.live && artifactIdentity(panel.live) === panel.identity) return true;
    // Proposal-derived graph artifacts count too: their card is the proposal card.
    const artifacts = listArtifacts(selectActiveMessages(s));
    if (panel.identity === null) return artifacts.length > 0;
    return artifacts.some((a) => artifactIdentity(a) === panel.identity);
  });
}

/**
 * For each artifact the active conversation holds, the job whose row last
 * reported it — `[identity, jobId, job title]` triples, flat so the store
 * subscription compares by value and streaming text doesn't re-render. An
 * artifact Jamie reported itself has no entry.
 */
export function useArtifactJobs(): ReadonlyMap<string, { jobId: string; title: string }> {
  const flat = useCanvasChatStore(
    useShallow((s) => {
      const out: string[] = [];
      for (const message of selectActiveMessages(s) ?? []) {
        const source = message.source;
        if (source?.kind !== "job" && source?.kind !== "job_claims") continue;
        for (const artifact of message.artifacts ?? [])
          out.push(artifactIdentity(artifact), source.jobId, source.title || "Job");
      }
      return out;
    }),
  );
  return useMemo(() => {
    const jobs = new Map<string, { jobId: string; title: string }>();
    for (let i = 0; i < flat.length; i += 3) jobs.set(flat[i], { jobId: flat[i + 1], title: flat[i + 2] });
    return jobs;
  }, [flat]);
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

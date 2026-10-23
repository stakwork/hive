"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { selectActiveMessages, useCanvasChatStore } from "../../_state/canvasChatStore";
import type { ArtifactRef } from "../../_state/canvasChatArtifacts";
import { brainstormCardOf, choiceTreeQuery, isTreeArtifact, treeContentOfJson } from "./viewers/ChoiceTree";
import { brainstormCardHref } from "./viewers/graph";
import { artifactIdentity, listArtifacts } from "../../_state/canvasChatArtifacts";

/**
 * A brainstorm tree card's workspace and focus. Null for anything else (and
 * for a tree with nothing to focus, or content not read yet).
 */
export function treeOf(artifact: ArtifactRef, content: unknown): { workspace: string; focus: string } | null {
  if (!content || typeof content !== "object") return null;
  let tree: { workspace?: string; focus?: string } | null = null;
  if (artifact.kind === "graph") {
    const graph = content as Parameters<typeof isTreeArtifact>[1];
    tree = isTreeArtifact(artifact, graph) ? graph : null;
  } else if (artifact.kind === "json") {
    tree = treeContentOfJson(artifact, content as { value: unknown });
  }
  return tree?.workspace && tree.focus ? { workspace: tree.workspace, focus: tree.focus } : null;
}

/** The card a brainstorm is about and its root, from the tree's read; null when it's about none or the read fails. */
export async function findBrainstormCard(qc: QueryClient, workspace: string, focus: string) {
  try {
    return brainstormCardOf(await qc.fetchQuery(choiceTreeQuery(workspace, focus)));
  } catch {
    return null;
  }
}

/**
 * Opens an artifact from a card or the index: a brainstorm tree on the
 * Brainstorm tab, at the card it's about with the tree unfolded; everything
 * else — and a brainstorm about no card — on the artifact panel, one the
 * active chat doesn't hold (a job's artifact on a canvas card) as a live one.
 * On the canvas view a client navigation re-aims the canvas (it follows
 * `?at=&tree=`) and keeps the chat; from any other view the org page reads
 * `?view=` only on mount, so that is a full navigation.
 */
export function useOpenArtifact(githubLogin: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const onCanvas = searchParams?.get("view") === "canvas" && pathname === `/org/${encodeURIComponent(githubLogin)}`;
  return useCallback(
    async (artifact: ArtifactRef, content: unknown) => {
      const tree = githubLogin ? treeOf(artifact, content) : null;
      const at = tree ? await findBrainstormCard(qc, tree.workspace, tree.focus) : null;
      if (!at) {
        const store = useCanvasChatStore.getState();
        const identity = artifactIdentity(artifact);
        const held = listArtifacts(selectActiveMessages(store)).some((a) => artifactIdentity(a) === identity);
        return held ? store.openArtifactPanel(identity) : store.openLiveArtifact(artifact);
      }
      const href = brainstormCardHref(githubLogin, at.card, at.root);
      useCanvasChatStore.getState().closeArtifactPanel();
      if (onCanvas) router.push(href);
      else window.location.assign(href);
    },
    [githubLogin, onCanvas, router, qc],
  );
}

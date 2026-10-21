"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { selectActiveMessages, useCanvasChatStore } from "../../_state/canvasChatStore";
import type { ArtifactRef } from "../../_state/canvasChatArtifacts";
import { isTreeArtifact, treeContentOfJson } from "./viewers/ChoiceTree";
import { brainstormBoardHref } from "./viewers/graph";
import { artifactIdentity, listArtifacts } from "../../_state/canvasChatArtifacts";

/**
 * Where a brainstorm tree card opens: the desk, at the card's focus. Null for
 * anything else (and for a tree with nothing to focus, or content not read
 * yet), which opens on the artifact panel as before.
 */
export function treeDeskHref(artifact: ArtifactRef, content: unknown, githubLogin: string): string | null {
  if (!githubLogin || !content || typeof content !== "object") return null;
  let tree: { workspace?: string; focus?: string } | null = null;
  if (artifact.kind === "graph") {
    const graph = content as Parameters<typeof isTreeArtifact>[1];
    tree = isTreeArtifact(artifact, graph) ? graph : null;
  } else if (artifact.kind === "json") {
    tree = treeContentOfJson(artifact, content as { value: unknown });
  }
  return tree?.workspace && tree.focus ? brainstormBoardHref(githubLogin, tree.workspace, tree.focus) : null;
}

/**
 * Opens an artifact from a card or the index: a brainstorm tree on the desk,
 * everything else on the artifact panel — one the active chat doesn't hold
 * (a job's artifact on a canvas card) as a live one. On the canvas view a client
 * navigation re-aims the desk (it follows the params) and keeps the chat;
 * from any other view the org page reads `?view=` only on mount, so that is a
 * full navigation.
 */
export function useOpenArtifact(githubLogin: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onCanvas = searchParams?.get("view") === "canvas" && pathname === `/org/${encodeURIComponent(githubLogin)}`;
  return useCallback(
    (artifact: ArtifactRef, content: unknown) => {
      const href = treeDeskHref(artifact, content, githubLogin);
      if (!href) {
        const store = useCanvasChatStore.getState();
        const identity = artifactIdentity(artifact);
        const held = listArtifacts(selectActiveMessages(store)).some((a) => artifactIdentity(a) === identity);
        return held ? store.openArtifactPanel(identity) : store.openLiveArtifact(artifact);
      }
      useCanvasChatStore.getState().closeArtifactPanel();
      if (onCanvas) router.push(href);
      else window.location.assign(href);
    },
    [githubLogin, onCanvas, router],
  );
}

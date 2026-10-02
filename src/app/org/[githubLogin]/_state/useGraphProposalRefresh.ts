"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workbenchKey } from "@/components/graph-workbench/queries";
import { selectActiveMessages, useCanvasChatStore, type CanvasChatMessage } from "./canvasChatStore";

/**
 * When a proposal is approved in the chat, the graph of the workspace it names
 * is read again: a graph open beside the chat, or the proposal's own, shows
 * the change without a reload (only an open graph refetches).
 *
 * Imperative, like `useSubAgentStatusRefresh`: a store subscription, so the
 * page doesn't re-render per streamed chunk, and so the re-read starts inside
 * the store write — before React remounts a proposal's graph on the decision,
 * which then waits for that read instead of landing on the old one.
 */
export function useGraphProposalRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handled = new Set<string>();
    let conversationId: string | null = null;
    let seen: CanvasChatMessage[] | undefined;

    const sync = (state: ReturnType<typeof useCanvasChatStore.getState>) => {
      const messages = selectActiveMessages(state);
      if (messages === seen && state.activeConversationId === conversationId) return;
      // Approvals already in a conversation when it opens changed nothing just now.
      const opened = state.activeConversationId !== conversationId;
      conversationId = state.activeConversationId;
      seen = messages;
      const workspaces = new Set<string>();
      for (const m of messages ?? []) {
        const result = m.role === "assistant" ? m.approvalResult : undefined;
        if (!result || handled.has(result.proposalId)) continue;
        handled.add(result.proposalId);
        if (!opened && result.workspaceSlug) workspaces.add(result.workspaceSlug);
      }
      for (const slug of workspaces) void queryClient.invalidateQueries({ queryKey: workbenchKey(slug) });
    };

    sync(useCanvasChatStore.getState());
    return useCanvasChatStore.subscribe(sync);
  }, [queryClient]);
}

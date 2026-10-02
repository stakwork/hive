"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { workbenchKey } from "@/components/graph-workbench/queries";
import { useCanvasChatStore } from "./canvasChatStore";
import { approvedGraphChanges } from "./proposalGraphArtifacts";

/**
 * When a graph proposal is approved in the chat, the graph it changed is read
 * again: a graph open beside the chat, or the proposal's own, shows the change
 * as it now is, without a reload. Mounted once, at the org page.
 */
export function useGraphProposalRefresh() {
  const queryClient = useQueryClient();
  const messages = useCanvasChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.messages : undefined,
  );
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!messages) return;
    for (const { proposalId, workspace } of approvedGraphChanges(messages)) {
      if (handled.current.has(proposalId)) continue;
      handled.current.add(proposalId);
      void queryClient.invalidateQueries({ queryKey: workbenchKey(workspace) });
    }
  }, [messages, queryClient]);
}

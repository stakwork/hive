"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getJson } from "@/components/graph-workbench/queries";
import type { StrutProposalRecord } from "@/lib/strut-orchestrator";
import { type CanvasChatMessage, useCanvasChatStore } from "../../_state/canvasChatStore";
import type { PendingProposal } from "./proposals";

const NO_MESSAGES: CanvasChatMessage[] = [];

/** The proposals in a conversation still waiting on a decision: proposal rows with no result row after them. */
export function pendingProposalRows(
  messages: readonly CanvasChatMessage[],
): Array<{ proposalId: string; runId: string }> {
  const decided = new Set(messages.flatMap((m) => (m.source?.kind === "proposal_result" ? [m.source.proposalId] : [])));
  return messages.flatMap((m) =>
    m.source?.kind === "proposal" && m.source.status === "pending" && !decided.has(m.source.proposalId)
      ? [{ proposalId: m.source.proposalId, runId: m.source.runId }]
      : [],
  );
}

/**
 * Strut's pending proposals in the conversation you're in, read in full
 * (`GET …/strut/proposals/:id?run=`, the chat card's read and access rule),
 * and decided from the canvas through the same route as the chat's card.
 * Proposals live in strut and are scoped by the proposing turn's
 * conversation, so a teammate's (in their own chat) don't show here.
 */
export function useCanvasProposals(githubLogin: string) {
  const qc = useQueryClient();
  const messages = useCanvasChatStore((s) =>
    s.activeConversationId ? (s.conversations[s.activeConversationId]?.messages ?? NO_MESSAGES) : NO_MESSAGES,
  );
  const rows = useMemo(() => pendingProposalRows(messages), [messages]);
  // Decided here: gone at once, before the conversation's result row arrives.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const base = (id: string) => `/api/orgs/${encodeURIComponent(githubLogin)}/strut/proposals/${encodeURIComponent(id)}`;
  const records = useQueries({
    queries: rows.map((r) => ({
      queryKey: ["strut-proposal", githubLogin, r.proposalId],
      queryFn: () =>
        getJson<{ proposal: StrutProposalRecord }>(`${base(r.proposalId)}?run=${encodeURIComponent(r.runId)}`),
      staleTime: 60_000,
      retry: 1,
    })),
  });
  const pending: PendingProposal[] = useMemo(
    () =>
      rows.flatMap((r, i) => {
        const record = records[i]?.data?.proposal;
        return record && record.status === "pending" && !decided.has(r.proposalId) ? [{ runId: r.runId, record }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `records` is a fresh array each render; its data is what counts
    [rows, decided, records.map((q) => q.dataUpdatedAt).join(",")],
  );

  const decide = useCallback(
    async (proposalId: string, runId: string, action: "accept" | "reject") => {
      try {
        const res = await fetch(`${base(proposalId)}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, action }),
        });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // Already decided elsewhere (409) is decided too: the card goes either way.
        if (!res.ok && res.status !== 409) {
          toast.error(body?.error ?? `Strut answered ${res.status}.`);
          return false;
        }
        setDecided((d) => new Set([...d, proposalId]));
        // What strut wrote on accept is in the graph now: read the plans again.
        void qc.invalidateQueries({ queryKey: ["initiative-tree"] });
        void qc.invalidateQueries({ queryKey: ["initiatives"] });
        void qc.invalidateQueries({ queryKey: ["strut-proposal", githubLogin, proposalId] });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `base` only reads githubLogin
    [githubLogin, qc],
  );

  return { pending, decide };
}

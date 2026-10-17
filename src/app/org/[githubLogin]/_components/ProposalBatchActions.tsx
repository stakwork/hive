"use client";

import React, { useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getProposalStatus, type ProposalOutput } from "@/lib/proposals/types";
import { useCanvasChatStore, type CanvasChatMessage } from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";
import {
  approvalContent,
  buildApprovalIntent,
  getProposalTitle,
  rejectionContent,
  sortProposalsByDependency,
} from "./ProposalCard";

const BATCHABLE_KINDS = new Set<ProposalOutput["kind"]>([
  "conceptCreate",
  "conceptUpdate",
  "graphNodeCreate",
  "graphNodeEdit",
  "graphTripletCreate",
  "graphBatchTripletCreate",
  "graphEdgeDelete",
  "graphNodeMove",
  "graphNodeDelete",
]);

const EMPTY_MESSAGES: CanvasChatMessage[] = [];

export function isBatchableProposal(p: ProposalOutput): boolean {
  return BATCHABLE_KINDS.has(p.kind);
}

/** Resolves once the conversation has no running turn. */
function waitForTurnEnd(conversationId: string): Promise<void> {
  const running = () =>
    !!useCanvasChatStore.getState().conversations[conversationId]?.activeTurn;
  if (!running()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useCanvasChatStore.subscribe(() => {
      if (!running()) {
        unsub();
        resolve();
      }
    });
  });
}

type Mode = "approve" | "reject";

export function ProposalBatchActions({ proposals }: { proposals: ProposalOutput[] }) {
  const activeId = useCanvasChatStore((s) => s.activeConversationId);
  const messages = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.messages : undefined) ?? EMPTY_MESSAGES,
  );
  const currentRef = useCanvasChatStore(
    (s) => (activeId ? s.conversations[activeId]?.context.currentCanvasRef : "") ?? "",
  );
  const turnRunning = useCanvasChatStore(
    (s) => !!(activeId && s.conversations[activeId]?.activeTurn),
  );
  const sendMessage = useSendCanvasChatMessage();
  const [progress, setProgress] = useState<{ mode: Mode; index: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const pending = useMemo(
    () =>
      sortProposalsByDependency(proposals.filter(isBatchableProposal)).filter(
        (p) => getProposalStatus(messages, p.proposalId).status === "pending",
      ),
    [proposals, messages],
  );

  const running = progress !== null;
  if (!running && pending.length < 2) {
    return summary ? <p className="px-1 text-xs text-muted-foreground">{summary}</p> : null;
  }

  const run = async (mode: Mode) => {
    if (!activeId || running) return;
    const queue = pending;
    const failed: string[] = [];
    let ok = 0;
    setSummary(null);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      setProgress({ mode, index: i + 1, total: queue.length });
      const title = getProposalTitle(p);
      try {
        await waitForTurnEnd(activeId);
        await sendMessage(
          mode === "approve"
            ? {
                conversationId: activeId,
                content: approvalContent(title),
                approval: buildApprovalIntent({ proposalId: p.proposalId, currentRef }),
              }
            : {
                conversationId: activeId,
                content: rejectionContent(title),
                rejection: { proposalId: p.proposalId },
              },
        );
        await waitForTurnEnd(activeId);
        const msgs = useCanvasChatStore.getState().conversations[activeId]?.messages ?? [];
        const st = getProposalStatus(msgs, p.proposalId).status;
        if (st === (mode === "approve" ? "approved" : "rejected")) ok++;
        else failed.push(title);
      } catch {
        failed.push(title);
      }
    }
    setProgress(null);
    const verb = mode === "approve" ? "approved" : "rejected";
    const text =
      `${ok} ${verb}` + (failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : "");
    setSummary(text);
    if (failed.length) toast.error(text);
  };

  const disabled = running || turnRunning;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {progress.mode === "approve" ? "Approving" : "Rejecting"} {progress.index} of {progress.total}…
          </span>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={() => run("approve")}>
              <Check className="mr-1 h-3 w-3" />
              Approve all ({pending.length})
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled} onClick={() => run("reject")}>
              <X className="mr-1 h-3 w-3" />
              Reject all
            </Button>
          </>
        )}
      </div>
      {summary && !running && <p className="px-1 text-xs text-muted-foreground">{summary}</p>}
    </div>
  );
}

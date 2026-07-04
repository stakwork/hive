"use client";

import React, { useState } from "react";
import { LogDetailContent } from "@/components/agent-logs/LogDetailContent";
import { AgentSessionCaptureModal } from "@/components/evals/AgentSessionCaptureModal";
import { isEvalCaptureEnabled } from "@/lib/eval-capture-slugs";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";

interface ChatDetailCaptureWrapperProps {
  slug: string;
  conversationId: string;
  conversation: ParsedMessage[];
  stats: AgentLogStats | null;
  rawContent: string;
}

/**
 * Client wrapper around LogDetailContent for canvas/chat conversation pages.
 * Owns modal state and wires per-turn Flag buttons when eval capture is
 * enabled for the workspace (stakwork + hive, via the shared allowlist).
 */
export function ChatDetailCaptureWrapper({
  slug,
  conversationId,
  conversation,
  stats,
  rawContent,
}: ChatDetailCaptureWrapperProps) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureTurnIndex, setCaptureTurnIndex] = useState<number | undefined>(undefined);

  const evalEnabled = isEvalCaptureEnabled(slug);

  return (
    <>
      <LogDetailContent
        conversation={conversation}
        stats={stats}
        rawContent={rawContent}
        loading={false}
        error={null}
        variant="page"
        workspaceSlug={slug}
        onFlagTurn={
          evalEnabled
            ? (i) => {
                setCaptureTurnIndex(i);
                setCaptureOpen(true);
              }
            : undefined
        }
      />

      {evalEnabled && (
        <AgentSessionCaptureModal
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          slug={slug}
          logId={conversationId}
          turnIndex={captureTurnIndex}
          defaultAgent="canvas-agent"
        />
      )}
    </>
  );
}

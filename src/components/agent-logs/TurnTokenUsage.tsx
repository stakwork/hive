"use client";

import React, { useState } from "react";
import { Coins, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ParsedMessage } from "@/lib/utils/agent-log-stats";

type UsageData = ParsedMessage["usage"];

/** Format a token count: ≤10k → localeString, >10k → "12.3k" */
function formatTokens(n: number): string {
  if (n > 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function hasAnyToken(usage: UsageData): usage is NonNullable<UsageData> {
  if (!usage) return false;
  return !!(usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens);
}

interface TurnTokenUsageProps {
  usage: UsageData;
}

/**
 * Compact per-turn token usage footer for assistant messages in agent logs.
 * Collapsed by default (single line); click expands to show cache read/write split.
 */
export function TurnTokenUsage({ usage }: TurnTokenUsageProps) {
  const [expanded, setExpanded] = useState(false);

  if (!hasAnyToken(usage)) return null;

  const cacheTotal = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const hasCacheSplit = !!(usage.cacheReadTokens || usage.cacheWriteTokens);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Toggle token usage detail"
      >
        <Coins className="w-3 h-3 shrink-0" />
        <span>
          {usage.inputTokens != null && (
            <span>in: <span className="font-medium">{formatTokens(usage.inputTokens)}</span></span>
          )}
          {usage.outputTokens != null && (
            <span> · out: <span className="font-medium">{formatTokens(usage.outputTokens)}</span></span>
          )}
          {cacheTotal > 0 && (
            <span> · cache: <span className="font-medium">{formatTokens(cacheTotal)}</span></span>
          )}
        </span>
        {hasCacheSplit && (
          expanded
            ? <ChevronDown className="w-3 h-3 shrink-0" />
            : <ChevronRight className="w-3 h-3 shrink-0" />
        )}
      </button>

      {expanded && hasCacheSplit && (
        <div className="flex items-center gap-1.5 mt-0.5 pl-4">
          {usage.cacheReadTokens != null && usage.cacheReadTokens > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
              read: {formatTokens(usage.cacheReadTokens)}
            </Badge>
          )}
          {usage.cacheWriteTokens != null && usage.cacheWriteTokens > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
              write: {formatTokens(usage.cacheWriteTokens)}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

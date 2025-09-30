"use client";

import { StreamReasoningPart as StreamReasoningPartType } from "@/types/learn";

interface StreamReasoningPartProps {
  part: StreamReasoningPartType;
}

export function StreamReasoningPart({ part }: StreamReasoningPartProps) {
  if (!part.content) return null;

  return (
    <div className="rounded-lg p-3 border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">💭</span>
        <div className="font-semibold text-sm">Reasoning</div>
      </div>
      <div className="text-xs text-muted-foreground italic">{part.content}</div>
    </div>
  );
}

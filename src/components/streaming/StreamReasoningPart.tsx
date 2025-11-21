"use client";

import type { StreamReasoningPart as StreamReasoningPartType } from "@/types/streaming";

interface StreamReasoningPartProps {
  part: StreamReasoningPartType;
  className?: string;
}

export function StreamReasoningPart({ part, className }: StreamReasoningPartProps) {
  if (!part.content) return null;

  return (
    <div className={className || "text-xs text-muted-foreground/70 italic border-l-2 border-muted pl-3 py-1"}>
      {part.content}
    </div>
  );
}

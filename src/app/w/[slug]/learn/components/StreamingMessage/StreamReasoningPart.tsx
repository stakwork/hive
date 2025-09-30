"use client";

import { StreamReasoningPart as StreamReasoningPartType } from "@/types/learn";

interface StreamReasoningPartProps {
  part: StreamReasoningPartType;
}

export function StreamReasoningPart({ part }: StreamReasoningPartProps) {
  if (!part.content) return null;

  return (
    <div className="text-xs text-muted-foreground/70 italic border-l-2 border-muted pl-3 py-1">
      {part.content}
    </div>
  );
}

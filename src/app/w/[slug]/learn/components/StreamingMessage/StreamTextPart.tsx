"use client";

import { StreamTextPart as StreamTextPartType } from "@/types/learn";

interface StreamTextPartProps {
  part: StreamTextPartType;
}

export function StreamTextPart({ part }: StreamTextPartProps) {
  if (!part.content) return null;

  return (
    <div className="text-sm bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
      <div className="prose prose-sm max-w-none dark:prose-invert">{part.content}</div>
    </div>
  );
}

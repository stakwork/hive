"use client";

import ReactMarkdown from "react-markdown";
import type { StreamTextPart as StreamTextPartType } from "@/types/streaming";

interface StreamTextPartProps {
  part: StreamTextPartType;
  className?: string;
}

export function StreamTextPart({ part, className }: StreamTextPartProps) {
  if (!part.content) return null;

  return (
    <div
      className={
        className || "prose prose-sm max-w-none dark:prose-invert [&>*]:!text-foreground [&_*]:!text-foreground"
      }
    >
      <ReactMarkdown>{part.content}</ReactMarkdown>
    </div>
  );
}

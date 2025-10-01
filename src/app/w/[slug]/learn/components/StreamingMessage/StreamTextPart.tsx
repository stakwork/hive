"use client";

import ReactMarkdown from "react-markdown";
import { StreamTextPart as StreamTextPartType } from "@/types/learn";

interface StreamTextPartProps {
  part: StreamTextPartType;
}

export function StreamTextPart({ part }: StreamTextPartProps) {
  if (!part.content) return null;

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert [&>*]:!text-foreground [&_*]:!text-foreground">
      <ReactMarkdown>{part.content}</ReactMarkdown>
    </div>
  );
}

import React from "react";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  children: string;
  className?: string;
  variant?: "user" | "assistant";
}

export function MarkdownRenderer({
  children,
  className,
  variant = "assistant",
}: MarkdownRendererProps) {
  // Simple stub that preserves line breaks and basic formatting
  const processedContent =
    typeof children === "string"
      ? children
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
      : children;

  return (
    <div className={cn("prose dark:prose-invert max-w-full", className)}>
      <div style={{ whiteSpace: 'pre-wrap' }}>
        {processedContent}
      </div>
    </div>
  );
}

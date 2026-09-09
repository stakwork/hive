"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Icon-only copy-to-clipboard; swaps to a check for 1.5 s after a click. */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  /** Tooltip and accessible name, e.g. "Copy output". */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          aria-label={copied ? "Copied" : label}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground",
            className,
          )}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{copied ? "Copied!" : label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

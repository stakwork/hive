import React from "react";
import { cn } from "@/lib/utils";

interface JamieWorkingIndicatorProps {
  className?: string;
  label?: string;
}

/**
 * Assistant-position "Jamie is working…" bubble. Animates only transform and
 * opacity, and falls back to static dots under prefers-reduced-motion.
 */
export function JamieWorkingIndicator({ className, label = "Jamie is working…" }: JamieWorkingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="jamie-working-indicator"
      className={cn("flex justify-start", className)}
    >
      <div className="inline-flex items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2 shadow-sm">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span aria-hidden="true" className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              data-testid="jamie-working-dot"
              style={{ animationDelay: `${i * 150}ms` }}
              className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce motion-reduce:animate-none"
            />
          ))}
        </span>
      </div>
    </div>
  );
}

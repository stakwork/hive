"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface ColorSwatchProps {
  color: string;
  label?: string;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}

export function ColorSwatch({
  color,
  label,
  selected,
  onClick,
  size = "md",
}: ColorSwatchProps) {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const checkSizeClasses = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  // Determine if color is light (for check icon contrast)
  const isLightColor = (hex: string) => {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "rounded-md border-2 transition-all flex items-center justify-center",
          sizeClasses[size],
          selected
            ? "border-foreground ring-2 ring-primary/30 scale-110"
            : "border-border hover:border-foreground/50 hover:scale-105"
        )}
        style={{ backgroundColor: color }}
        aria-label={label ? `Select ${label}` : `Select color ${color}`}
        aria-pressed={selected}
      >
        {selected && (
          <Check
            className={cn(
              checkSizeClasses[size],
              "drop-shadow-sm",
              isLightColor(color) ? "text-gray-800" : "text-white"
            )}
          />
        )}
      </button>
      {label && (
        <span className="text-xs text-muted-foreground truncate max-w-[60px]">
          {label}
        </span>
      )}
    </div>
  );
}

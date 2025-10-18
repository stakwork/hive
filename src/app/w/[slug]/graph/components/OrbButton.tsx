"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Orb from "./Orb";

interface OrbButtonProps {
  isListening: boolean;
  isDisabled?: boolean;
  onToggle: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function OrbButton({
  isListening,
  isDisabled = false,
  onToggle,
  size = "lg",
  className,
}: OrbButtonProps) {
  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const handleClick = () => {
    if (!isDisabled) {
      console.log("[OrbButton] Button clicked!", { isListening, isDisabled });
      onToggle();
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={isDisabled}
            className={cn(
              "relative rounded-full transition-all duration-300 ease-out cursor-pointer",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              "border-0 bg-transparent",
              sizeClasses[size],
              isDisabled && "opacity-50 cursor-not-allowed grayscale",
              !isDisabled && "hover:scale-105",
              className
            )}
            aria-label={isListening ? "Stop recording" : "Start voice input"}
          >
            <Orb
              hue={0}
              hoverIntensity={isListening ? 0.8 : 0.5}
              rotateOnHover={true}
              forceHoverState={isListening}
              isActive={isListening}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isDisabled
              ? "Voice input not available"
              : isListening
                ? "Stop recording"
                : "Start voice input (or hold Ctrl)"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

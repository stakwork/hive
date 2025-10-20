"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface MicButtonProps {
  isListening: boolean;
  isDisabled?: boolean;
  onToggle: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function MicButton({ isListening, isDisabled = false, onToggle, size = "lg", className }: MicButtonProps) {
  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={isListening ? "default" : "outline"}
            onClick={onToggle}
            disabled={isDisabled}
            className={cn(
              "rounded-full transition-all duration-200",
              sizeClasses[size],
              isListening && "animate-pulse shadow-lg ring-4 ring-primary/20",
              className
            )}
          >
            {isListening ? <MicOff className={iconSizes[size]} /> : <Mic className={iconSizes[size]} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isListening ? "Stop recording" : "Start voice input (or hold Ctrl)"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

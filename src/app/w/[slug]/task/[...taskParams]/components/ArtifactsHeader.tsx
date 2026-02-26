"use client";

import React from "react";
import { ArtifactType } from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Monitor, Network, FileCode, Code2, Terminal, ClipboardList, ListChecks } from "lucide-react";
import { PiGraphFill } from "react-icons/pi";
import { cn } from "@/lib/utils";

interface ArtifactButton {
  type: ArtifactType;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

// Visual artifacts (left side)
const VISUAL_ARTIFACTS: ArtifactButton[] = [
  { type: "PLAN", icon: ClipboardList, label: "Plan" },
  { type: "TASKS", icon: ListChecks, label: "Tasks" },
  { type: "BROWSER", icon: Monitor, label: "Live Preview" },
  { type: "GRAPH", icon: PiGraphFill, label: "Graph" },
  { type: "WORKFLOW", icon: Network, label: "Workflow" },
];

// Code artifacts (right side)
const CODE_ARTIFACTS: ArtifactButton[] = [
  { type: "CODE", icon: FileCode, label: "Code / Files" },
  { type: "DIFF", icon: Code2, label: "Changes" },
  { type: "IDE", icon: Terminal, label: "IDE" },
];

interface ArtifactsHeaderProps {
  availableArtifacts: ArtifactType[];
  activeArtifact: ArtifactType | null;
  onArtifactChange: (type: ArtifactType) => void;
  headerAction?: React.ReactNode;
}

export function ArtifactsHeader({ availableArtifacts, activeArtifact, onArtifactChange, headerAction }: ArtifactsHeaderProps) {
  const renderButton = ({ type, icon: Icon, label }: ArtifactButton) => {
    if (!availableArtifacts.includes(type)) return null;

    const isActive = activeArtifact === type;

    return (
      <TooltipProvider key={type}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onArtifactChange(type)}
              className={cn(
                "h-8 w-8 p-0",
                isActive && "bg-secondary"
              )}
              aria-label={label}
            >
              <Icon className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const visualButtons = VISUAL_ARTIFACTS.map(renderButton).filter(Boolean);
  const codeButtons = CODE_ARTIFACTS.map(renderButton).filter(Boolean);

  return (
    <div className="border-b bg-background/80 backdrop-blur px-3 py-2">
      <div className="flex items-center justify-between">
        {/* Left side: Visual artifacts */}
        <div className="flex items-center gap-1">
          {visualButtons}
        </div>

        {/* Right side: Header action + Code artifacts */}
        <div className="flex items-center gap-1">
          {headerAction}
          {codeButtons}
        </div>
      </div>
    </div>
  );
}

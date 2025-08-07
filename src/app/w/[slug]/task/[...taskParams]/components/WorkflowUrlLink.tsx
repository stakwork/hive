"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorkflowUrlLinkProps {
  workflowUrl: string;
  className?: string;
}

export function WorkflowUrlLink({
  workflowUrl,
  className = "",
}: WorkflowUrlLinkProps) {
  const handleClick = () => {
    window.open(workflowUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div 
      className={`absolute -top-2 -right-2 transition-opacity duration-200 z-10 ${className}`}
    >
      <Button
        onClick={handleClick}
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 hover:bg-background/80 border border-border/50 shadow-sm bg-background"
        aria-label="Open workflow in new tab"
      >
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}
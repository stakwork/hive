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
      className={`absolute top-2 right-2 transition-opacity duration-200 ${className}`}
    >
      <Button
        onClick={handleClick}
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 hover:bg-muted/50"
        aria-label="Open workflow in new tab"
      >
        <ExternalLink className="h-4 w-4" />
      </Button>
    </div>
  );
}
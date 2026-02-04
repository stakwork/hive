"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";
import { cn } from "@/lib/utils";

interface CollaboratorAvatarsProps {
  collaborators: CollaboratorInfo[];
  maxVisible?: number;
  className?: string;
}

export function CollaboratorAvatars({
  collaborators,
  maxVisible = 5,
  className,
}: CollaboratorAvatarsProps) {
  if (collaborators.length === 0) {
    return null;
  }

  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const hiddenCount = collaborators.length - maxVisible;

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("flex items-center -space-x-2", className)}>
        {visibleCollaborators.map((collaborator) => (
          <Tooltip key={collaborator.odinguserId}>
            <TooltipTrigger asChild>
              <Avatar
                className="h-7 w-7 border-2 border-background cursor-default"
                style={{ boxShadow: `0 0 0 2px ${collaborator.color}` }}
              >
                {collaborator.image ? (
                  <AvatarImage src={collaborator.image} alt={collaborator.name} />
                ) : null}
                <AvatarFallback
                  className="text-xs font-medium text-white"
                  style={{ backgroundColor: collaborator.color }}
                >
                  {getInitials(collaborator.name)}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {collaborator.name}
            </TooltipContent>
          </Tooltip>
        ))}

        {hiddenCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-7 w-7 border-2 border-background bg-muted cursor-default">
                <AvatarFallback className="text-xs font-medium">
                  +{hiddenCount}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {collaborators
                .slice(maxVisible)
                .map((c) => c.name)
                .join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

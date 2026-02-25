"use client";

import { motion, AnimatePresence } from "framer-motion";
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

const popBounce = {
  initial: { opacity: 0, scale: 0 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 400, damping: 15 },
  },
  exit: {
    opacity: 0,
    scale: 0,
    transition: { duration: 0.15 },
  },
};

export function CollaboratorAvatars({
  collaborators,
  maxVisible = 3,
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
        <AnimatePresence mode="popLayout">
          {visibleCollaborators.map((collaborator) => (
            <motion.div
              key={collaborator.odinguserId}
              variants={popBounce}
              initial="initial"
              animate="animate"
              exit="exit"
              layout
            >
              <Tooltip>
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
            </motion.div>
          ))}

          {hiddenCount > 0 && (
            <motion.div
              key="overflow"
              variants={popBounce}
              initial="initial"
              animate="animate"
              exit="exit"
              layout
            >
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
            </motion.div>
          )}
        </AnimatePresence>
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

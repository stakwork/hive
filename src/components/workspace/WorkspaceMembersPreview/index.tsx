"use client";

import React, { useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface WorkspaceMembersPreviewProps {
  workspaceSlug: string;
  maxDisplay?: number;
}

function getInitials(user: {
  name: string | null;
  email: string | null;
}): string {
  if (user.name) {
    const names = user.name.split(" ");
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return user.name.substring(0, 2).toUpperCase();
  }
  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }
  return "U";
}

export function WorkspaceMembersPreview({
  workspaceSlug,
  maxDisplay = 4,
}: WorkspaceMembersPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { members, loading } = useWorkspaceMembers(workspaceSlug, {
    includeSystemAssignees: false,
  });

  if (!members || members.length === 0) {
    return null;
  }

  // Sort: owner first, then by earliest joinedAt (oldest members first)
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === "OWNER") return -1;
    if (b.role === "OWNER") return 1;
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });

  const displayMembers = isExpanded ? sortedMembers : sortedMembers.slice(0, maxDisplay);
  const remainingCount = members.length - maxDisplay;
  const hasMore = remainingCount > 0;

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div 
      data-testid="workspace-members-preview"
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card/95 backdrop-blur-sm transition-all duration-300 max-h-[120px] overflow-y-auto ${loading ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Avatar list */}
      <div className="flex items-center gap-2 flex-wrap">
        {displayMembers.map((member, index) => {
          const isAdditional = index >= maxDisplay;
          const staggerDelay = isAdditional ? (index - maxDisplay) * 50 : 0;

          return (
            <Tooltip key={member.id}>
              <TooltipTrigger asChild>
                <Avatar
                  className={`w-8 h-8 border-2 border-card hover:scale-110 transition-all duration-200 ${
                    isAdditional && isExpanded
                      ? 'animate-slide-in'
                      : ''
                  }`}
                  style={
                    isAdditional && isExpanded
                      ? { animationDelay: `${staggerDelay}ms` }
                      : undefined
                  }
                >
                  <AvatarImage
                    src={member.user.image || undefined}
                    alt={member.user.name || member.user.email || "User"}
                  />
                  <AvatarFallback className="text-xs">
                    {getInitials(member.user)}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>
                <p>{member.user.name || member.user.email || "Unknown user"}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Expand/collapse button */}
        {hasMore && (
          <button
            onClick={handleToggleExpand}
            className="w-8 h-8 rounded-full border-2 border-card bg-muted flex items-center justify-center hover:scale-105 hover:bg-muted/80 transition-all duration-200 cursor-pointer"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const PEEK_OFFSET = 6;  // px each avatar peeks above the one below at rest
const AVATAR_SIZE = 32; // w-8 = 32px
const FAN_GAP = 8;      // gap between avatars when fully fanned

interface WorkspaceMembersPreviewProps {
  workspaceSlug: string;
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
}: WorkspaceMembersPreviewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { members, loading } = useWorkspaceMembers(workspaceSlug, {
    includeSystemAssignees: false,
  });

  if (!members || members.length === 0) {
    return null;
  }

  // Sort: owner first, then by earliest joinedAt
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === "OWNER") return -1;
    if (b.role === "OWNER") return 1;
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });

  const N = sortedMembers.length;

  // Collapsed height: top avatar fully visible + remaining peek out beneath
  const collapsedHeight = (N - 1) * PEEK_OFFSET + AVATAR_SIZE;
  // Expanded height: all avatars fully separated
  const expandedHeight = (N - 1) * (AVATAR_SIZE + FAN_GAP) + AVATAR_SIZE;

  return (
    <div
      className={`relative border border-border bg-card/95 backdrop-blur-sm rounded-lg pointer-events-auto transition-all duration-300 ${loading ? "opacity-0" : "opacity-100"}`}
      style={{
        width: `${AVATAR_SIZE + 4}px`,
        height: `${isHovered ? expandedHeight : collapsedHeight}px`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {sortedMembers.map((member, index) => {
        // index 0 = owner = topmost position in the stack
        // reversedIndex maps owner → highest position, last member → position 0
        const reversedIndex = N - 1 - index;

        const restBottom = reversedIndex * PEEK_OFFSET;
        const fanBottom = reversedIndex * (AVATAR_SIZE + FAN_GAP);

        // Bottom-to-top cascade: lowest avatar fans first (reversedIndex 0 = delay 0)
        const delay = reversedIndex * 40;

        return (
          <Tooltip key={member.id}>
            <TooltipTrigger asChild>
              <div
                className="absolute transition-all duration-300"
                style={{
                  bottom: `${isHovered ? fanBottom : restBottom}px`,
                  left: "2px",
                  zIndex: reversedIndex + 1,
                  transitionDelay: `${delay}ms`,
                }}
              >
                <Avatar className="w-8 h-8 border-2 border-card hover:scale-110 transition-transform duration-200">
                  <AvatarImage
                    src={member.user.image || undefined}
                    alt={member.user.name || member.user.email || "User"}
                  />
                  <AvatarFallback className="text-xs">
                    {getInitials(member.user)}
                  </AvatarFallback>
                </Avatar>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{member.user.name || member.user.email || "Unknown user"}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

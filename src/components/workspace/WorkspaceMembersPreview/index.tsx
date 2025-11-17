"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

  const previewMembers = sortedMembers.slice(0, maxDisplay);
  const remainingCount = members.length - maxDisplay;
  const hasMore = remainingCount > 0;

  return (
    <Link href={`/w/${workspaceSlug}/settings#members`}>
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-all duration-300 cursor-pointer ${loading ? 'opacity-0' : 'opacity-100'}`}>
        {/* Avatar list */}
        <div className="flex items-center gap-2">
          {previewMembers.map((member) => (
            <Tooltip key={member.id}>
              <TooltipTrigger asChild>
                <Avatar
                  className="w-8 h-8 border-2 border-card hover:scale-110 transition-transform"
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
          ))}

          {/* +N badge if more than 4 members */}
          {hasMore && (
            <div className="w-8 h-8 rounded-full border-2 border-card bg-muted flex items-center justify-center">
              <span className="text-xs font-medium text-muted-foreground">
                +{remainingCount}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

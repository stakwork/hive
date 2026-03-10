"use client";

import React, { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface SphinxLinkedMember {
  id: string;
  name: string;
  email: string;
  image?: string;
  sphinxAlias: string;
}

interface InvitePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  featureId: string;
  children: React.ReactNode;
}

export function InvitePopover({
  open,
  onOpenChange,
  workspaceSlug,
  featureId,
  children,
}: InvitePopoverProps) {
  const [members, setMembers] = useState<SphinxLinkedMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);

  // Fetch Sphinx-linked members when popover opens
  useEffect(() => {
    if (!open) return;

    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceSlug}/members?sphinxLinkedOnly=true`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch members");
        }

        const data = await response.json();

        // Combine owner and members arrays
        const allMembers = [...(data.owner ? [data.owner] : []), ...(data.members || [])];

        // Handle response structure - map user data from members
        const membersList = allMembers.map((member: any) => ({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image,
          sphinxAlias: member.user.sphinxAlias,
        }));

        setMembers(membersList);
      } catch (error) {
        console.error("Error fetching Sphinx-linked members:", error);
        toast.error("Failed to load members");
      } finally {
        setIsLoadingMembers(false);
      }
    };

    fetchMembers();
  }, [open, workspaceSlug]);

  // Reset selections when popover closes
  useEffect(() => {
    if (!open) {
      setSelectedMemberIds(new Set());
    }
  }, [open]);

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else if (next.size < 3) {
        next.add(memberId);
      }
      // silently ignore if already at cap of 3
      return next;
    });
  };

  const handleSendInvite = async () => {
    if (selectedMemberIds.size === 0) return;

    setIsSending(true);
    try {
      const response = await fetch(`/api/features/${featureId}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inviteeUserIds: Array.from(selectedMemberIds) }),
      });

      const data = await response.json();

      if (!response.ok && data.failed === undefined) {
        throw new Error(data.error || "Failed to send invite");
      }

      const { sent = 0, failed = 0 } = data;

      if (failed > 0) {
        toast.error(`${failed} of ${sent + failed} invites failed`);
      } else {
        toast.success(`${sent} invite${sent !== 1 ? "s" : ""} sent!`);
      }
    } catch (error) {
      console.error("Error sending invite:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to send invite"
      );
    } finally {
      setIsSending(false);
      onOpenChange(false);
      setSelectedMemberIds(new Set());
    }
  };

  const sendButtonLabel = () => {
    if (isSending) return "Sending...";
    if (selectedMemberIds.size === 1) return "Send Invite";
    return `Send ${selectedMemberIds.size} Invites`;
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search members..." />
          <CommandList>
            <CommandEmpty>
              {isLoadingMembers
                ? "Loading members..."
                : "No Sphinx-linked members found"}
            </CommandEmpty>
            <CommandGroup>
              {members.map((member) => (
                <CommandItem
                  key={member.id}
                  value={member.name}
                  onSelect={() => handleToggleMember(member.id)}
                  className="flex items-center gap-2"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={member.image} alt={member.name} />
                    <AvatarFallback>
                      {member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {member.name}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      @{member.sphinxAlias}
                    </span>
                  </div>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      selectedMemberIds.has(member.id)
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t p-3 flex gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            size="sm"
            className="flex-1"
            data-testid="cancel-button"
          >
            Cancel
          </Button>
          {selectedMemberIds.size > 0 && (
            <Button
              onClick={handleSendInvite}
              disabled={isSending}
              className="flex-1"
              size="sm"
              data-testid="send-invite-button"
            >
              {sendButtonLabel()}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

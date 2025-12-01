"use client";

import { useState, useEffect } from "react";
import { Check, User as UserIcon, Bot } from "lucide-react";
import { toast } from "sonner";
import { generateSphinxBountyUrl } from "@/lib/sphinx-tribes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface WorkspaceMember {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
  icon?: string;
}

interface AssigneeComboboxProps {
  workspaceSlug: string;
  currentAssignee?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    icon?: string | null;
  } | null;
  onSelect: (
    assigneeId: string | null,
    assigneeData?: { id: string; name: string | null; email: string | null; image: string | null; icon?: string | null } | null
  ) => Promise<void>;
  showSpecialAssignees?: boolean;
  ticketData?: {
    id: string;
    title: string;
    description?: string | null;
    estimatedHours?: number | null;
    bountyCode?: string | null;
    repository?: {
      repositoryUrl?: string | null;
    } | null;
  };
}

export function AssigneeCombobox({ workspaceSlug, currentAssignee, onSelect, showSpecialAssignees = false, ticketData }: AssigneeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [systemAssignees, setSystemAssignees] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (open && members.length === 0) {
      fetchMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/workspaces/${workspaceSlug}/members${showSpecialAssignees ? '?includeSystemAssignees=true' : ''}`);
      if (response.ok) {
        const data = await response.json();
        // Combine owner and members into a single array
        const allMembers = [...(data.owner ? [data.owner] : []), ...(data.members || [])];
        setMembers(allMembers);
        setSystemAssignees(data.systemAssignees || []);
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (
    memberId: string | null,
    memberData?: { id: string; name: string | null; email: string | null; image: string | null; icon?: string | null } | null
  ) => {
    try {
      setUpdating(true);
      await onSelect(memberId, memberData);
      setOpen(false);

      if (memberId === "system:task-coordinator" && ticketData) {
        toast.info("Task queued for coordinator", {
          description: "Processing begins when a machine is available",
        });
      }

      if (memberId === "system:bounty-hunter" && ticketData) {
        const bountyUrl = generateSphinxBountyUrl({
          ...ticketData,
          description: ticketData.description ?? undefined,
          estimatedHours: ticketData.estimatedHours ?? undefined,
          bountyCode: ticketData.bountyCode ?? undefined,
          repository: ticketData.repository ? {
            repositoryUrl: ticketData.repository.repositoryUrl ?? undefined
          } : undefined,
        });
        window.open(bountyUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.error("Failed to update assignee:", error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="w-auto justify-start h-8 px-2 text-sm font-normal hover:bg-muted"
          onClick={(e) => e.stopPropagation()}
        >
          {currentAssignee ? (
            <div className="flex items-center gap-2">
              <Avatar key={currentAssignee.id} className="h-5 w-5">
                {currentAssignee.image ? (
                  <AvatarImage src={currentAssignee.image} />
                ) : (
                  <AvatarFallback className="text-xs">
                    {currentAssignee.icon === "bot" ? (
                      <Bot className="h-3 w-3" />
                    ) : (
                      currentAssignee.name?.charAt(0) || <UserIcon className="h-3 w-3" />
                    )}
                  </AvatarFallback>
                )}
              </Avatar>
              <span className="truncate">{currentAssignee.name || currentAssignee.email}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Avatar key="unassigned" className="h-5 w-5">
                <AvatarFallback className="text-xs">
                  <UserIcon className="h-3 w-3" />
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground">Unassigned</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search members..." />
          <CommandList>
            <CommandEmpty>{loading ? "Loading members..." : "No members found."}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="unassigned" onSelect={() => handleSelect(null, null)} disabled={updating}>
                <Check className={cn("mr-2 h-4 w-4", !currentAssignee ? "opacity-100" : "opacity-0")} />
                <Avatar className="h-5 w-5 mr-2">
                  <AvatarFallback className="text-xs">
                    <UserIcon className="h-3 w-3" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-muted-foreground">Unassigned</span>
              </CommandItem>
              {showSpecialAssignees &&
                systemAssignees.map((sys) => (
                  <CommandItem
                    key={sys.userId}
                    value={sys.user.name || sys.userId}
                    onSelect={() =>
                      handleSelect(sys.userId, {
                        id: sys.userId,
                        name: sys.user.name,
                        email: sys.user.email,
                        image: sys.user.image,
                        icon: sys.icon,
                      })
                    }
                    disabled={updating}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", currentAssignee?.id === sys.userId ? "opacity-100" : "opacity-0")}
                    />
                    <Avatar className="h-5 w-5 mr-2">
                      {sys.user.image ? (
                        <AvatarImage src={sys.user.image} />
                      ) : (
                        <AvatarFallback className="text-xs">
                          {sys.icon === "bot" ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="truncate">{sys.user.name || sys.user.email}</span>
                  </CommandItem>
                ))}
              {members.map((member) => (
                <CommandItem
                  key={member.userId}
                  value={member.user.name || member.user.email || member.userId}
                  onSelect={() =>
                    handleSelect(member.userId, {
                      id: member.userId,
                      name: member.user.name,
                      email: member.user.email,
                      image: member.user.image,
                    })
                  }
                  disabled={updating}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", currentAssignee?.id === member.userId ? "opacity-100" : "opacity-0")}
                  />
                  <Avatar className="h-5 w-5 mr-2">
                    <AvatarImage src={member.user.image || undefined} />
                    <AvatarFallback className="text-xs">
                      {member.user.name?.charAt(0) || <UserIcon className="h-3 w-3" />}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{member.user.name || member.user.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

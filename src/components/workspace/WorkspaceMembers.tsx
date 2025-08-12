"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users, Plus, MoreHorizontal, Trash2 } from "lucide-react";
import { AddMemberModal } from "./AddMemberModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { WorkspaceMember } from "@/types/workspace";
import type { WorkspaceRole } from "@/lib/auth/roles";
import { useSession } from "next-auth/react";

interface WorkspaceMembersProps {
  canAdmin: boolean;
}

export function WorkspaceMembers({ canAdmin }: WorkspaceMembersProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [owner, setOwner] = useState<WorkspaceMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    open: boolean;
    userId: string;
    userName: string;
  }>({ open: false, userId: "", userName: "" });
  const { slug } = useWorkspace();
  const { data: session } = useSession();

  // Fetch workspace members
  const fetchMembers = async () => {
    if (!slug) return;
    
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${slug}/members`);
      if (!response.ok) {
        throw new Error("Failed to fetch members");
      }
      const data = await response.json();
      setMembers(data.members || []);
      setOwner(data.owner || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch members");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [slug]);

  const handleRemoveMember = (userId: string, userName: string) => {
    // Skip if trying to remove owner
    if (owner && userId === owner.userId) {
      return;
    }
    
    setConfirmRemove({
      open: true,
      userId,
      userName,
    });
  };

  const confirmRemoveMember = async () => {
    try {
      const response = await fetch(`/api/workspaces/${slug}/members/${confirmRemove.userId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to remove member");
      }
      // Refresh members list
      await fetchMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleUpdateRole = async (userId: string, role: WorkspaceRole) => {
    try {
      const response = await fetch(`/api/workspaces/${slug}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        throw new Error("Failed to update role");
      }
      // Refresh members list
      await fetchMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const getRoleBadgeVariant = (role: WorkspaceRole) => {
    switch (role) {
      case "OWNER":
        return "default";
      case "ADMIN":
        return "secondary";
      case "PM":
        return "destructive";
      case "DEVELOPER":
        return "outline";
      case "STAKEHOLDER":
        return "outline";
      case "VIEWER":
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Workspace Members
              </CardTitle>
              <CardDescription>
                Manage who has access to this workspace
              </CardDescription>
            </div>
            {canAdmin && (
              <Button onClick={() => setShowAddModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-muted rounded-full animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="w-32 h-4 bg-muted rounded animate-pulse" />
                    <div className="w-24 h-3 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="w-16 h-6 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (members.length === 0 && !owner) ? (
            <div className="text-center py-6 text-muted-foreground">
              No members found
            </div>
          ) : (
            <div className="space-y-3">
              {/* Render owner first if present */}
              {owner && (
                <div key={`owner-${owner.id}`} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage 
                        src={owner.user.image || undefined}
                        alt={owner.user.name || "Owner"}
                      />
                      <AvatarFallback>
                        {owner.user.name?.charAt(0) || owner.user.github?.username?.charAt(0) || "O"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">
                          {owner.user.name || owner.user.github?.username || "Unknown"}
                        </p>
                        {owner.user.github?.username && (
                          <span className="text-sm text-muted-foreground">
                            @{owner.user.github.username}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {owner.user.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-primary">
                      {owner.role}
                    </Badge>
                  </div>
                </div>
              )}
              
              {/* Render regular members */}
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage 
                        src={member.user.image || undefined}
                        alt={member.user.name || "User"}
                      />
                      <AvatarFallback>
                        {member.user.name?.charAt(0) || member.user.github?.username?.charAt(0) || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">
                          {member.user.name || member.user.github?.username || "Unknown"}
                        </p>
                        {member.user.github?.username && (
                          <span className="text-sm text-muted-foreground">
                            @{member.user.github.username}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {member.user.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getRoleBadgeVariant(member.role)}>
                      {member.role}
                    </Badge>
                    {canAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {member.role !== "ADMIN" && (
                            <DropdownMenuItem onClick={() => handleUpdateRole(member.userId, "ADMIN")}>
                              Make Admin
                            </DropdownMenuItem>
                          )}
                          {member.role !== "PM" && (
                            <DropdownMenuItem onClick={() => handleUpdateRole(member.userId, "PM")}>
                              Make PM
                            </DropdownMenuItem>
                          )}
                          {member.role !== "DEVELOPER" && (
                            <DropdownMenuItem onClick={() => handleUpdateRole(member.userId, "DEVELOPER")}>
                              Make Developer
                            </DropdownMenuItem>
                          )}
                          {member.role !== "VIEWER" && (
                            <DropdownMenuItem onClick={() => handleUpdateRole(member.userId, "VIEWER")}>
                              Make Viewer
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem 
                            onClick={() => handleRemoveMember(
                              member.userId, 
                              member.user.name || member.user.github?.username || "this member"
                            )}
                            className="text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canAdmin && (
        <AddMemberModal
          open={showAddModal}
          onOpenChange={setShowAddModal}
          workspaceSlug={slug || ""}
          onMemberAdded={fetchMembers}
        />
      )}

      <ConfirmDialog
        open={confirmRemove.open}
        onOpenChange={(open) => setConfirmRemove(prev => ({ ...prev, open }))}
        title="Remove Member"
        description={`Are you sure you want to remove ${confirmRemove.userName} from this workspace? They will lose access to all workspace resources.`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmRemoveMember}
      />
    </>
  );
}
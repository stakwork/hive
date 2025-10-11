"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditableTitle } from "@/components/ui/editable-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TicketsTable } from "@/components/features/TicketsTable";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useTicketMutations } from "@/hooks/useTicketMutations";
import type { PhaseWithTickets, TicketListItem } from "@/types/roadmap";
import type { PhaseStatus, TicketStatus, Priority } from "@prisma/client";

export default function PhaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { slug: workspaceSlug } = useWorkspace();
  const phaseId = params.phaseId as string;

  const fetchPhase = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/phases/${id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch phase");
      }
      return response.json();
    },
    []
  );

  const {
    data: phase,
    setData: setPhase,
    updateData: updatePhase,
    loading,
    error,
  } = useDetailResource<PhaseWithTickets>({
    resourceId: phaseId,
    fetchFn: fetchPhase,
  });

  // Ticket creation state
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketStatus, setNewTicketStatus] = useState<TicketStatus>("TODO");
  const [newTicketPriority, setNewTicketPriority] = useState<Priority>("MEDIUM");
  const [newTicketAssigneeId, setNewTicketAssigneeId] = useState<string | null>(null);
  const [newTicketAssigneeData, setNewTicketAssigneeData] = useState<{
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { createTicket, loading: creatingTicket } = useTicketMutations();

  // Delete confirmation state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleBackClick = () => {
    if (phase?.feature) {
      router.push(`/w/${workspaceSlug}/roadmap/${phase.feature.id}`);
    } else {
      router.push(`/w/${workspaceSlug}/roadmap`);
    }
  };

  const handleUpdatePhase = async (field: string, value: string) => {
    if (!phase) return;

    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!response.ok) {
        throw new Error("Failed to update phase");
      }

      const result = await response.json();
      if (result.success) {
        updatePhase(result.data);
      }
    } catch (error) {
      console.error("Failed to update phase:", error);
    }
  };

  const handleUpdateStatus = async (status: PhaseStatus) => {
    await handleUpdatePhase("status", status);
  };

  const handleCreateTicket = async () => {
    if (!newTicketTitle.trim() || !phase?.feature) return;

    const ticket = await createTicket({
      featureId: phase.feature.id,
      phaseId,
      title: newTicketTitle,
      status: newTicketStatus,
      priority: newTicketPriority,
      assigneeId: newTicketAssigneeId,
    });

    if (ticket && phase) {
      // Add new ticket to the list
      setPhase({
        ...phase,
        tickets: [...phase.tickets, ticket],
      });

      // Reset form and auto-focus
      setNewTicketTitle("");
      setNewTicketStatus("TODO");
      setNewTicketPriority("MEDIUM");
      setNewTicketAssigneeId(null);
      setNewTicketAssigneeData(null);

      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 0);
    }
  };

  const handleCancelCreateTicket = () => {
    setNewTicketTitle("");
    setNewTicketStatus("TODO");
    setNewTicketPriority("MEDIUM");
    setNewTicketAssigneeId(null);
    setNewTicketAssigneeData(null);
    setIsCreatingTicket(false);
  };

  const handleTicketsReordered = (reorderedTickets: TicketListItem[]) => {
    if (phase) {
      setPhase({
        ...phase,
        tickets: reorderedTickets,
      });
    }
  };

  const handleTicketUpdate = (ticketId: string, updates: Partial<TicketListItem>) => {
    if (phase) {
      setPhase({
        ...phase,
        tickets: phase.tickets.map((t) => (t.id === ticketId ? { ...t, ...updates } : t)),
      });
    }
  };

  const handleDeletePhase = async () => {
    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete phase");
      }

      setShowDeleteDialog(false);
      handleBackClick();
    } catch (error) {
      console.error("Failed to delete phase:", error);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBackClick}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-12 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !phase) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={handleBackClick}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-red-600">Error</h2>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error || "Phase not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with back button and breadcrumbs */}
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={handleBackClick} className="self-start">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        {phase.feature && (
          <div className="text-sm text-muted-foreground">
            <span
              className="hover:underline cursor-pointer"
              onClick={() => router.push(`/w/${workspaceSlug}/roadmap/${phase.feature.id}`)}
            >
              {phase.feature.title}
            </span>
            <span className="mx-2">›</span>
            <span>{phase.name}</span>
          </div>
        )}
      </div>

      {/* Phase Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Phase Title */}
            <div className="flex items-center gap-4">
              <EditableTitle
                value={phase.name}
                onChange={(value) => updatePhase({ name: value })}
                onBlur={(value) => handleUpdatePhase("name", value)}
                placeholder="Enter phase name..."
                size="large"
              />
            </div>

            {/* Status & Actions */}
            <div className="flex items-center gap-4">
              <StatusPopover
                statusType="phase"
                currentStatus={phase.status}
                onUpdate={handleUpdateStatus}
              />

              {/* Actions Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">More actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Phase</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &quot;{phase.name}&quot;? Any tickets in this phase will be moved to &quot;Unassigned&quot;.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeletePhase}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Tickets Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Tickets</h3>
              {!isCreatingTicket && (
                <Button
                  onClick={() => setIsCreatingTicket(true)}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Ticket
                </Button>
              )}
            </div>

            {/* Inline Ticket Creation Form */}
            {isCreatingTicket && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="space-y-3">
                  <div>
                    <Input
                      ref={titleInputRef}
                      placeholder="Ticket title..."
                      value={newTicketTitle}
                      onChange={(e) => setNewTicketTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !creatingTicket) {
                          handleCreateTicket();
                        } else if (e.key === "Escape") {
                          handleCancelCreateTicket();
                        }
                      }}
                      autoFocus
                      disabled={creatingTicket}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusPopover
                      statusType="ticket"
                      currentStatus={newTicketStatus}
                      onUpdate={async (status) => setNewTicketStatus(status)}
                    />
                    <PriorityPopover
                      currentPriority={newTicketPriority}
                      onUpdate={async (priority) => setNewTicketPriority(priority)}
                    />
                    <AssigneeCombobox
                      workspaceSlug={workspaceSlug}
                      currentAssignee={newTicketAssigneeData}
                      onSelect={async (assigneeId, assigneeData) => {
                        setNewTicketAssigneeId(assigneeId);
                        setNewTicketAssigneeData(assigneeData || null);
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelCreateTicket}
                      disabled={creatingTicket}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleCreateTicket}
                      disabled={creatingTicket || !newTicketTitle.trim()}
                    >
                      {creatingTicket ? (
                        <>
                          <Spinner className="h-4 w-4 mr-2" />
                          Creating...
                        </>
                      ) : (
                        "Create"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <TicketsTable
              phaseId={phaseId}
              workspaceSlug={workspaceSlug}
              tickets={phase.tickets}
              onTicketsReordered={handleTicketsReordered}
              onTicketUpdate={handleTicketUpdate}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

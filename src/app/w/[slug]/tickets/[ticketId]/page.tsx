"use client";

import { useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EditableTitle } from "@/components/ui/editable-title";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { ActionMenu } from "@/components/ui/action-menu";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { TicketDetail } from "@/types/roadmap";
import type { TaskStatus, Priority } from "@prisma/client";

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { slug: workspaceSlug } = useWorkspace();
  const ticketId = params.ticketId as string;

  const fetchTicket = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/tickets/${id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch ticket");
      }
      return response.json();
    },
    []
  );

  const {
    data: ticket,
    setData: setTicket,
    updateData: updateTicket,
    loading,
    error,
  } = useDetailResource<TicketDetail>({
    resourceId: ticketId,
    fetchFn: fetchTicket,
  });

  const handleSave = useCallback(
    async (updates: Partial<TicketDetail> | { assigneeId: string | null }) => {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update ticket");
      }

      const result = await response.json();
      if (result.success && ticket) {
        // Merge the update with existing ticket to preserve feature/phase relations
        const updatedTicket = { ...ticket, ...result.data };
        setTicket(updatedTicket);
        updateOriginalData(updatedTicket);
      }
    },
    [ticketId, ticket, setTicket]
  );

  const { saving, saved, savedField, handleFieldBlur, updateOriginalData, triggerSaved } = useAutoSave({
    data: ticket,
    onSave: handleSave,
  });

  const handleBackClick = () => {
    if (ticket?.feature) {
      router.push(`/w/${workspaceSlug}/plan/${ticket.feature.id}?tab=tasks`);
    } else {
      router.push(`/w/${workspaceSlug}/plan`);
    }
  };

  const handleUpdateStatus = async (status: TaskStatus) => {
    await handleSave({ status });
    triggerSaved("title");
  };

  const handleUpdatePriority = async (priority: Priority) => {
    await handleSave({ priority });
    triggerSaved("title");
  };

  const handleUpdateAssignee = async (assigneeId: string | null) => {
    await handleSave({ assigneeId } as Partial<TicketDetail>);
    triggerSaved("title");
  };

  const handleDeleteTicket = async () => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete ticket");
      }

      handleBackClick();
    } catch (error) {
      console.error("Failed to delete ticket:", error);
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
            <Skeleton className="h-16 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !ticket) {
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
            <p className="text-muted-foreground">{error || "Ticket not found"}</p>
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
        <div className="text-sm text-muted-foreground">
          {ticket.feature && (
            <>
              <span
                className="hover:underline cursor-pointer"
                onClick={() => router.push(`/w/${workspaceSlug}/plan/${ticket.feature!.id}?tab=tasks`)}
              >
                {ticket.feature!.title}
              </span>
              <span className="mx-2">›</span>
            </>
          )}
          <span>{ticket.title}</span>
        </div>
      </div>

      {/* Ticket Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Title */}
            <div className="flex items-center gap-3">
              <EditableTitle
                value={ticket.title}
                onChange={(value) => updateTicket({ title: value })}
                onBlur={(value) => handleFieldBlur("title", value)}
                placeholder="Enter ticket title..."
                size="large"
              />
              {/* Save indicator - only show for title/status/priority/assignee changes */}
              {savedField === "title" && saved && !saving && (
                <div className="flex items-center gap-2 text-sm flex-shrink-0">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">Saved</span>
                </div>
              )}
            </div>

            {/* Status, Priority, Assignee & Actions */}
            <div className="flex flex-wrap items-center gap-4">
              <StatusPopover
                statusType="task"
                currentStatus={ticket.status}
                onUpdate={handleUpdateStatus}
              />

              <PriorityPopover
                currentPriority={ticket.priority}
                onUpdate={handleUpdatePriority}
              />

              <AssigneeCombobox
                workspaceSlug={workspaceSlug}
                currentAssignee={ticket.assignee}
                onSelect={handleUpdateAssignee}
                showSpecialAssignees={true}
              />

              {/* Actions Menu */}
              <ActionMenu
                actions={[
                  {
                    label: "Delete",
                    icon: Trash2,
                    variant: "destructive",
                    confirmation: {
                      title: "Delete Ticket",
                      description: `Are you sure you want to delete "${ticket.title}"? This action cannot be undone.`,
                      onConfirm: handleDeleteTicket,
                    },
                  },
                ]}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <AutoSaveTextarea
            id="description"
            label="Description"
            value={ticket.description || ""}
            rows={8}
            className="min-h-[200px]"
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => updateTicket({ description: value })}
            onBlur={(value) => handleFieldBlur("description", value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

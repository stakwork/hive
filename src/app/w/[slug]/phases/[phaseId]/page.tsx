"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { TicketsTable } from "@/components/features/TicketsTable";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { PhaseWithTickets, TicketListItem } from "@/types/roadmap";
import type { PhaseStatus, TicketStatus, Priority } from "@prisma/client";

export default function PhaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { slug: workspaceSlug } = useWorkspace();
  const phaseId = params.phaseId as string;

  const [phase, setPhase] = useState<PhaseWithTickets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const [creatingTicket, setCreatingTicket] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchPhase = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/phases/${phaseId}`);

        if (!response.ok) {
          throw new Error("Failed to fetch phase");
        }

        const result = await response.json();
        if (result.success) {
          setPhase(result.data);
        } else {
          throw new Error("Failed to fetch phase");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (phaseId) {
      fetchPhase();
    }
  }, [phaseId]);

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
        setPhase({ ...phase, ...result.data });
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

    try {
      setCreatingTicket(true);
      const response = await fetch(`/api/features/${phase.feature.id}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTicketTitle.trim(),
          phaseId,
          status: newTicketStatus,
          priority: newTicketPriority,
          assigneeId: newTicketAssigneeId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create ticket");
      }

      const result = await response.json();

      if (result.success) {
        // Add new ticket to the list
        setPhase({
          ...phase,
          tickets: [...phase.tickets, result.data],
        });

        // Reset title only, keep form open and auto-focus
        setNewTicketTitle("");
        setNewTicketStatus("TODO");
        setNewTicketPriority("MEDIUM");
        setNewTicketAssigneeId(null);
        setNewTicketAssigneeData(null);

        // Auto-focus back to title input
        setTimeout(() => {
          titleInputRef.current?.focus();
        }, 0);
      }
    } catch (error) {
      console.error("Failed to create ticket:", error);
    } finally {
      setCreatingTicket(false);
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
              <Input
                value={phase.name}
                onChange={(e) => setPhase({ ...phase, name: e.target.value })}
                onBlur={(e) => handleUpdatePhase("name", e.target.value)}
                className="!text-4xl !font-bold !h-auto !py-0 !px-0 !border-none !bg-transparent !shadow-none focus-visible:!ring-0 focus-visible:!border-none focus:!border-none focus:!bg-transparent focus:!shadow-none focus:!ring-0 focus:!outline-none !tracking-tight !rounded-none flex-1"
                placeholder="Enter phase name..."
              />
            </div>

            {/* Status */}
            <div>
              <StatusPopover
                statusType="phase"
                currentStatus={phase.status}
                onUpdate={handleUpdateStatus}
              />
            </div>
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
                      onSelect={(assigneeId, assigneeData) => {
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

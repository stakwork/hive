"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { TicketDetail } from "@/types/roadmap";
import type { TicketStatus, Priority } from "@prisma/client";

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { slug: workspaceSlug } = useWorkspace();
  const ticketId = params.ticketId as string;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  const originalTicketRef = useRef<TicketDetail | null>(null);

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/tickets/${ticketId}`);

        if (!response.ok) {
          throw new Error("Failed to fetch ticket");
        }

        const result = await response.json();
        if (result.success) {
          setTicket(result.data);
          originalTicketRef.current = result.data;
        } else {
          throw new Error("Failed to fetch ticket");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (ticketId) {
      fetchTicket();
    }
  }, [ticketId]);

  const handleBackClick = () => {
    if (ticket?.phase) {
      router.push(`/w/${workspaceSlug}/phases/${ticket.phase.id}`);
    } else if (ticket?.feature) {
      router.push(`/w/${workspaceSlug}/roadmap/${ticket.feature.id}`);
    } else {
      router.push(`/w/${workspaceSlug}/roadmap`);
    }
  };

  const updateTicket = async (updates: Partial<TicketDetail> & { assigneeId?: string | null }) => {
    try {
      setSaving(true);

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
        originalTicketRef.current = updatedTicket;

        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          setSavedField(null);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to update ticket:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldBlur = (field: string, value: string | null) => {
    const originalValue = originalTicketRef.current?.[field as keyof TicketDetail];
    if (ticket && originalValue !== value) {
      setSavedField(field);
      updateTicket({ [field]: value });
    }
  };

  const handleUpdateStatus = async (status: TicketStatus) => {
    setSavedField("general");
    await updateTicket({ status });
  };

  const handleUpdatePriority = async (priority: Priority) => {
    setSavedField("general");
    await updateTicket({ priority });
  };

  const handleUpdateAssignee = async (assigneeId: string | null) => {
    setSavedField("general");
    await updateTicket({ assigneeId });
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
                onClick={() => router.push(`/w/${workspaceSlug}/roadmap/${ticket.feature.id}`)}
              >
                {ticket.feature.title}
              </span>
              <span className="mx-2">›</span>
            </>
          )}
          {ticket.phase && (
            <>
              <span
                className="hover:underline cursor-pointer"
                onClick={() => router.push(`/w/${workspaceSlug}/phases/${ticket.phase.id}`)}
              >
                {ticket.phase.name}
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
              <Input
                value={ticket.title}
                onChange={(e) => setTicket({ ...ticket, title: e.target.value })}
                onBlur={(e) => handleFieldBlur("title", e.target.value)}
                className="!text-4xl !font-bold !h-auto !py-0 !px-0 !border-none !bg-transparent !shadow-none focus-visible:!ring-0 focus-visible:!border-none focus:!border-none focus:!bg-transparent focus:!shadow-none focus:!ring-0 focus:!outline-none !tracking-tight !rounded-none flex-1"
                placeholder="Enter ticket title..."
              />
              {savedField === "general" && saved && !saving && (
                <div className="flex items-center gap-2 text-sm flex-shrink-0">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">Saved</span>
                </div>
              )}
            </div>

            {/* Status, Priority, Assignee */}
            <div className="flex flex-wrap items-center gap-4">
              <StatusPopover
                statusType="ticket"
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
            onChange={(value) => setTicket({ ...ticket, description: value })}
            onBlur={(value) => handleFieldBlur("description", value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

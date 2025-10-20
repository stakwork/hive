"use client";

import { useState } from "react";
import type { TicketListItem } from "@/types/roadmap";
import type { TaskStatus, Priority } from "@prisma/client";

interface CreateTicketParams {
  featureId: string;
  phaseId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string | null;
}

interface UpdateTicketParams {
  ticketId: string;
  updates: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: Priority;
    assigneeId?: string | null;
    dependsOnTaskIds?: string[];
  };
}

export function useTicketMutations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTicket = async (params: CreateTicketParams): Promise<TicketListItem | null> => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/features/${params.featureId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: params.title.trim(),
          description: params.description?.trim() || undefined,
          phaseId: params.phaseId,
          status: params.status,
          priority: params.priority,
          assigneeId: params.assigneeId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create ticket");
      }

      const result = await response.json();
      if (result.success) {
        return result.data;
      }

      throw new Error("Failed to create ticket");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("Failed to create ticket:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateTicket = async (params: UpdateTicketParams): Promise<TicketListItem | null> => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/tickets/${params.ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.updates),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update ticket");
      }

      const result = await response.json();
      if (result.success) {
        return result.data;
      }

      throw new Error("Failed to update ticket");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("Failed to update ticket:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    createTicket,
    updateTicket,
    loading,
    error,
  };
}

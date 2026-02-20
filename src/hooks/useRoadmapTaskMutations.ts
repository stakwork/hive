"use client";

import { useState } from "react";
import type { TicketListItem } from "@/types/roadmap";
import type { TaskStatus, Priority } from "@prisma/client";

interface CreateRoadmapTaskParams {
  featureId: string;
  phaseId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string | null;
  repositoryId?: string | null;
  autoMerge?: boolean;
}

interface UpdateRoadmapTaskParams {
  taskId: string;
  updates: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: Priority;
    assigneeId?: string | null;
    repositoryId?: string | null;
    dependsOnTaskIds?: string[];
    autoMerge?: boolean;
  };
}

export function useRoadmapTaskMutations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTicket = async (params: CreateRoadmapTaskParams): Promise<TicketListItem | null> => {
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
          repositoryId: params.repositoryId,
          autoMerge: params.autoMerge,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create roadmap task");
      }

      const result = await response.json();
      if (result.success) {
        return result.data;
      }

      throw new Error("Failed to create roadmap task");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("Failed to create roadmap task:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateTicket = async (params: UpdateRoadmapTaskParams): Promise<TicketListItem | null> => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/tickets/${params.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.updates),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update roadmap task");
      }

      const result = await response.json();
      if (result.success) {
        return result.data;
      }

      throw new Error("Failed to update roadmap task");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("Failed to update roadmap task:", err);
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

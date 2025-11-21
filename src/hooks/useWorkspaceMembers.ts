import { useState, useEffect, useCallback } from "react";

export interface WorkspaceMember {
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
  isSystem?: boolean;
}

interface UseWorkspaceMembersOptions {
  includeSystemAssignees?: boolean;
}

interface UseWorkspaceMembersReturn {
  members: WorkspaceMember[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWorkspaceMembers(
  workspaceSlug: string | undefined,
  options?: UseWorkspaceMembersOptions,
): UseWorkspaceMembersReturn {
  const { includeSystemAssignees = false } = options || {};
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!workspaceSlug) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const url = `/api/workspaces/${workspaceSlug}/members${
        includeSystemAssignees ? "?includeSystemAssignees=true" : ""
      }`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Failed to fetch workspace members");
      }

      const data = await response.json();

      // Combine owner + members + optional system assignees
      const allMembers: WorkspaceMember[] = [
        ...(data.owner ? [data.owner] : []),
        ...(data.members || []),
        ...(data.systemAssignees || []),
      ];

      setMembers(allMembers);
    } catch (err) {
      console.error("Error fetching workspace members:", err);
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, includeSystemAssignees]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return {
    members,
    loading,
    error,
    refetch: fetchMembers,
  };
}

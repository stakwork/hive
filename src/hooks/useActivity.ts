import { useState, useEffect, useCallback } from "react";

export interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  user: string;
  timestamp: Date;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface UseActivityResult {
  activities: ActivityItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useActivity(workspaceSlug: string, limit: number = 5): UseActivityResult {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    if (!workspaceSlug) return;
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/activity?limit=${limit}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch activity");
      }

      // Convert timestamp strings back to Date objects
      const activitiesWithDates = result.data.map((item: ActivityItem & { timestamp: string }) => ({
        ...item,
        timestamp: new Date(item.timestamp)
      }));

      setActivities(activitiesWithDates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, limit]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const refetch = () => {
    fetchActivity();
  };

  return {
    activities,
    loading,
    error,
    refetch
  };
}
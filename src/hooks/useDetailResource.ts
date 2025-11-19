"use client";

import { useEffect, useState } from "react";

interface UseDetailResourceParams<T> {
  resourceId: string;
  fetchFn: (id: string) => Promise<{ success: boolean; data?: T; error?: string }>;
}

export function useDetailResource<T>({ resourceId, fetchFn }: UseDetailResourceParams<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const result = await fetchFn(resourceId);

        if (result.success && result.data) {
          setData(result.data);
        } else {
          throw new Error(result.error || "Failed to fetch resource");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (resourceId) {
      fetchData();
    }
  }, [resourceId, fetchFn]);

  const updateData = (updates: Partial<T>) => {
    if (data) {
      setData({ ...data, ...updates });
    }
  };

  const setDataDirectly = (newData: T) => {
    setData(newData);
  };

  return {
    data,
    setData: setDataDirectly,
    updateData,
    loading,
    error,
  };
}

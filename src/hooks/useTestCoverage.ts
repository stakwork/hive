"use client";

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "./useWorkspace";
import { TestCoverageData } from "@/types";

interface UseTestCoverageResult {
  data?: TestCoverageData;
  isLoading: boolean;
  error?: string;
  refetch: () => Promise<void>;
}

export function useTestCoverage(): UseTestCoverageResult {
  const { id: workspaceId } = useWorkspace();
  const [data, setData] = useState<TestCoverageData | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchTestCoverage = useCallback(async () => {
    if (!workspaceId) {
      setError("No workspace selected");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(undefined);

      const response = await fetch(`/api/tests/coverage?workspaceId=${workspaceId}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to fetch test coverage");
      }

      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.message || "No coverage data available");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch test coverage");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchTestCoverage();
  }, [workspaceId, fetchTestCoverage]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchTestCoverage,
  };
}
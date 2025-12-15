"use client";

import { useState, useEffect, useCallback } from "react";
import { Billboard, Text } from "@react-three/drei";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCoverageStore } from "@/stores/useCoverageStore";
import { TestCoverageData } from "@/types";

export default function CoverageStatsLabel() {
  const { id: workspaceId } = useWorkspace();
  const { ignoreDirs, repo } = useCoverageStore();
  const [data, setData] = useState<TestCoverageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const fetchCoverageData = useCallback(async () => {
    if (!workspaceId) {
      setHasError(true);
      return;
    }

    try {
      setIsLoading(true);
      setHasError(false);

      const params = new URLSearchParams({ workspaceId });
      if (ignoreDirs) {
        params.set("ignoreDirs", ignoreDirs);
      }
      if (repo) {
        params.set("repo", repo);
      }

      const response = await fetch(`/api/tests/coverage?${params.toString()}`);
      const result = await response.json();

      if (!response.ok || !result.success || !result.data) {
        setHasError(true);
        return;
      }

      setData(result.data);
    } catch (error) {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, ignoreDirs, repo]);

  useEffect(() => {
    fetchCoverageData();
  }, [fetchCoverageData]);

  // Silent error/loading handling - render nothing
  if (isLoading || hasError || !data) {
    return null;
  }

  const lines: string[] = [];

  // Unit tests line
  if (data.unit_tests) {
    lines.push(`Unit: ${data.unit_tests.covered || 0}/${data.unit_tests.total || 0}`);
  }

  // Integration tests line
  if (data.integration_tests) {
    lines.push(`Integration: ${data.integration_tests.covered || 0}/${data.integration_tests.total || 0}`);
  }

  // E2E tests line
  if (data.e2e_tests) {
    lines.push(`E2E: ${data.e2e_tests.covered || 0}/${data.e2e_tests.total || 0}`);
  }

  // Mocks line (conditional)
  if (data.mocks) {
    lines.push(`Mocks: ${data.mocks.mocked || 0}/${data.mocks.total || 0}`);
  }

  return (
    <Billboard position={[-1000, 800, 0]}>
      {lines.map((line, index) => (
        <Text
          key={index}
          position={[0, -index * 40, 0]}
          fontSize={25}
          color="grey"
          anchorX="left"
          anchorY="top"
        >
          {line}
        </Text>
      ))}
    </Billboard>
  );
}
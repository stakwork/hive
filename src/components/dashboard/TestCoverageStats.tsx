"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useCoverageStore } from "@/stores/useCoverageStore";
import { useGraphStore } from "@/stores/useStores";
import { TestCoverageData } from "@/types";
import { useCallback, useEffect, useState } from "react";

export function TestCoverageStats() {
  const { id: workspaceId } = useWorkspace();
  const { ignoreDirs, statsRepo } = useCoverageStore();
  const { selectedLayer } = useGraphStore((s) => s.testLayerVisibility);
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
      if (statsRepo) {
        params.set("repo", statsRepo);
      }

      const response = await fetch(`/api/tests/coverage?${params.toString()}`);
      const result = await response.json();

      if (!response.ok || !result.success || !result.data) {
        setHasError(true);
        return;
      }

      setData(result.data);
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, ignoreDirs, statsRepo]);

  useEffect(() => {
    fetchCoverageData();
  }, [fetchCoverageData]);

  // Don't render if no test layer is selected or if loading/error
  if (!selectedLayer || isLoading || hasError || !data) {
    return null;
  }

  const getTestData = () => {
    switch (selectedLayer) {
      case "unitTests":
        return data.unit_tests
          ? {
              type: "Unit Tests",
              covered: data.unit_tests.covered || 0,
              total: data.unit_tests.total || 0,
              color: "text-foreground",
              displayType: "percentage",
            }
          : null;
      case "integrationTests":
        return data.integration_tests
          ? {
              type: "Integration Tests",
              covered: data.integration_tests.covered || 0,
              total: data.integration_tests.total || 0,
              color: "text-foreground",
              displayType: "percentage",
            }
          : null;
      case "e2eTests":
        return data.e2e_tests
          ? {
              type: "E2E Tests",
              covered: data.e2e_tests.total_tests || 0,
              total: data.e2e_tests.total_tests || 0,
              color: "text-foreground",
              displayType: "count-only",
            }
          : null;
      default:
        return null;
    }
  };

  const testData = getTestData();
  if (!testData) {
    return null;
  }

  const percentage = testData.total > 0 ? Math.round((testData.covered / testData.total) * 100) : 0;
  const isCountOnly = testData.displayType === "count-only";

  return (
    <div className="bg-background/80 backdrop-blur-sm border rounded-lg p-3 shadow-sm min-w-[200px]">
      <div className="space-y-2">
        <div className={`text-sm font-medium ${testData.color}`}>{testData.type}</div>
        {isCountOnly ? (
          <div className="space-y-1">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Total Tests</span>
              <span className="font-mono">
                {testData.covered} {testData.covered === 1 ? "test" : "tests"}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Coverage</span>
                <span className="font-mono">
                  {testData.covered}/{testData.total}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Percentage</span>
                <span className={`font-mono ${testData.color}`}>{percentage}%</span>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all duration-300 bg-muted-foreground"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

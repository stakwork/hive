"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { TestCoverageData } from "@/types";
import { TestTube } from "lucide-react";
import { useEffect, useState } from "react";

export function TestCoverageCard() {
  const { id: workspaceId, workspace } = useWorkspace();
  const [testCoverage, setTestCoverage] = useState<TestCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Fetch test coverage if workspace has a swarm
  useEffect(() => {
    const fetchCoverage = async () => {
      if (!workspace?.swarmStatus || workspace.swarmStatus !== "ACTIVE") return;

      setCoverageLoading(true);
      try {
        const response = await fetch(`/api/tests/coverage?workspaceId=${workspaceId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            setTestCoverage(result.data);
          }
        }
      } catch (error) {
        console.error("Failed to fetch test coverage:", error);
      } finally {
        setCoverageLoading(false);
      }
    };

    fetchCoverage();
  }, [workspaceId, workspace?.swarmStatus]);

  return (
    <Card data-testid="coverage-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TestTube className="w-4 h-4" />
            Test Coverage
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {coverageLoading ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-10" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-10" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-10" />
            </div>
          </div>
        ) : testCoverage?.unit_tests !== null &&
          testCoverage?.integration_tests !== null &&
          testCoverage?.e2e_tests !== null ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Unit</span>
              <span className="text-sm font-medium">{testCoverage?.unit_tests.percent.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Integration</span>
              <span className="text-sm font-medium">{testCoverage?.integration_tests?.percent.toFixed(1) || 0}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">E2E</span>
              <span className="text-sm font-medium">{testCoverage?.e2e_tests?.percent.toFixed(1) || 0}%</span>
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No coverage data</span>
        )}
      </CardContent>
    </Card>
  );
}

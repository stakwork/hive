"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MetricDisplay } from "@/components/ui/metric-display";
import { TestTube, FunctionSquare, Globe, Target } from "lucide-react";
import { TestCoverageData } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCoverageStore } from "@/stores/useCoverageStore";

export function TestCoverageCard() {
  const { id: workspaceId } = useWorkspace();
  const { ignoreDirs } = useCoverageStore();
  const [data, setData] = useState<TestCoverageData | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [metricType, setMetricType] = useState<"absolute" | "lines">("absolute");

  const fetchTestCoverage = useCallback(async () => {
    if (!workspaceId) {
      setError("No workspace selected");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(undefined);

      const params = new URLSearchParams({ workspaceId });
      if (ignoreDirs) {
        params.set("ignoreDirs", ignoreDirs);
      }

      const response = await fetch(`/api/tests/coverage?${params.toString()}`);
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
  }, [workspaceId, ignoreDirs]);

  useEffect(() => {
    fetchTestCoverage();
  }, [workspaceId, ignoreDirs, fetchTestCoverage]);
  
  const getPercentageColor = (percent: number) => {
    if (percent >= 70) return "text-green-600 border-green-200 bg-green-50";
    if (percent >= 15) return "text-yellow-600 border-yellow-200 bg-yellow-50";
    return "text-red-600 border-red-200 bg-red-50";
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 70) return "bg-green-500";
    if (percent >= 15) return "bg-yellow-500";
    return "bg-red-500";
  };

  if (isLoading) {
    return (
      <Card data-testid="coverage-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>Code coverage analysis from your test suite</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="coverage-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>Code coverage analysis from your test suite</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="coverage-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>Code coverage analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No coverage data available.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="coverage-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <div className="flex items-center gap-1 border rounded-md p-1">
            <Button
              variant={metricType === "absolute" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMetricType("absolute")}
              className="h-7 text-xs"
            >
              Test Count
            </Button>
            <Button
              variant={metricType === "lines" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMetricType("lines")}
              className="h-7 text-xs"
            >
              Line Coverage
            </Button>
          </div>
        </div>
        <CardDescription>Code coverage analysis from your test suite</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Unit Tests Coverage */}
          {data.unit_tests && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <FunctionSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Unit Tests</span>
              </div>

              {metricType === "absolute" ? (
                <MetricDisplay
                  label="Test Coverage"
                  percent={data.unit_tests.percent || 0}
                  covered={data.unit_tests.covered || 0}
                  total={data.unit_tests.total || 0}
                />
              ) : data.unit_tests.total_lines !== undefined ? (
                <MetricDisplay
                  label="Line Coverage"
                  percent={data.unit_tests.line_percent || 0}
                  covered={data.unit_tests.covered_lines || 0}
                  total={data.unit_tests.total_lines || 0}
                />
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  Line coverage data not available
                </div>
              )}
            </div>
          )}

          {/* Integration Tests Coverage */}
          {data.integration_tests && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Integration Tests</span>
              </div>

              {metricType === "absolute" ? (
                <MetricDisplay
                  label="Test Coverage"
                  percent={data.integration_tests.percent || 0}
                  covered={data.integration_tests.covered || 0}
                  total={data.integration_tests.total || 0}
                />
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  Line coverage not available for integration tests
                </div>
              )}
            </div>
          )}

          {/* End to End Tests */}
          {data.e2e_tests && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">End to End Tests</span>
              </div>

              {metricType === "absolute" ? (
                <MetricDisplay
                  label="Test Coverage"
                  percent={data.e2e_tests.percent || 0}
                  covered={data.e2e_tests.covered || 0}
                  total={data.e2e_tests.total || 0}
                />
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  Line coverage not available for E2E tests
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricDisplay } from "@/components/ui/metric-display";
import { TestTube, FunctionSquare, Globe, Target, Shield } from "lucide-react";
import { TestCoverageData } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCoverageStore } from "@/stores/useCoverageStore";
import { MetricDisplayCountOnly } from "../ui/metric-display-count-only";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";

export function TestCoverageCard() {
  const { id: workspaceId, workspace } = useWorkspace();
  const { ignoreDirs, setIgnoreDirs, statsRepo, setStatsRepo } = useCoverageStore();
  const [data, setData] = useState<TestCoverageData | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const hasInitializedIgnoreDirs = useRef(false);

  const currentStatsRepos = statsRepo ? statsRepo.split(",").filter(Boolean) : [];

  const handleStatsRepoToggle = (value: string) => {
    let newRepos = [...currentStatsRepos];
    if (newRepos.includes(value)) {
      newRepos = newRepos.filter((r) => r !== value);
    } else {
      newRepos.push(value);
    }
    setStatsRepo(newRepos.join(","));
  };

  const handleClearStatsRepos = () => {
    setStatsRepo("");
  };

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
      if (hasInitializedIgnoreDirs.current && ignoreDirs) {
        params.set("ignoreDirs", ignoreDirs);
      }
      if (statsRepo) {
        params.set("repo", statsRepo);
      }

      const response = await fetch(`/api/tests/coverage?${params.toString()}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to fetch test coverage");
      }

      if (result.success && result.data) {
        setData(result.data);

        if (!hasInitializedIgnoreDirs.current && result.ignoreDirs !== undefined) {
          setIgnoreDirs(result.ignoreDirs);
          hasInitializedIgnoreDirs.current = true;
        }
      } else {
        setError(result.message || "No coverage data available");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch test coverage");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, ignoreDirs, statsRepo, setIgnoreDirs]);

  useEffect(() => {
    fetchTestCoverage();
  }, [workspaceId, ignoreDirs, statsRepo, fetchTestCoverage]);

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
            {[...Array(4)].map((_, i) => (
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
          <div className="space-y-1.5">
            <CardTitle className="flex items-center space-x-2">
              <TestTube className="h-5 w-5 text-blue-500" />
              <span>Test Coverage</span>
            </CardTitle>
            <CardDescription>Code coverage analysis from your test suite</CardDescription>
          </div>
          {workspace && workspace.repositories && workspace.repositories.length > 1 && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-8 w-[180px] justify-start text-xs font-normal">
                    {currentStatsRepos.length === 0 ? "All Repositories" : `${currentStatsRepos.length} Selected`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[180px]">
                  <DropdownMenuCheckboxItem
                    checked={currentStatsRepos.length === 0}
                    onCheckedChange={handleClearStatsRepos}
                    className="text-xs"
                  >
                    All Repositories
                  </DropdownMenuCheckboxItem>
                  {workspace.repositories.map((r) => {
                    const { owner, repo: parsedRepo } = parseGithubOwnerRepo(r.repositoryUrl);
                    const value = `${owner}/${parsedRepo}`;
                    return (
                      <DropdownMenuCheckboxItem
                        key={r.id}
                        checked={currentStatsRepos.includes(value)}
                        onCheckedChange={() => handleStatsRepoToggle(value)}
                        onSelect={(e) => e.preventDefault()}
                        className="text-xs"
                      >
                        {r.name}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
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

              {data.unit_tests.total_lines !== undefined ? (
                <MetricDisplay
                  label="Line Coverage"
                  percent={data.unit_tests.line_percent || 0}
                  covered={data.unit_tests.covered_lines || 0}
                  total={data.unit_tests.total_lines || 0}
                />
              ) : (
                <div className="text-xs text-muted-foreground py-2">Line coverage data not available</div>
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

              <MetricDisplay
                label="Test Coverage"
                percent={data.integration_tests.percent || 0}
                covered={data.integration_tests.covered || 0}
                total={data.integration_tests.total || 0}
              />
            </div>
          )}

          {/* End to End Tests */}
          {data.e2e_tests && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">End to End Tests</span>
              </div>

              <MetricDisplayCountOnly label="Total Tests" count={data.e2e_tests.total_tests || 0} />
            </div>
          )}

          {/* 3rd Party Mocks */}
          {data.mocks && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">3rd Party Mocks</span>
              </div>

              <MetricDisplay
                label="Mock Coverage"
                percent={data.mocks.percent || 0}
                covered={data.mocks.mocked || 0}
                total={data.mocks.total || 0}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

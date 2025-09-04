"use client";

import { ConnectRepository } from "@/components/ConnectRepository";
import { EmptyState, TaskCard } from "@/components/tasks";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VMConfigSection } from "@/components/vm-config";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { formatRelativeTime } from "@/lib/utils";
import { TestCoverageData } from "@/types";
import {
  Clock,
  GitBranch,
  Github,
  RefreshCw,
  TestTube
} from "lucide-react";
import { useEffect, useState } from "react";
import { GraphComponent } from "./graph";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId } = useWorkspace();
  const { tasks } = useWorkspaceTasks(workspaceId);
  const [testCoverage, setTestCoverage] = useState<TestCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Get the 3 most recent tasks
  const recentTasks = tasks.slice(0, 3);

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

  }, [workspaceId, workspace?.swarmStatus]);



  console.log(workspace, slug);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Welcome to your development workspace."
      />

      {/* Show onboarding if needed */}
      {workspace && !workspace.isCodeGraphSetup && (
        <ConnectRepository workspaceSlug={slug} />
      )}

      {/* Info Cards Grid - All horizontal */}
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        {/* VM Configuration */}
        <VMConfigSection />

        {/* Repository Information Card */}
        {workspace?.repositories && workspace.repositories.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Graph Database
                </CardTitle>
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <Github className="w-3 h-3" />
                  GitHub
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col h-full">
              <div className="flex-1"></div>
              <div className="space-y-3">
                <div className="text-sm font-medium truncate">
                  {workspace.repositories[0].name}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        workspace.repositories[0].status === "SYNCED"
                          ? "default"
                          : workspace.repositories[0].status === "PENDING"
                            ? "secondary"
                            : "destructive"
                      }
                      className="text-xs"
                    >
                      {workspace.repositories[0].status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {workspace.repositories[0].branch}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <RefreshCw className="w-3 h-3" />
                    {formatRelativeTime(workspace.repositories[0].updatedAt)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Test Coverage Card */}
        <Card>
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
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : testCoverage ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Unit</span>
                  <span className="text-sm font-medium">
                    {testCoverage.unit_tests.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Integration</span>
                  <span className="text-sm font-medium">
                    {testCoverage.integration_tests?.percent.toFixed(1) || 0}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">E2E</span>
                  <span className="text-sm font-medium">
                    {testCoverage.e2e_tests?.percent.toFixed(1) || 0}%
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No coverage data</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Tasks Section */}
      {workspace && workspace.isCodeGraphSetup && (
        recentTasks.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Recent Tasks</CardTitle>
              <CardDescription>Your most recently created tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <TaskCard key={task.id} task={task} workspaceSlug={slug} />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState workspaceSlug={slug} />
        )
      )}
      <GraphComponent />
    </div>
  );
}

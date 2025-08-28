"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Github,
  Calendar,
  Activity,
  Code,
  BarChart3,
  Settings,
} from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspaceTasks } from "@/hooks/useWorkspaceTasks";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const { workspace, slug, id: workspaceId } = useWorkspace();
  const { tasks, pagination: pagination } = useWorkspaceTasks(workspaceId);
  const { formData, loadSettings } = useStakgraphStore();
  const [commitCount, setCommitCount] = useState<number | null>(null);
  const [threeWeeksAgo, setThreeWeeksAgo] = useState<number>(
    new Date().getDate(),
  );

  const getNumberOfCommitsOnDefaultBranch = async () => {
    try {
      if (!formData?.repositoryUrl) {
        console.error("Repository URL is missing in formData");
        return null;
      }
      const res = await fetch(
        `/api/github/repository/branch/numofcommits?repoUrl=${formData.repositoryUrl}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!res.ok) throw new Error("Failed to get numofcommits");
      const result = await res.json();
      return result.data.number_of_commits;
    } catch (error) {
      console.error("could not get number of commits", error);
    }
  };

  useEffect(() => {
    const fetchCommits = async () => {
      const numberOfCommits = await getNumberOfCommitsOnDefaultBranch();
      setCommitCount(numberOfCommits);
    };

    if (slug) {
      loadSettings(slug);
    }
    fetchCommits();
    const today = new Date();
    setThreeWeeksAgo(today.getDate() - 21);
  }, [formData?.repositoryUrl, slug, loadSettings]); // Empty dependency array ensures this runs once on mount

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Welcome to your development workspace."
      />

      {/* Onboarding Card - Only show if CodeGraph is not set up */}
      {workspace && !workspace.isCodeGraphSetup && (
        <ConnectRepository workspaceSlug={slug} />
      )}

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tasks</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pagination?.totalCount}</div>
            <p className="text-xs text-muted-foreground">
              +
              {
                tasks.filter(
                  (task) =>
                    task.status === "IN_PROGRESS" &&
                    new Date(task.createdAt).getDate() > threeWeeksAgo,
                ).length
              }{" "}
              from last week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Code Commits</CardTitle>
            <Github className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {commitCount == null ? "Loading number of commits" : commitCount}
            </div>
            <p className="text-xs text-muted-foreground">+12 from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Sprint Progress
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">73%</div>
            <p className="text-xs text-muted-foreground">+5% from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dependencies</CardTitle>
            <Code className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">89</div>
            <p className="text-xs text-muted-foreground">+2 from last month</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Tasks</CardTitle>
            <CardDescription>Your most recently updated tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Update user authentication
                  </p>
                  <p className="text-xs text-muted-foreground">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Fix sidebar navigation</p>
                  <p className="text-xs text-muted-foreground">4 hours ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Optimize database queries
                  </p>
                  <p className="text-xs text-muted-foreground">1 day ago</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Activity className="h-4 w-4 mr-2" />
                Create new task
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Github className="h-4 w-4 mr-2" />
                Connect repository
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Calendar className="h-4 w-4 mr-2" />
                Schedule meeting
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Settings className="h-4 w-4 mr-2" />
                Project settings
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

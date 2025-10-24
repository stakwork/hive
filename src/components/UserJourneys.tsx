"use client";

import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Artifact, BrowserContent } from "@/lib/chat";
import { Check, Copy, ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useModal } from "./modals/ModlaProvider";

interface UserJourneyTask {
  id: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "BLOCKED";
  workflowStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | "HALTED" | "FAILED" | null;
  testFilePath: string | null;
  testFileUrl: string | null;
  stakworkProjectId: number | null;
  createdAt: string;
  repository?: {
    id: string;
    name: string;
    repositoryUrl: string;
  };
}

export default function UserJourneys() {
  const { id, slug, workspace } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);
  const [userJourneyTasks, setUserJourneyTasks] = useState<UserJourneyTask[]>([]);
  const [fetchingTasks, setFetchingTasks] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimedPodId, setClaimedPodId] = useState<string | null>(null);
  const [checkingGraphStatus, setCheckingGraphStatus] = useState(false);
  const open = useModal();

  const fetchUserJourneyTasks = useCallback(async () => {
    if (!id) return;

    try {
      setFetchingTasks(true);
      const response = await fetch(`/api/tasks?workspaceId=${id}&sourceType=USER_JOURNEY&limit=100`);

      if (!response.ok) {
        console.error("Failed to fetch user journey tasks");
        return;
      }

      const result = await response.json();
      if (result.success && result.data) {
        setUserJourneyTasks(result.data);
      }
    } catch (error) {
      console.error("Error fetching user journey tasks:", error);
    } finally {
      setFetchingTasks(false);
    }
  }, [id]);

  // Check if test files exist in graph for non-DONE tasks
  const checkTestFilesInGraph = useCallback(async () => {
    if (!slug || userJourneyTasks.length === 0) return;

    const pendingTasks = userJourneyTasks.filter(task => task.status !== "DONE" && task.testFilePath);
    if (pendingTasks.length === 0) return;

    try {
      setCheckingGraphStatus(true);
      // Fetch all E2E tests from graph
      const response = await fetch(`/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`);

      if (!response.ok) {
        console.error("Failed to check graph for test files");
        return;
      }

      const result = await response.json();
      if (result.success && result.data) {
        const graphTestFiles = new Set(result.data.map((test: any) => test.properties.file));

        // Check each pending task
        for (const task of pendingTasks) {
          // Extract file path from repository URL for comparison
          const fileInGraph = Array.from(graphTestFiles).some((graphFile) => {
            return String(graphFile).includes(task.testFilePath || "");
          });

          if (fileInGraph) {
            // Update task status to DONE
            try {
              await fetch(`/api/tasks/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "DONE",
                  workflowStatus: "COMPLETED",
                }),
              });
            } catch (error) {
              console.error(`Error updating task ${task.id}:`, error);
            }
          }
        }

        // Refetch tasks to get updated statuses
        await fetchUserJourneyTasks();
      }
    } catch (error) {
      console.error("Error checking test files in graph:", error);
    } finally {
      setCheckingGraphStatus(false);
    }
  }, [slug, userJourneyTasks, fetchUserJourneyTasks]);

  useEffect(() => {
    if (!frontend) {
      fetchUserJourneyTasks();
    }
  }, [frontend, fetchUserJourneyTasks]);

  // Shared function to drop the pod
  const dropPod = useCallback(
    async (useBeacon = false) => {
      if (!id || !claimedPodId) return;

      const dropUrl = `/api/pool-manager/drop-pod/${id}?latest=true&podId=${claimedPodId}`;

      try {
        if (useBeacon) {
          // Use sendBeacon for reliable delivery when page is closing
          const blob = new Blob([JSON.stringify({})], { type: "application/json" });
          navigator.sendBeacon(dropUrl, blob);
        } else {
          // Use regular fetch for normal scenarios
          await fetch(dropUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });
        }
      } catch (error) {
        console.error("Error dropping pod:", error);
      }
    },
    [id, claimedPodId],
  );

  // Drop pod when component unmounts or when navigating away
  useEffect(() => {
    return () => {
      if (frontend) {
        dropPod();
      }
    };
  }, [frontend, dropPod]);

  // Drop pod when browser/tab closes or page refreshes
  useEffect(() => {
    if (!frontend) return;

    const handleBeforeUnload = () => {
      dropPod(true);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [frontend, dropPod]);

  const handleCopyTitle = async (title: string, taskId: string) => {
    await navigator.clipboard.writeText(title);
    setCopiedId(taskId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCloseBrowser = () => {
    // Close iframe immediately for better UX
    setFrontend(null);
    // Drop pod in background (no await)
    dropPod();
    // Clear podId
    setClaimedPodId(null);
  };

  const handleCreateUserJourney = async () => {
    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`/api/pool-manager/claim-pod/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to claim pod:", errorData);

        // Show error message to user
        toast({
          variant: "destructive",
          title: "Unable to Create User Journey",
          description: "No virtual machines are available right now. Please try again later.",
        });
        return;
      }

      const data = await response.json();
      console.log("Pod claimed successfully:", data);

      if (data.frontend) {
        setFrontend(data.frontend);
        setClaimedPodId(data.podId);
      }
    } catch (error) {
      console.error("Error claiming pod:", error);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to connect to the service. Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveUserJourneyTest = async (filename: string, generatedCode: string) => {
    try {
      console.log("Saving user journey:", filename, generatedCode);

      // Extract title from filename (remove .spec.ts and format)
      const title = filename
        .replace(/\.spec\.ts$/, "")
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      const response = await fetch("/api/stakwork/user-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: generatedCode,
          workspaceId: id,
          title: title,
          testName: filename,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to save user journey:", errorData);
        toast({
          variant: "destructive",
          title: "Failed to Save",
          description: "Unable to save user journey test. Please try again.",
        });
        return;
      }

      const data = await response.json();
      console.log("User journey saved successfully:", data);

      if (data.task) {
        toast({
          title: "User Journey Created",
          description: `Task "${title}" has been created and is now in progress.`,
        });

        // Refetch tasks to show the new one
        await fetchUserJourneyTasks();
      }
    } catch (error) {
      console.error("Error saving user journey:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      });
    }
  };

  const getStatusBadge = (status: string, workflowStatus: string | null) => {
    if (status === "DONE") {
      return <Badge variant="default" className="bg-green-600 hover:bg-green-700">🟢 Merged</Badge>;
    } else if (status === "IN_PROGRESS") {
      return <Badge variant="default" className="bg-red-600 hover:bg-red-700">🔴 Recording</Badge>;
    } else if (status === "TODO") {
      return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700">🟡 Pending Review</Badge>;
    }
    return <Badge variant="secondary">{status}</Badge>;
  };

  // Create artifacts array for BrowserArtifactPanel when frontend is defined
  const browserArtifacts: Artifact[] = frontend
    ? [
        {
          id: "frontend-preview",
          messageId: "",
          type: "BROWSER",
          content: { url: frontend } as BrowserContent,
          icon: "Code",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Journeys</h1>
        </div>
        {frontend ? (
          <Button variant="ghost" size="sm" onClick={handleCloseBrowser} className="h-8 w-8 p-0">
            ✕
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={checkTestFilesInGraph}
              disabled={checkingGraphStatus || fetchingTasks}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${checkingGraphStatus ? 'animate-spin' : ''}`} />
              Check Status
            </Button>
            <Button className="flex items-center gap-2" onClick={handleCreateUserJourney} disabled={isLoading}>
              <Plus className="w-4 h-4" />
              Create User Journey
            </Button>
          </div>
        )}
      </div>

      {frontend ? (
        <div className="h-[600px] border rounded-lg overflow-hidden">
          <BrowserArtifactPanel artifacts={browserArtifacts} ide={false} onUserJourneySave={saveUserJourneyTest} />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>User Journey Tests</CardTitle>
              <CardDescription>Track your recorded user journey tests and their status</CardDescription>
            </CardHeader>
            <CardContent>
              {fetchingTasks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : userJourneyTasks.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Test File</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userJourneyTasks.map((task) => (
                        <TableRow key={task.id}>
                          <TableCell className="font-medium">{task.title}</TableCell>
                          <TableCell>{getStatusBadge(task.status, task.workflowStatus)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{task.testFilePath || "N/A"}</span>
                              {task.testFileUrl && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.open(task.testFileUrl!, "_blank")}
                                  className="h-6 w-6 p-0"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(task.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCopyTitle(task.title, task.id)}
                              className="h-8 w-8 p-0"
                              title="Copy title"
                            >
                              {copiedId === task.id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    No user journey tests yet. Create one to get started!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

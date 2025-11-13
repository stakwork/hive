"use client";

import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Artifact, BrowserContent } from "@/lib/chat";
import { Check, Copy, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, Loader2, Plus, Play } from "lucide-react";
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
    branch: string;
  };
  prArtifact?: {
    id: string;
    type: string;
    content: {
      url: string;
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    };
  } | null;
}

interface E2eTestNode {
  node_type: string;
  ref_id: string;
  properties: {
    name: string;
    file: string;
    body: string;
    test_kind: string;
    node_key: string;
    start: number;
    end: number;
    token_count: number;
  };
}

interface UserJourneyRow {
  id: string;
  title: string;
  type: "GRAPH_NODE" | "TASK";
  testFilePath: string | null;
  testFileUrl: string | null;
  createdAt: string;
  task?: UserJourneyTask;
  graphNode?: E2eTestNode;
}

export default function UserJourneys() {
  const { id, slug, workspace } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);
  const [userJourneyTasks, setUserJourneyTasks] = useState<UserJourneyTask[]>([]);
  const [e2eTestsGraph, setE2eTestsGraph] = useState<E2eTestNode[]>([]);
  const [fetchingTasks, setFetchingTasks] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimedPodId, setClaimedPodId] = useState<string | null>(null);
  const [hidePending, setHidePending] = useState(false);
  // Replay-related state
  const [replayTestCode, setReplayTestCode] = useState<string | null>(null); // Test code to replay
  const [replayTitle, setReplayTitle] = useState<string | null>(null); // Title of test being replayed
  const [isReplayingTask, setIsReplayingTask] = useState<string | null>(null); // ID of task being replayed (for loading state)
  const open = useModal();

  const fetchUserJourneyTasks = useCallback(async () => {
    if (!id) return;

    try {
      setFetchingTasks(true);
      const response = await fetch(`/api/tasks?workspaceId=${id}&sourceType=USER_JOURNEY&limit=100&includeLatestMessage=true`);

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

  const fetchE2eTestsFromGraph = useCallback(async () => {
    if (!slug) return;

    try {
      const response = await fetch(`/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`);

      if (!response.ok) {
        console.error("Failed to fetch E2E tests from graph");
        return;
      }

      const result = await response.json();
      if (result.success && result.data && Array.isArray(result.data)) {
        setE2eTestsGraph(result.data);
      }
    } catch (error) {
      console.error("Error fetching E2E tests from graph:", error);
    }
  }, [slug]);

  useEffect(() => {
    if (!frontend) {
      fetchUserJourneyTasks();
      fetchE2eTestsFromGraph();
    }
  }, [frontend, fetchUserJourneyTasks, fetchE2eTestsFromGraph]);

  // Helper to construct GitHub URL for graph node files
  const getGithubUrlForGraphNode = (node: E2eTestNode): string | null => {
    const repo = workspace?.repositories?.[0];
    if (!repo) return null;
    const branch = repo.branch || 'main';
    return `${repo.repositoryUrl}/blob/${branch}/${node.properties.file}`;
  };

  // Filter out tasks with merged PRs (they'll appear as graph nodes instead)
  const pendingTasks = userJourneyTasks.filter(task =>
    !task.prArtifact?.content ||
    task.prArtifact.content.status !== "DONE"
  );

  // Convert graph nodes to rows (always show as "Live")
  const graphRows: UserJourneyRow[] = e2eTestsGraph.map(node => ({
    id: node.ref_id,
    title: node.properties.name,
    type: "GRAPH_NODE" as const,
    testFilePath: node.properties.file,
    testFileUrl: getGithubUrlForGraphNode(node),
    createdAt: new Date().toISOString(), // Graph nodes don't have timestamps
    graphNode: node,
  }));

  // Convert pending tasks to rows
  const taskRows: UserJourneyRow[] = pendingTasks.map(task => ({
    id: task.id,
    title: task.title,
    type: "TASK" as const,
    testFilePath: task.testFilePath,
    testFileUrl: task.testFileUrl,
    createdAt: task.createdAt,
    task: task,
  }));

  // Combine and sort by created date (newest first)
  const allRows = [...graphRows, ...taskRows].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Apply hide pending filter
  const filteredRows = hidePending
    ? allRows.filter(row =>
        row.type === "GRAPH_NODE" || // Always show graph nodes
        row.task?.status === "DONE"   // Only show completed tasks
      )
    : allRows;

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

  const handleCopyCode = async (row: UserJourneyRow) => {
    let code: string;

    if (row.type === "GRAPH_NODE") {
      // For graph nodes, use the test body directly
      code = row.graphNode!.properties.body;
    } else {
      // For tasks, try to find matching test in graph first
      const graphTest = e2eTestsGraph.find(
        (t) =>
          t.properties.file === row.task!.testFilePath ||
          t.properties.file.endsWith(row.task!.testFilePath || "")
      );
      // Fall back to task title if not found in graph
      code = graphTest?.properties.body || row.task!.title;
    }

    await navigator.clipboard.writeText(code);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getTestFileUrl = (task: UserJourneyTask): string | null => {
    // Prefer constructing URL dynamically from repository data (source of truth)
    if (task.repository?.repositoryUrl && task.testFilePath) {
      const branch = task.repository.branch || 'main';

      // Remove owner/repo prefix from path if present (e.g., "stakwork/hive/src/..." -> "src/...")
      let path = task.testFilePath;
      const pathParts = path.split('/');

      // If path starts with owner/repo that matches the repository URL, strip it
      if (pathParts.length >= 3 &&
          task.repository.repositoryUrl.toLowerCase().includes(`/${pathParts[0]}/${pathParts[1]}`.toLowerCase())) {
        path = pathParts.slice(2).join('/');
      }

      return `${task.repository.repositoryUrl}/blob/${branch}/${path}`;
    }

    // Fallback to stored URL only if we can't construct it
    return task.testFileUrl;
  };

  // Fetch test code from ChatMessages (fast) or Graph API (fallback for old migrated tests)
  const fetchTestCode = async (task: UserJourneyTask): Promise<string | null> => {
    try {
      // Path 1: Try ChatMessages first (works for newly recorded tests)
      // This is fast and works immediately after recording
      const messagesResponse = await fetch(`/api/tasks/${task.id}/messages`);

      if (messagesResponse.ok) {
        const result = await messagesResponse.json();
        if (result.success && result.data?.messages && result.data.messages.length > 0) {
          // First message contains the test code
          const testCode = result.data.messages[0].message;
          if (testCode && testCode.trim().length > 0) {
            return testCode;
          }
        }
      }

      // Path 2: Fallback to Graph API (for old migrated tests that don't have ChatMessages)
      // This works for tests that were created before we added ChatMessage storage
      const graphResponse = await fetch(
        `/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`
      );

      if (!graphResponse.ok) {
        console.error("Failed to fetch E2E tests from graph");
        return null;
      }

      const graphResult = await graphResponse.json();
      if (graphResult.success && graphResult.data && Array.isArray(graphResult.data)) {
        // Find the matching test by comparing task.testFilePath with node.properties.file
        const matchingTest = graphResult.data.find(
          (node: any) => node.properties?.file === task.testFilePath
        );

        if (matchingTest && matchingTest.properties?.body) {
          return matchingTest.properties.body;
        }

        console.error("No matching test found in graph for testFilePath:", task.testFilePath);
        console.error("Available test files:", graphResult.data.map((n: any) => n.properties?.file));
      }

      return null;
    } catch (error) {
      console.error("Error fetching test code:", error);
      return null;
    }
  };

  const handleCloseBrowser = () => {
    // Close iframe immediately for better UX
    setFrontend(null);
    // Drop pod in background (no await)
    dropPod();
    // Clear podId and replay state
    setClaimedPodId(null);
    setReplayTestCode(null);
    setReplayTitle(null);
    setIsReplayingTask(null);
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

  const handleReplay = async (row: UserJourneyRow) => {
    // Check if services are set up
    if (workspace?.poolState !== "COMPLETE") {
      open("ServicesWizard");
      return;
    }

    try {
      setIsReplayingTask(row.id);

      // Step 1: Get test code
      let testCode: string | null = null;

      if (row.type === "GRAPH_NODE") {
        // For graph nodes, use the test body directly
        testCode = row.graphNode!.properties.body;
      } else {
        // For tasks, fetch test code
        testCode = await fetchTestCode(row.task!);
      }

      if (!testCode) {
        toast({
          variant: "destructive",
          title: "Test Code Not Found",
          description: "Unable to retrieve test code for this journey.",
        });
        setIsReplayingTask(null);
        return;
      }

      // Step 2: Claim a pod
      const response = await fetch(`/api/pool-manager/claim-pod/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Unable to Start Replay",
          description: "No virtual machines are available right now. Please try again later.",
        });
        setIsReplayingTask(null);
        return;
      }

      const data = await response.json();

      // Step 3: Set state to trigger replay
      if (data.frontend) {
        setReplayTestCode(testCode);
        setReplayTitle(row.title);
        setFrontend(data.frontend);
        setClaimedPodId(data.podId);
      }
    } catch (error) {
      console.error("Error starting replay:", error);
      toast({
        variant: "destructive",
        title: "Replay Error",
        description: "An unexpected error occurred. Please try again.",
      });
      setIsReplayingTask(null);
    }
  };

  const saveUserJourneyTest = async (filename: string, generatedCode: string) => {
    try {
      // Use filename directly as title for predictability and consistency
      const title = filename || "User Journey Test";

      const payload = {
        message: generatedCode,
        workspaceId: id,
        title: title,
        testName: filename,
      };

      const response = await fetch("/api/stakwork/user-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to save user journey:", errorData);
        toast({
          variant: "destructive",
          title: "Failed to Save",
          description: errorData.error || "Unable to save user journey test. Please try again.",
        });
        return;
      }

      const data = await response.json();

      if (data.task) {
        toast({
          title: "User Journey Created",
          description: `Task "${title}" has been created and is now in progress.`,
        });

        // Refetch tasks to show the new one
        await fetchUserJourneyTasks();

        // Close the browser panel and release the pod
        handleCloseBrowser();
      } else {
        toast({
          title: "Test Saved",
          description: "Test was saved but task creation may have failed.",
        });

        // Still close the browser panel even if task creation failed
        handleCloseBrowser();
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

  const getStatusBadge = (row: UserJourneyRow) => {
    // Graph nodes always show "Live" badge
    if (row.type === "GRAPH_NODE") {
      return (
        <Badge
          variant="secondary"
          className="h-5 border-[#10b981]/30"
          style={{ backgroundColor: "#10b981", color: "white" }}
        >
          Live
        </Badge>
      );
    }

    // For tasks, show PR or workflow badges
    const task = row.task!;

    // Show PR badge if available
    if (task.prArtifact?.content) {
      const prStatus = task.prArtifact.content.status;
      return (
        <a
          href={task.prArtifact.content.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge
            variant="secondary"
            className={`gap-1 h-5 ${
              prStatus === "IN_PROGRESS"
                ? "border-[#238636]/30"
                : prStatus === "CANCELLED"
                  ? "border-[#6e7681]/30"
                  : "bg-gray-100 text-gray-800 border-gray-200"
            }`}
            style={
              prStatus === "IN_PROGRESS"
                ? { backgroundColor: "#238636", color: "white" }
                : prStatus === "CANCELLED"
                  ? { backgroundColor: "#6e7681", color: "white" }
                  : undefined
            }
          >
            {prStatus === "CANCELLED" ? (
              <GitPullRequestClosed className="w-3 h-3" />
            ) : (
              <GitPullRequest className="w-3 h-3" />
            )}
            {prStatus === "IN_PROGRESS"
              ? "Open"
              : "Closed"}
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </Badge>
        </a>
      );
    }

    // Fallback to workflow status badge
    if (task.workflowStatus === "COMPLETED") {
      return <Badge variant="default" className="bg-green-600 hover:bg-green-700">Completed</Badge>;
    }

    if (task.workflowStatus === "FAILED" || task.workflowStatus === "HALTED" || task.workflowStatus === "ERROR") {
      return <Badge variant="default" className="bg-red-600 hover:bg-red-700">Failed</Badge>;
    }

    if (task.workflowStatus === "IN_PROGRESS" || task.workflowStatus === "PENDING") {
      return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700">In Progress</Badge>;
    }

    return <Badge variant="secondary">Pending</Badge>;
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
          <Button className="flex items-center gap-2" onClick={handleCreateUserJourney} disabled={isLoading}>
            <Plus className="w-4 h-4" />
            Create User Journey
          </Button>
        )}
      </div>

      {frontend ? (
        <div className="h-[600px] border rounded-lg overflow-hidden">
          <BrowserArtifactPanel
            artifacts={browserArtifacts}
            ide={false}
            workspaceId={id || workspace?.id}
            onUserJourneySave={saveUserJourneyTest}
            externalTestCode={replayTestCode}
            externalTestTitle={replayTitle}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label htmlFor="hide-pending" className="text-sm text-muted-foreground cursor-pointer">
                    Hide pending recordings
                  </label>
                  <Switch
                    id="hide-pending"
                    checked={hidePending}
                    onCheckedChange={setHidePending}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {fetchingTasks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRows.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-[80px]">Replay</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Test File</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.title}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleReplay(row)}
                              disabled={isReplayingTask === row.id}
                              className="h-8 w-8 p-0"
                              title="Replay test"
                            >
                              {isReplayingTask === row.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell>{getStatusBadge(row)}</TableCell>
                          <TableCell>
                            {row.type === "GRAPH_NODE" || row.testFileUrl ? (
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">{row.testFilePath || "N/A"}</span>
                                {row.testFileUrl && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => window.open(row.testFileUrl!, "_blank")}
                                    className="h-6 w-6 p-0"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">{row.testFilePath || "N/A"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(row.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCopyCode(row)}
                              className="h-8 w-8 p-0"
                              title="Copy test code"
                            >
                              {copiedId === row.id ? (
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
                    {hidePending && allRows.length > 0
                      ? "No completed tests to display. Toggle off to see all tests."
                      : "No E2E tests yet. Create a user journey to get started!"}
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

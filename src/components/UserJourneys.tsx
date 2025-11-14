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
import { Check, Copy, ExternalLink, Loader2, Plus, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useModal } from "./modals/ModlaProvider";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";

interface BadgeMetadata {
  type: "PR" | "WORKFLOW" | "LIVE";
  text: string;
  url?: string;
  color: string;
  borderColor: string;
  icon?: "GitPullRequest" | "GitMerge" | "GitPullRequestClosed" | null;
  hasExternalLink?: boolean;
}

interface UserJourneyRow {
  id: string;
  title: string;
  type: "GRAPH_NODE" | "TASK";
  testFilePath: string | null;
  testFileUrl: string | null;
  createdAt: string;
  badge: BadgeMetadata;
  task?: {
    description: string | null;
    status: string;
    workflowStatus: string | null;
    stakworkProjectId: number | null;
    repository?: {
      id: string;
      name: string;
      repositoryUrl: string;
      branch: string;
    };
  };
  graphNode?: {
    body: string;
    testKind: string;
  };
}

export default function UserJourneys() {
  const { id, slug, workspace } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);
  const [userJourneys, setUserJourneys] = useState<UserJourneyRow[]>([]);
  const [fetchingJourneys, setFetchingJourneys] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimedPodId, setClaimedPodId] = useState<string | null>(null);
  const [hidePending, setHidePending] = useState(false);
  // Replay-related state
  const [replayTestCode, setReplayTestCode] = useState<string | null>(null); // Test code to replay
  const [replayTitle, setReplayTitle] = useState<string | null>(null); // Title of test being replayed
  const [isReplayingTask, setIsReplayingTask] = useState<string | null>(null); // ID of task being replayed (for loading state)
  const open = useModal();

  const fetchUserJourneys = useCallback(async () => {
    if (!slug) return;

    try {
      setFetchingJourneys(true);
      const response = await fetch(`/api/workspaces/${slug}/user-journeys`);

      if (!response.ok) {
        console.error("Failed to fetch user journeys");
        return;
      }

      const result = await response.json();
      if (result.success && result.data) {
        setUserJourneys(result.data);
      }
    } catch (error) {
      console.error("Error fetching user journeys:", error);
    } finally {
      setFetchingJourneys(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!frontend) {
      fetchUserJourneys();
    }
  }, [frontend, fetchUserJourneys]);

  // Apply hide pending filter
  const filteredRows = hidePending
    ? userJourneys.filter(row =>
        row.type === "GRAPH_NODE" || // Always show graph nodes
        row.task?.status === "DONE"   // Only show completed tasks
      )
    : userJourneys;

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
      code = row.graphNode!.body;
    } else {
      // For tasks, fetch the test code
      code = await fetchTestCode(row) || row.title;
    }

    await navigator.clipboard.writeText(code);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Fetch test code from ChatMessages (fast) or fallback to title
  const fetchTestCode = async (row: UserJourneyRow): Promise<string | null> => {
    if (!row.task) return null;

    try {
      const messagesResponse = await fetch(`/api/tasks/${row.id}/messages`);

      if (messagesResponse.ok) {
        const result = await messagesResponse.json();
        if (result.success && result.data?.messages && result.data.messages.length > 0) {
          const testCode = result.data.messages[0].message;
          if (testCode && testCode.trim().length > 0) {
            return testCode;
          }
        }
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
        testCode = row.graphNode!.body;
      } else {
        // For tasks, fetch test code
        testCode = await fetchTestCode(row);
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

        // Refetch journeys to show the new one
        await fetchUserJourneys();

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

  const renderBadge = (badge: BadgeMetadata) => {
    // Use PRStatusBadge component for PR badges
    if (badge.type === "PR" && badge.url) {
      // Map badge text to status
      const status =
        badge.text === "Open"
          ? "IN_PROGRESS"
          : badge.text === "Merged"
            ? "DONE"
            : badge.text === "Closed"
              ? "CANCELLED"
              : "IN_PROGRESS";

      return (
        <PRStatusBadge
          url={badge.url}
          status={status as "IN_PROGRESS" | "DONE" | "CANCELLED"}
        />
      );
    }

    // Render other badge types (LIVE, WORKFLOW) as before
    return (
      <Badge
        variant="secondary"
        className="h-5"
        style={{
          backgroundColor: badge.color,
          color: "white",
          borderColor: badge.borderColor,
        }}
      >
        {badge.text}
      </Badge>
    );
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
              {fetchingJourneys ? (
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
                          <TableCell>{renderBadge(row.badge)}</TableCell>
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
                    {hidePending && userJourneys.length > 0
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

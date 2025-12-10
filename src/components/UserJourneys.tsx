"use client";

import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Artifact, BrowserContent } from "@/lib/chat";
import { Archive, ExternalLink, Loader2, Plus, Play, PlayCircle, Eye, ArrowLeft } from "lucide-react";
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
  testFilePath: string | null;
  testFileUrl: string | null;
  createdAt: string;
  hasVideo: boolean;
  badge: BadgeMetadata;
  task: {
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
}

interface UserJourneysProps {
  onBrowserModeChange?: (isOpen: boolean) => void;
}

export default function UserJourneys({ onBrowserModeChange }: UserJourneysProps) {
  const { id, slug, workspace } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);
  const [userJourneys, setUserJourneys] = useState<UserJourneyRow[]>([]);
  const [fetchingJourneys, setFetchingJourneys] = useState(false);
  const [claimedPodId, setClaimedPodId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  // Filter state (defaults: show pending, hide failed)
  const [showPendingTasks, setShowPendingTasks] = useState(true);
  const [showFailedTasks, setShowFailedTasks] = useState(false);

  // Replay-related state
  const [replayTestCode, setReplayTestCode] = useState<string | null>(null);
  const [replayTitle, setReplayTitle] = useState<string | null>(null);
  const [isReplayingTask, setIsReplayingTask] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "video">("table");
  const [activeVideoData, setActiveVideoData] = useState<{
    url: string;
    title: string;
    taskId: string;
  } | null>(null);
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
        console.log("[UserJourneys] Received data:", result.data.map((t: UserJourneyRow) => ({ id: t.id, title: t.title, hasVideo: t.hasVideo })));
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

  // Notify parent when browser mode changes
  useEffect(() => {
    onBrowserModeChange?.(!!frontend);
  }, [frontend, onBrowserModeChange]);

  // Updated filter logic
  const filteredRows = userJourneys.filter((row) => {
    // Filter out pending tasks if toggled off
    if (!showPendingTasks) {
      const isPending = row.task.status === "IN_PROGRESS" && !row.badge.url;
      if (isPending) return false;
    }

    // Filter out failed workflows without PR if toggled off (default)
    if (!showFailedTasks) {
      const isFailed = ["FAILED", "ERROR", "HALTED"].includes(row.task.workflowStatus || "");
      const hasNoPR = !row.badge.url;
      if (isFailed && hasNoPR) return false;
    }

    return true;
  });

  // Shared function to drop the pod
  const dropPod = useCallback(
    async (useBeacon = false) => {
      if (!id || !claimedPodId) return;

      const dropUrl = `/api/pool-manager/drop-pod/${id}?latest=true&podId=${claimedPodId}`;

      try {
        if (useBeacon) {
          const blob = new Blob([JSON.stringify({})], { type: "application/json" });
          navigator.sendBeacon(dropUrl, blob);
        } else {
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

  const handleArchive = async (row: UserJourneyRow) => {
    try {
      setArchivingId(row.id);

      const response = await fetch(`/api/tasks/${row.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          archived: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to archive task");
      }

      toast("Test Archived", { description: "The test has been archived successfully." });

      // Refresh the list
      await fetchUserJourneys();
    } catch (error) {
      console.error("Error archiving test:", error);
      toast.error("Archive Failed", { description: "Unable to archive the test. Please try again." });
    } finally {
      setArchivingId(null);
    }
  };

  const handleCloseBrowser = () => {
    setFrontend(null);
    dropPod();
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

        toast.error("Unable to Create User Journey", {
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
      toast.error("Connection Error", { description: "Unable to connect to the service. Please try again later." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplay = async (row: UserJourneyRow) => {
    try {
      setIsReplayingTask(row.id);

      // First, check if video artifact already exists
      const messagesResponse = await fetch(`/api/tasks/${row.id}/messages`);
      if (messagesResponse.ok) {
        const result = await messagesResponse.json();
        const messages = result.data?.messages || [];

        // Look for MEDIA artifact with video
        for (const message of messages) {
          if (message.artifacts) {
            const videoArtifact = message.artifacts.find(
              (artifact: any) =>
                artifact.type === "MEDIA" && artifact.content?.mediaType === "video" && artifact.content?.s3Key,
            );

            if (videoArtifact) {
              // Video artifact exists, fetch fresh presigned URL
              try {
                const urlResponse = await fetch(`/api/tasks/${row.id}/artifacts/${videoArtifact.id}/url`);
                if (urlResponse.ok) {
                  const urlData = await urlResponse.json();
                  setActiveVideoData({
                    url: urlData.url,
                    title: row.title,
                    taskId: row.id,
                  });
                  setViewMode("video");
                  setIsReplayingTask(null);
                  return;
                } else {
                  console.error("Failed to fetch fresh video URL");
                }
              } catch (error) {
                console.error("Error fetching fresh video URL:", error);
              }
            }
          }
        }
      }

      // No video found, check if pool is ready before executing new test
      if (workspace?.poolState !== "COMPLETE") {
        open("ServicesWizard");
        setIsReplayingTask(null);
        return;
      }

      // No existing video, trigger new test execution
      const response = await fetch(`/api/user-journeys/${row.id}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.error || "Failed to start test", {
          description: error.details || "Unable to start test execution. Please try again later.",
        });
        setIsReplayingTask(null);
        return;
      }

      const data = await response.json();

      if (data.success) {
        toast.success("Test Execution Started", {
          description: "The test is now running on a pod. You will be notified when it completes.",
        });

        // Optionally open pod frontend for monitoring
        if (data.data.frontendUrl) {
          window.open(data.data.frontendUrl, "_blank");
        }

        // Refresh the list to show updated status
        await fetchUserJourneys();
      }
    } catch (error) {
      console.error("Error in handleReplay:", error);
      toast.error("Replay Error", { description: "An unexpected error occurred. Please try again." });
    } finally {
      setIsReplayingTask(null);
    }
  };

  const saveUserJourneyTest = async (testName: string, generatedCode: string) => {
    try {
      const title = testName || "User Journey Test";

      const payload = {
        message: generatedCode,
        workspaceId: id,
        title: title,
        testName: testName,
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
        toast.error("Failed to Save", {
          description: errorData.error || "Unable to save user journey test. Please try again.",
        });
        return;
      }

      const data = await response.json();

      if (data.task) {
        toast.success("User Journey Created", {
          description: `Task "${title}" has been created and is now in progress.`,
        });

        await fetchUserJourneys();
        handleCloseBrowser();
      } else {
        toast("Test Saved", { description: "Test was saved but task creation may have failed." });

        handleCloseBrowser();
      }
    } catch (error) {
      console.error("Error saving user journey:", error);
      toast.error("Error", { description: "An unexpected error occurred. Please try again." });
    }
  };

  const renderVideoView = () => {
    if (!activeVideoData) return null;

    return (
      <Card>
        <CardContent className="p-0">
          {/* Header with back button */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setViewMode("table");
                  setActiveVideoData(null);
                }}
                className="h-8"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Tests
              </Button>
              <h2 className="text-lg font-semibold">{activeVideoData.title}</h2>
            </div>
          </div>

          {/* Main content area */}
          <div className="flex items-center justify-center bg-black" style={{ height: "calc(100vh - 250px)" }}>
            <video
              key={activeVideoData.url}
              controls
              autoPlay
              className="max-w-full max-h-full"
              src={activeVideoData.url}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderBadge = (badge: BadgeMetadata) => {
    // Use PRStatusBadge component for PR badges
    if (badge.type === "PR" && badge.url) {
      const status =
        badge.text === "Open"
          ? "IN_PROGRESS"
          : badge.text === "Merged"
            ? "DONE"
            : badge.text === "Closed"
              ? "CANCELLED"
              : "IN_PROGRESS";

      return <PRStatusBadge url={badge.url} status={status as "IN_PROGRESS" | "DONE" | "CANCELLED"} />;
    }

    // Render other badge types (LIVE, WORKFLOW)
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
    <div className="space-y-6">
      {viewMode === "video" ? (
        renderVideoView()
      ) : frontend ? (
        <div className="h-[calc(100vh-120px)] border rounded-lg overflow-hidden">
          <BrowserArtifactPanel
            artifacts={browserArtifacts}
            ide={false}
            workspaceId={id || workspace?.id}
            onUserJourneySave={saveUserJourneyTest}
            externalTestCode={replayTestCode}
            externalTestTitle={replayTitle}
            onClose={handleCloseBrowser}
          />
        </div>
      ) : (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-end gap-4 mb-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Eye className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuCheckboxItem checked={showPendingTasks} onCheckedChange={setShowPendingTasks}>
                    Pending Tasks
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={showFailedTasks} onCheckedChange={setShowFailedTasks}>
                    Failed Tasks
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="flex items-center gap-2" onClick={handleCreateUserJourney} disabled={isLoading}>
                <Plus className="w-4 h-4" />
                Create User Journey
              </Button>
            </div>
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
                      <TableHead className="w-[100px]">Archive</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.title}</TableCell>
                        <TableCell>
                          {row.testFilePath && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleReplay(row)}
                              disabled={isReplayingTask === row.id}
                              className="h-8 w-8 p-0"
                              title={row.hasVideo ? "Play recording" : "Run test"}
                            >
                              {isReplayingTask === row.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : row.hasVideo ? (
                                <PlayCircle className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>{renderBadge(row.badge)}</TableCell>
                        <TableCell>
                          {row.testFileUrl ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{row.testFilePath || "N/A"}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.open(row.testFileUrl!, "_blank")}
                                className="h-6 w-6 p-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
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
                            onClick={() => handleArchive(row)}
                            disabled={archivingId === row.id}
                            className="h-8 w-8 p-0"
                            title="Archive test"
                          >
                            {archivingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Archive className="h-4 w-4" />
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
                  {!showPendingTasks && userJourneys.length > 0
                    ? "No completed tests to display. Enable 'Pending Tasks' filter to see all tests."
                    : !showFailedTasks && userJourneys.length > 0
                      ? "No passing tests to display. Enable 'Failed Tasks' filter to see all tests."
                      : "No E2E tests yet. Create a user journey to get started!"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

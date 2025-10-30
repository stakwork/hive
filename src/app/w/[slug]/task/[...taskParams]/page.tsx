"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
  createArtifact,
  Option,
  Artifact,
  ArtifactType,
} from "@/lib/chat";
import { useParams } from "next/navigation";
import { usePusherConnection, WorkflowStatusUpdate, TaskTitleUpdateEvent } from "@/hooks/usePusherConnection";
import { useChatForm } from "@/hooks/useChatForm";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import { useTaskMode } from "@/hooks/useTaskMode";
import { TaskStartInput, ChatArea, AgentChatArea, ArtifactsPanel, CommitModal } from "./components";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useStreamProcessor } from "@/lib/streaming";
import { agentToolProcessors } from "./lib/streaming-config";
import type { AgentStreamingMessage } from "@/types/agent";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useTheme } from "@/hooks/use-theme";

// Generate unique IDs to prevent collisions
function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function TaskChatPage() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session } = useSession(); // TODO: Use for authentication when creating tasks
  const { toast } = useToast();
  const params = useParams();
  const { id: workspaceId, workspace } = useWorkspace();
  const { resolvedTheme } = useTheme();

  // Fallback: use workspace.id if workspaceId (from context) is null
  const effectiveWorkspaceId = workspaceId || workspace?.id;

  const { taskMode, setTaskMode } = useTaskMode();

  const slug = params.slug as string;
  const taskParams = params.taskParams as string[];

  const isNewTask = taskParams?.[0] === "new";
  const taskIdFromUrl = !isNewTask ? taskParams?.[0] : null;

  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [started, setStarted] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskIdFromUrl);

  // Debug logging
  console.log('[TaskPage] Workspace context:', {
    workspaceId,
    workspaceObject: workspace,
    effectiveWorkspaceId,
    currentTaskId
  });
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [stakworkProjectId, setStakworkProjectId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isChainVisible, setIsChainVisible] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(WorkflowStatus.PENDING);
  const [pendingDebugAttachment, setPendingDebugAttachment] = useState<Artifact | null>(null);
  const [hasPod, setHasPod] = useState(false);
  const [claimedPodId, setClaimedPodId] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [isGeneratingCommitInfo, setIsGeneratingCommitInfo] = useState(false);

  // Use hook to check for active chat form and get webhook
  const { hasActiveChatForm, webhook: chatWebhook } = useChatForm(messages);

  const { logs, lastLogLine, clearLogs } = useProjectLogWebSocket(projectId, currentTaskId, true);

  // Shared function to drop the pod
  const dropPod = useCallback(
    async (useBeacon = false) => {
      if (!workspaceId || !claimedPodId) return;

      const dropUrl = `/api/pool-manager/drop-pod/${workspaceId}?latest=true&podId=${claimedPodId}`;

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
    [workspaceId, claimedPodId],
  );

  // Drop pod when component unmounts or when navigating away
  useEffect(() => {
    return () => {
      if (hasPod) {
        dropPod();
      }
    };
  }, [hasPod, dropPod]);

  // Drop pod when browser/tab closes or page refreshes
  useEffect(() => {
    if (!hasPod) return;

    const handleBeforeUnload = () => {
      dropPod(true);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasPod, dropPod]);

  // Streaming processor for agent mode
  const { processStream } = useStreamProcessor<AgentStreamingMessage>({
    toolProcessors: agentToolProcessors,
    hiddenTools: ["final_answer"],
    hiddenToolTextIds: { final_answer: "final-answer" },
  });
  const hasReceivedContentRef = useRef(false);

  // Save agent message to backend after streaming completes
  const saveAgentMessageToBackend = useCallback(
    async (message: AgentStreamingMessage, taskId: string, role: "user" | "assistant") => {
      try {
        // Create a proper chat message record in the database
        await fetch(`/api/tasks/${taskId}/messages/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: message.content,
            role: role === "user" ? "USER" : "ASSISTANT",
          }),
        });
      } catch (error) {
        console.error("Error saving agent message:", error);
      }
    },
    [],
  );

  // Handle incoming SSE messages
  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);

    // Hide thinking logs only when we receive a FORM artifact (action artifacts where user needs to make a decision)
    // Keep thinking logs visible for CODE, BROWSER, IDE, MEDIA, STREAM artifacts
    const hasActionArtifact = message.artifacts?.some((artifact) => artifact.type === "FORM");

    if (hasActionArtifact) {
      setIsChainVisible(false);
    }
  }, []);

  const handleWorkflowStatusUpdate = useCallback((update: WorkflowStatusUpdate) => {
    setWorkflowStatus(update.workflowStatus);
  }, []);

  const handleTaskTitleUpdate = useCallback(
    (update: TaskTitleUpdateEvent) => {
      // Only update if it's for the current task
      if (update.taskId === currentTaskId) {
        console.log(`Task title updated: "${update.previousTitle}" -> "${update.newTitle}"`);
        setTaskTitle(update.newTitle);
      }
    },
    [currentTaskId],
  );

  // Use the Pusher connection hook
  const { isConnected, error: connectionError } = usePusherConnection({
    taskId: currentTaskId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
    onTaskTitleUpdate: handleTaskTitleUpdate,
  });

  // Show connection errors as toasts
  useEffect(() => {
    if (connectionError) {
      toast({
        title: "Connection Error",
        description: "Lost connection to chat server. Attempting to reconnect...",
        variant: "destructive",
      });
    }
    // toast in deps causes infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionError]);

  const loadTaskMessages = useCallback(async (taskId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/tasks/${taskId}/messages`);

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data.messages) {
        setMessages(result.data.messages);
        console.log(`Loaded ${result.data.count} existing messages for task`);

        // Set task mode from loaded task data
        if (result.data.task?.mode) {
          setTaskMode(result.data.task.mode);
        }

        // Set initial workflow status from task data
        if (result.data.task?.workflowStatus) {
          setWorkflowStatus(result.data.task.workflowStatus);
        }

        // Set project ID for log subscription if available
        if (result.data.task?.stakworkProjectId) {
          console.log("Setting project ID from task data:", result.data.task.stakworkProjectId);
          setProjectId(result.data.task.stakworkProjectId.toString());
          setStakworkProjectId(result.data.task.stakworkProjectId);

          // Create ephemeral WORKFLOW artifact for existing tasks with workflows
          // This artifact is not stored in DB - it's always generated client-side
          const projectId = result.data.task.stakworkProjectId.toString();
          const targetMessage = result.data.messages[result.data.messages.length - 1];

          if (targetMessage) {
            const workflowArtifact = createArtifact({
              id: generateUniqueId(),
              messageId: targetMessage.id,
              type: ArtifactType.WORKFLOW,
              content: {
                projectId: projectId,
              },
            });

            // Update the last message with the workflow artifact
            setMessages((msgs) =>
              msgs.map((msg, idx) =>
                idx === msgs.length - 1 ? { ...msg, artifacts: [...(msg.artifacts || []), workflowArtifact] } : msg,
              ),
            );
          }
        }

        // Set task title from API response
        if (result.data.task?.title) {
          setTaskTitle(result.data.task.title);
        }
      }
    } catch (error) {
      console.error("Error loading task messages:", error);
      toast({
        title: "Error",
        description: "Failed to load existing messages.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // If we have a task ID from URL, we can optionally load existing messages
    if (taskIdFromUrl) {
      setStarted(true);
      // load existing chat messages for this task
      loadTaskMessages(taskIdFromUrl);
    }
  }, [taskIdFromUrl, loadTaskMessages]);

  const handleStart = async (msg: string) => {
    if (isLoading) return; // Prevent duplicate sends
    setIsLoading(true);

    try {
      if (isNewTask) {
        // Create new task FIRST
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: msg,
            description: "New task description", // TODO: Add description
            status: "active",
            workspaceSlug: slug,
            mode: taskMode, // Save the task mode
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create task: ${response.statusText}`);
        }

        const result = await response.json();
        const newTaskId = result.data.id;
        setCurrentTaskId(newTaskId);

        // Claim pod if agent mode is selected (AFTER task creation)
        let claimedPodUrls: { frontend: string; ide: string } | null = null;
        if (taskMode === "agent" && workspaceId) {
          try {
            const podResponse = await fetch(
              `/api/pool-manager/claim-pod/${workspaceId}?latest=true&goose=true&taskId=${newTaskId}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );

            if (podResponse.ok) {
              const podResult = await podResponse.json();
              // Only frontend and IDE URLs are returned (no goose URL or password)
              claimedPodUrls = {
                frontend: podResult.frontend,
                ide: podResult.ide,
              };
              setHasPod(true);
              setClaimedPodId(podResult.podId);
            } else {
              console.error("Failed to claim pod:", await podResponse.text());
              toast({
                title: "Warning",
                description: "Failed to claim pod. Continuing without pod integration.",
                variant: "destructive",
              });
            }
          } catch (error) {
            console.error("Error claiming pod:", error);
            toast({
              title: "Warning",
              description: "Failed to claim pod. Continuing without pod integration.",
              variant: "destructive",
            });
          }
        }

        // Set the task title from the response or fallback to the initial message
        if (result.data.title) {
          setTaskTitle(result.data.title);
        } else {
          setTaskTitle(msg); // Use the initial message as title fallback
        }

        const newUrl = `/w/${slug}/task/${newTaskId}`;
        // this updates the URL WITHOUT reloading the page
        window.history.replaceState({}, "", newUrl);

        setStarted(true);
        await sendMessage(msg, { taskId: newTaskId, podUrls: claimedPodUrls });
      } else {
        setStarted(true);
        await sendMessage(msg);
      }
    } catch (error) {
      console.error("Error in handleStart:", error);
      setIsLoading(false);
      toast({
        title: "Error",
        description: "Failed to start task. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSend = async (message: string) => {
    // Allow sending if we have either text or a pending debug attachment
    if (!message.trim() && !pendingDebugAttachment) return;
    if (isLoading) return; // Prevent duplicate sends

    // For artifact-only messages, provide a default message
    const messageText = message.trim() || (pendingDebugAttachment ? "Debug analysis attached" : "");

    await sendMessage(messageText, {
      ...(pendingDebugAttachment && { artifact: pendingDebugAttachment }),
      ...(chatWebhook && { webhook: chatWebhook }),
    });
    setPendingDebugAttachment(null); // Clear attachment after sending
  };

  const sendMessage = async (
    messageText: string,
    options?: {
      taskId?: string;
      replyId?: string;
      webhook?: string;
      artifact?: Artifact;
      podUrls?: { frontend: string; ide: string } | null;
    },
  ) => {
    // Create artifacts array starting with any existing artifact
    const artifacts: Artifact[] = options?.artifact ? [options.artifact] : [];

    // Add BROWSER and IDE artifacts if podUrls are provided
    if (options?.podUrls) {
      artifacts.push(
        createArtifact({
          id: generateUniqueId(),
          messageId: "",
          type: ArtifactType.BROWSER,
          content: {
            url: options.podUrls.frontend,
          },
        }),
        createArtifact({
          id: generateUniqueId(),
          messageId: "",
          type: ArtifactType.IDE,
          content: {
            url: options.podUrls.ide,
          },
        }),
      );
    }

    const newMessage: ChatMessage = createChatMessage({
      id: generateUniqueId(),
      message: messageText,
      role: ChatRole.USER,
      status: ChatStatus.SENDING,
      replyId: options?.replyId,
      artifacts,
    });

    setMessages((msgs) => [...msgs, newMessage]);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    try {
      // Use agent mode streaming
      if (taskMode === "agent") {
        // Mark user message as sent
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)),
        );

        // Prepare artifacts for backend (convert to serializable format)
        const backendArtifacts = artifacts.map((artifact) => ({
          type: artifact.type,
          content: artifact.content,
        }));

        const response = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId: options?.taskId || currentTaskId,
            message: messageText,
            workspaceSlug: slug,
            // gooseUrl removed - will be fetched from database in backend
            artifacts: backendArtifacts,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.statusText}`);
        }

        // Process the streaming response
        const assistantMessageId = generateUniqueId();
        let finalAssistantMessage: AgentStreamingMessage | undefined = undefined;

        await processStream(
          response,
          assistantMessageId,
          (updatedMessage) => {
            // Turn off loading as soon as we get the first content
            if (!hasReceivedContentRef.current) {
              hasReceivedContentRef.current = true;
              setIsLoading(false);
            }

            // Store the final message
            finalAssistantMessage = updatedMessage;

            // Update messages array with AgentStreamingMessage
            setMessages((prev) => {
              const existingIndex = prev.findIndex((m) => m.id === assistantMessageId);
              if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = updatedMessage as unknown as ChatMessage;
                return updated;
              }
              return [...prev, updatedMessage as unknown as ChatMessage];
            });
          },
          // Additional fields specific to AgentStreamingMessage
          {
            role: "assistant" as const,
            timestamp: new Date(),
          },
        );

        // After streaming completes, save assistant message to backend
        // (user message already saved in /api/agent POST route)
        if (finalAssistantMessage) {
          console.log("🤖 Final Assistant Message:", finalAssistantMessage);
          await saveAgentMessageToBackend(finalAssistantMessage, options?.taskId || currentTaskId || "", "assistant");
        }

        return;
      }

      // Regular stakwork mode
      const body: { [k: string]: unknown } = {
        taskId: options?.taskId || currentTaskId,
        message: messageText,
        contextTags: [],
        mode: taskMode,
        ...(options?.replyId && { replyId: options.replyId }),
        ...(options?.webhook && { webhook: options.webhook }),
        ...(options?.artifact && { artifacts: [options.artifact] }),
      };
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to send message");
      }

      if (result.workflow?.project_id) {
        console.log("Project ID:", result.workflow.project_id);
        setProjectId(result.workflow.project_id);
        setStakworkProjectId(result.workflow.project_id);
        setIsChainVisible(true);
        clearLogs();

        // Create a WORKFLOW artifact with the project_id
        const workflowArtifact = createArtifact({
          id: generateUniqueId(),
          messageId: newMessage.id,
          type: ArtifactType.WORKFLOW,
          content: {
            projectId: result.workflow.project_id.toString(),
          },
        });

        // Add the workflow artifact to the last message
        setMessages((msgs) =>
          msgs.map((msg) =>
            msg.id === newMessage.id ? { ...msg, artifacts: [...(msg.artifacts || []), workflowArtifact] } : msg,
          ),
        );
      }

      // Update the temporary message status instead of replacing entirely
      // This prevents re-animation since React sees it as the same message
      setMessages((msgs) => msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)));
    } catch (error) {
      console.error("Error sending message:", error);

      // Update message status to ERROR
      setMessages((msgs) => msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg)));

      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArtifactAction = async (messageId: string, action: Option, webhook: string) => {
    // console.log("Action triggered:", action);

    // Find the original message that contains artifacts
    const originalMessage = messages.find((msg) => msg.id === messageId);

    if (originalMessage) {
      setIsChainVisible(true);
      // Send the artifact action response to the backend
      await sendMessage(action.optionResponse, {
        replyId: originalMessage.id,
        webhook: webhook,
      });
    }
  };

  const handleDebugMessage = async (_message: string, debugArtifact?: Artifact) => {
    if (debugArtifact) {
      // Set pending attachment instead of sending immediately
      setPendingDebugAttachment(debugArtifact);
      // Focus the input for user to add context
      // Note: This will be handled by the ChatInput component
    }
  };

  const handleCommit = async () => {
    if (!workspaceId || !currentTaskId) {
      console.error("Missing commit requirements:", { workspaceId, claimedPodId, currentTaskId });
      toast({
        title: "Error",
        description: `Missing required information to commit. workspaceId: ${!!workspaceId}, taskId: ${!!currentTaskId}`,
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingCommitInfo(true);

    try {
      // First, generate commit message and branch name
      const branchResponse = await fetch("/api/agent/branch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: currentTaskId,
        }),
      });

      if (!branchResponse.ok) {
        const errorData = await branchResponse.json();
        throw new Error(errorData.error || "Failed to generate commit information");
      }

      const branchResult = await branchResponse.json();

      // Set the generated values and show the modal
      setCommitMessage(branchResult.data.commit_message);
      setBranchName(branchResult.data.branch_name);
      setShowCommitModal(true);
    } catch (error) {
      console.error("Error generating commit information:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate commit information.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingCommitInfo(false);
    }
  };

  const handleConfirmCommit = async (finalCommitMessage: string, finalBranchName: string) => {
    if (!workspaceId || !currentTaskId) {
      return;
    }
    console.log("🔍 Claimed pod ID:", claimedPodId);
    // Block actual commit in local dev without a pod
    if (!claimedPodId) {
      toast({
        title: "Local Development",
        description: "Commit & Push is not available - no pod claimed",
        variant: "default",
      });
      setShowCommitModal(false);
      return;
    }

    setIsCommitting(true);

    try {
      const response = await fetch("/api/agent/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          podId: claimedPodId,
          workspaceId: workspaceId,
          taskId: currentTaskId,
          commitMessage: finalCommitMessage,
          branchName: finalBranchName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to commit");
      }

      const result = await response.json();

      // Close modal
      setShowCommitModal(false);

      // Display success message
      toast({
        title: "Success",
        description: "Changes committed and pushed successfully!",
      });

      // Save PR URLs as assistant message
      if (result.data?.prUrls && result.data.prUrls.length > 0) {
        const isDark = resolvedTheme === "dark";
        const iconPath = isDark ? "/svg-icons/Github-dark.svg" : "/svg-icons/Github-light.svg";
        const prMessageText = result.data.prUrls
          .map((prUrl: string) => `![GitHub](${iconPath}) [Open PR](${prUrl})`)
          .join("\n\n");

        // Save the PR URLs as an assistant message
        await fetch(`/api/tasks/${currentTaskId}/messages/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: prMessageText,
            role: "ASSISTANT",
          }),
        });

        // Add the message to the UI immediately
        const newMessage: ChatMessage = createChatMessage({
          id: generateUniqueId(),
          message: prMessageText,
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
        });
        setMessages((msgs) => [...msgs, newMessage]);
      }
    } catch (error) {
      console.error("Error committing:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to commit changes.",
        variant: "destructive",
      });
    } finally {
      setIsCommitting(false);
    }
  };

  // Separate artifacts by type
  const allArtifacts = messages.flatMap((msg) => msg.artifacts || []);
  const hasNonFormArtifacts = allArtifacts.some((a) => a.type !== "FORM" && a.type !== "LONGFORM");

  const inputDisabled = isLoading || !isConnected;
  if (hasActiveChatForm) {
    // TODO: rm this and only enable if ready below
  }
  // const inputDisabled =
  //   isLoading ||
  //   !isConnected ||
  //   (started && messages.length > 0 && !hasActiveChatForm);

  return (
    <AnimatePresence mode="wait">
      {!started ? (
        <motion.div
          key="start"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.6, ease: [0.4, 0.0, 0.2, 1] }}
        >
          <TaskStartInput onStart={handleStart} taskMode={taskMode} onModeChange={setTaskMode} isLoading={isLoading} />
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.4, ease: [0.4, 0.0, 0.2, 1] }}
          className="h-[92vh] md:h-[97vh] flex"
        >
          {taskMode === "agent" && hasNonFormArtifacts ? (
            <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 min-h-0 gap-2">
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="h-full min-h-0 min-w-0">
                  <AgentChatArea
                    messages={messages}
                    onSend={handleSend}
                    inputDisabled={inputDisabled}
                    isLoading={isLoading}
                    logs={logs}
                    pendingDebugAttachment={pendingDebugAttachment}
                    onRemoveDebugAttachment={() => setPendingDebugAttachment(null)}
                    workflowStatus={workflowStatus}
                    taskTitle={taskTitle}
                    workspaceSlug={slug}
                    onCommit={handleCommit}
                    isCommitting={isGeneratingCommitInfo || isCommitting}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={60} minSize={25}>
                <div className="h-full min-h-0 min-w-0">
                  <ArtifactsPanel
                    artifacts={allArtifacts}
                    workspaceId={effectiveWorkspaceId || undefined}
                    taskId={currentTaskId || undefined}
                    onDebugMessage={handleDebugMessage}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : taskMode === "agent" ? (
            <div className="flex-1 min-w-0">
              <AgentChatArea
                messages={messages}
                onSend={handleSend}
                inputDisabled={inputDisabled}
                isLoading={isLoading}
                logs={logs}
                pendingDebugAttachment={pendingDebugAttachment}
                onRemoveDebugAttachment={() => setPendingDebugAttachment(null)}
                workflowStatus={workflowStatus}
                taskTitle={taskTitle}
                workspaceSlug={slug}
                onCommit={handleCommit}
                isCommitting={isGeneratingCommitInfo || isCommitting}
              />
            </div>
          ) : hasNonFormArtifacts ? (
            <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 min-h-0 gap-2">
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="h-full min-h-0 min-w-0">
                  <ChatArea
                    logs={logs}
                    messages={messages}
                    onSend={handleSend}
                    onArtifactAction={handleArtifactAction}
                    inputDisabled={inputDisabled}
                    isLoading={isLoading}
                    hasNonFormArtifacts={hasNonFormArtifacts}
                    isChainVisible={isChainVisible}
                    lastLogLine={lastLogLine}
                    pendingDebugAttachment={pendingDebugAttachment}
                    onRemoveDebugAttachment={() => setPendingDebugAttachment(null)}
                    workflowStatus={workflowStatus}
                    taskTitle={taskTitle}
                    stakworkProjectId={stakworkProjectId}
                    workspaceSlug={slug}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={60} minSize={25}>
                <div className="h-full min-h-0 min-w-0">
                  <ArtifactsPanel
                    artifacts={allArtifacts}
                    workspaceId={effectiveWorkspaceId || undefined}
                    taskId={currentTaskId || undefined}
                    onDebugMessage={handleDebugMessage}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="flex-1 min-w-0">
              <ChatArea
                messages={messages}
                onSend={handleSend}
                onArtifactAction={handleArtifactAction}
                inputDisabled={inputDisabled}
                isLoading={isLoading}
                hasNonFormArtifacts={hasNonFormArtifacts}
                isChainVisible={isChainVisible}
                lastLogLine={lastLogLine}
                logs={logs}
                pendingDebugAttachment={pendingDebugAttachment}
                onRemoveDebugAttachment={() => setPendingDebugAttachment(null)}
                workflowStatus={workflowStatus}
                taskTitle={taskTitle}
                stakworkProjectId={stakworkProjectId}
                workspaceSlug={slug}
              />
            </div>
          )}
        </motion.div>
      )}

      {/* Commit Modal */}
      <CommitModal
        isOpen={showCommitModal}
        onClose={() => setShowCommitModal(false)}
        onConfirm={handleConfirmCommit}
        initialCommitMessage={commitMessage}
        initialBranchName={branchName}
        isCommitting={isCommitting}
      />
    </AnimatePresence>
  );
}

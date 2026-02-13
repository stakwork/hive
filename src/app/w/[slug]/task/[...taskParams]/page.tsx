"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
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
  PullRequestContent,
  BountyContent,
} from "@/lib/chat";
import { useParams } from "next/navigation";
import {
  usePusherConnection,
  WorkflowStatusUpdate,
  TaskTitleUpdateEvent,
  PRStatusChangeEvent,
  BountyStatusChangeEvent,
} from "@/hooks/usePusherConnection";
import { useChatForm } from "@/hooks/useChatForm";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import { useTaskMode } from "@/hooks/useTaskMode";
import { usePoolStatus } from "@/hooks/usePoolStatus";
import { TaskStartInput, ChatArea, AgentChatArea, ArtifactsPanel, CommitModal, BountyRequestModal } from "./components";
import { useWorkflowNodes, WorkflowNode } from "@/hooks/useWorkflowNodes";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useStreamProcessor } from "@/lib/streaming";
import { agentToolProcessors } from "./lib/streaming-config";
import type { AgentStreamingMessage } from "@/types/agent";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useSession } from "next-auth/react";
import { WorkflowTransition, getStepType } from "@/types/stakwork/workflow";
import type { ModelName } from "@/lib/ai/models";

// Generate unique IDs to prevent collisions
function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function TaskChatPage() {
  const params = useParams();
  const { id: workspaceId, workspace } = useWorkspace();
  const { data: session } = useSession();
  const isMobile = useIsMobile();
  const canRequestBounty = useFeatureFlag(FEATURE_FLAGS.BOUNTY_REQUEST) && workspace?.slug === "hive";

  // Fallback: use workspace.id if workspaceId (from context) is null
  const effectiveWorkspaceId = workspaceId || workspace?.id;

  const { taskMode, setTaskMode } = useTaskMode();

  const slug = params.slug as string;
  const taskParams = params.taskParams as string[];
  const isNewTask = taskParams?.[0] === "new";

  // Check pod availability when in agent mode on new task page
  const {
    poolStatus,
    loading: poolStatusLoading,
    refetch: refetchPoolStatus,
  } = usePoolStatus(slug, isNewTask && taskMode === "agent");
  const hasAvailablePods = poolStatus ? poolStatus.unusedVms > 0 : null;

  // Fetch workflows when in workflow_editor mode
  const {
    workflows,
    isLoading: isLoadingWorkflows,
    error: workflowsError,
  } = useWorkflowNodes(slug, isNewTask && taskMode === "workflow_editor");

  // Wrapper to handle mode changes and trigger pod status check
  const handleModeChange = (newMode: string) => {
    setTaskMode(newMode);
    if (newMode === "agent") {
      refetchPoolStatus();
    }
  };

  const taskIdFromUrl = !isNewTask ? taskParams?.[0] : null;

  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [started, setStarted] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskIdFromUrl);

  // Debug logging
  // console.log("[TaskPage] Workspace context:", {
  //   workspaceId,
  //   workspaceObject: workspace,
  //   effectiveWorkspaceId,
  //   currentTaskId,
  // });
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [taskDescription, setTaskDescription] = useState<string | null>(null);
  const [stakworkProjectId, setStakworkProjectId] = useState<number | null>(null);
  const [podId, setPodId] = useState<string | null>(null);
  const [featureId, setFeatureId] = useState<string | null>(null);
  const [featureTitle, setFeatureTitle] = useState<string | null>(null);
  const [isReleasingPod, setIsReleasingPod] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChainVisible, setIsChainVisible] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(WorkflowStatus.PENDING);
  const [pendingDebugAttachment, setPendingDebugAttachment] = useState<Artifact | null>(null);
  const [selectedStep, setSelectedStep] = useState<WorkflowTransition | null>(null);
  const [currentWorkflowContext, setCurrentWorkflowContext] = useState<{
    workflowId: number | string;
    workflowName: string;
    workflowRefId: string;
  } | null>(null);
  const [workflowEditorWebhook, setWorkflowEditorWebhook] = useState<string | null>(null);
  const [currentProjectContext, setCurrentProjectContext] = useState<{
    projectId: string;
    projectName: string;
    workflowId: number;
  } | null>(null);
  const [projectDebuggerWebhook, setProjectDebuggerWebhook] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [isGeneratingCommitInfo, setIsGeneratingCommitInfo] = useState(false);
  const [isSubsequentCommit, setIsSubsequentCommit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showBountyModal, setShowBountyModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelName>("sonnet");

  // Use hook to check for active chat form and get webhook
  const { hasActiveChatForm, webhook: chatWebhook } = useChatForm(messages);

  const { logs, lastLogLine, clearLogs } = useProjectLogWebSocket(projectId, currentTaskId, true);

  // Streaming processor for agent mode
  const { processStream } = useStreamProcessor<AgentStreamingMessage>({
    toolProcessors: agentToolProcessors,
    hiddenTools: ["final_answer"],
    hiddenToolTextIds: { final_answer: "final-answer" },
  });
  const hasReceivedContentRef = useRef(false);

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
    // Hide processing indicator when workflow finishes
    if (update.workflowStatus === WorkflowStatus.COMPLETED) {
      setIsChainVisible(false);
    }
  }, []);

  const handleTaskTitleUpdate = useCallback(
    (update: TaskTitleUpdateEvent) => {
      // Only update if it's for the current task
      if (update.taskId === currentTaskId) {
        if (update.newTitle !== undefined) {
          console.log(`Task title updated: "${update.previousTitle}" -> "${update.newTitle}"`);
          setTaskTitle(update.newTitle);
        }
        if ("podId" in update) {
          console.log(`Task podId updated: ${update.podId}`);
          setPodId(update.podId ?? null);
        }
      }
    },
    [currentTaskId],
  );

  const handlePRStatusChange = useCallback((event: PRStatusChangeEvent) => {
    // Update PR artifact status when merged/closed
    if (!event.prUrl) return;

    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.artifacts) return msg;

        const hasPR = msg.artifacts.some(
          (a) => a.type === "PULL_REQUEST" && (a.content as PullRequestContent).url === event.prUrl,
        );

        if (!hasPR) return msg;

        return {
          ...msg,
          artifacts: msg.artifacts.map((a) => {
            if (a.type !== "PULL_REQUEST") return a;
            const content = a.content as PullRequestContent;
            if (content.url !== event.prUrl) return a;

            return {
              ...a,
              content: {
                ...content,
                status: event.artifactStatus || content.status,
              },
            };
          }),
        };
      }),
    );
  }, []);

  const handleBountyStatusChange = useCallback((event: BountyStatusChangeEvent) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.artifacts) return msg;

        const hasBounty = msg.artifacts.some((a) => a.id === event.artifactId);
        if (!hasBounty) return msg;

        return {
          ...msg,
          artifacts: msg.artifacts.map((a) => {
            if (a.id !== event.artifactId) return a;
            return {
              ...a,
              content: event.content as unknown as BountyContent,
            };
          }),
        };
      }),
    );
  }, []);

  // Use the Pusher connection hook
  const { isConnected, error: connectionError } = usePusherConnection({
    taskId: currentTaskId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
    onTaskTitleUpdate: handleTaskTitleUpdate,
    onPRStatusChange: handlePRStatusChange,
    onBountyStatusChange: handleBountyStatusChange,
  });

  // Show connection errors as toasts
  useEffect(() => {
    if (connectionError) {
      toast.error("Connection Error", { description: "Lost connection to chat server. Attempting to reconnect..." });
    }
    // toast in deps causes infinite re-render
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

        // Set task title and description from API response
        if (result.data.task?.title) {
          setTaskTitle(result.data.task.title);
        }
        if (result.data.task?.description) {
          setTaskDescription(result.data.task.description);
        }

        // Set podId from API response
        if (result.data.task?.podId) {
          setPodId(result.data.task.podId);
        }

        // Set feature data from API response
        if (result.data.task?.featureId && result.data.task?.feature?.title) {
          setFeatureId(result.data.task.featureId);
          setFeatureTitle(result.data.task.feature.title);
        }

        // Restore workflow context for workflow_editor mode
        if (result.data.task?.mode === "workflow_editor" && result.data.messages) {
          // Find the WORKFLOW artifact with workflowId and workflowName
          for (const msg of result.data.messages) {
            const workflowArtifact = msg.artifacts?.find(
              (a: {
                type: string;
                content?: { workflowId?: number | string; workflowName?: string; workflowRefId?: string };
              }) => a.type === "WORKFLOW" && a.content?.workflowId,
            );
            if (workflowArtifact?.content?.workflowId) {
              setCurrentWorkflowContext({
                workflowId: workflowArtifact.content.workflowId,
                workflowName:
                  workflowArtifact.content.workflowName || `Workflow ${workflowArtifact.content.workflowId}`,
                workflowRefId: workflowArtifact.content.workflowRefId || "",
              });
              break;
            }
          }
        }

        // Restore project context for project_debugger mode
        if (result.data.task?.mode === "project_debugger" && result.data.messages) {
          // Find the WORKFLOW artifact with projectId and projectInfo
          for (const msg of result.data.messages) {
            const projectArtifact = msg.artifacts?.find(
              (a: {
                type: string;
                content?: { projectId?: string; projectInfo?: any; workflowId?: number };
              }) => a.type === "WORKFLOW" && a.content?.projectId,
            );
            if (projectArtifact?.content?.projectId) {
              const projectInfo = projectArtifact.content.projectInfo;
              setCurrentProjectContext({
                projectId: projectArtifact.content.projectId,
                projectName: projectInfo?.project?.name || `Project ${projectArtifact.content.projectId}`,
                workflowId: projectArtifact.content.workflowId || projectInfo?.project?.workflow_id,
              });
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Error loading task messages:", error);
      toast.error("Error", { description: "Failed to load existing messages." });
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

  // Handle workflow selection in workflow_editor mode
  const handleWorkflowSelect = async (workflowId: number, workflowData: WorkflowNode) => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      // Use workflow_name directly from properties
      const workflowName = workflowData.properties.workflow_name;

      // Create new task with workflow info
      const taskTitle = workflowName || `Workflow ${workflowId}`;
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: `Editing workflow ${workflowId}`,
          status: "active",
          workspaceSlug: slug,
          mode: taskMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;
      setCurrentTaskId(newTaskId);

      // Set the task title
      setTaskTitle(taskTitle);

      // Update URL without reloading
      const newUrl = `/w/${slug}/task/${newTaskId}`;
      window.history.replaceState({}, "", newUrl);

      // Save workflow artifact to database
      const saveResponse = await fetch(`/api/tasks/${newTaskId}/messages/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Loaded: ${taskTitle}\nSelect a step on the right as a starting point.`,
          role: "ASSISTANT",
          artifacts: [
            {
              type: ArtifactType.WORKFLOW,
              content: {
                workflowJson: workflowData.properties.workflow_json,
                workflowId: workflowId,
                workflowName: workflowName,
                workflowRefId: workflowData.ref_id,
              },
            },
          ],
        }),
      });

      if (!saveResponse.ok) {
        console.error("Failed to save workflow artifact:", await saveResponse.text());
      }

      const savedMessage = await saveResponse.json();

      // Create local message from saved response
      const initialMessage: ChatMessage = savedMessage.success
        ? createChatMessage({
            id: savedMessage.data.id,
            message: savedMessage.data.message,
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            artifacts: savedMessage.data.artifacts,
          })
        : createChatMessage({
            id: generateUniqueId(),
            message: `Loaded: ${taskTitle}\nSelect a step on the right as a starting point.`,
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            artifacts: [
              createArtifact({
                id: generateUniqueId(),
                messageId: "",
                type: ArtifactType.WORKFLOW,
                content: {
                  workflowJson: workflowData.properties.workflow_json,
                  workflowId: workflowId,
                  workflowName: workflowName,
                  workflowRefId: workflowData.ref_id,
                },
              }),
            ],
          });

      setMessages([initialMessage]);
      setStarted(true);
      setWorkflowStatus(WorkflowStatus.PENDING);

      // Store workflow context for later use in step editing
      setCurrentWorkflowContext({
        workflowId: workflowId,
        workflowName: workflowName || `Workflow ${workflowId}`,
        workflowRefId: workflowData.ref_id,
      });
      // Clear webhook for fresh workflow conversation
      setWorkflowEditorWebhook(null);
    } catch (error) {
      console.error("Error in handleWorkflowSelect:", error);
      toast.error("Error", { description: "Failed to load workflow. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle creating a new workflow (user typed "new" in workflow editor)
  const handleNewWorkflow = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const taskTitle = "New Workflow";
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: "Creating a new workflow",
          status: "active",
          workspaceSlug: slug,
          mode: taskMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;
      setCurrentTaskId(newTaskId);
      setTaskTitle(taskTitle);

      // Update URL without reloading
      const newUrl = `/w/${slug}/task/${newTaskId}`;
      window.history.replaceState({}, "", newUrl);

      // Save workflow artifact with "new" as workflowId (no workflowJson)
      const saveResponse = await fetch(`/api/tasks/${newTaskId}/messages/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `New Workflow\nDescribe the workflow you want to create.`,
          role: "ASSISTANT",
          artifacts: [
            {
              type: ArtifactType.WORKFLOW,
              content: {
                workflowId: "new",
                workflowName: "New Workflow",
                workflowRefId: "",
              },
            },
          ],
        }),
      });

      if (!saveResponse.ok) {
        console.error("Failed to save workflow artifact:", await saveResponse.text());
      }

      const savedMessage = await saveResponse.json();

      const initialMessage: ChatMessage = savedMessage.success
        ? createChatMessage({
            id: savedMessage.data.id,
            message: savedMessage.data.message,
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            artifacts: savedMessage.data.artifacts,
          })
        : createChatMessage({
            id: generateUniqueId(),
            message: `New Workflow\nDescribe the workflow you want to create.`,
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            artifacts: [
              createArtifact({
                id: generateUniqueId(),
                messageId: "",
                type: ArtifactType.WORKFLOW,
                content: {
                  workflowId: "new",
                  workflowName: "New Workflow",
                  workflowRefId: "",
                },
              }),
            ],
          });

      setMessages([initialMessage]);
      setStarted(true);
      setWorkflowStatus(WorkflowStatus.PENDING);

      // Store workflow context with "new" as the ID
      setCurrentWorkflowContext({
        workflowId: "new",
        workflowName: "New Workflow",
        workflowRefId: "",
      });
      setWorkflowEditorWebhook(null);
    } catch (error) {
      console.error("Error in handleNewWorkflow:", error);
      toast.error("Error", { description: "Failed to create new workflow. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle project selection in project_debugger mode
  const handleProjectSelect = async (projectIdValue: string, projectData: any) => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const projectName = projectData.project?.name || `Project ${projectIdValue}`;
      const workflowId = projectData.project?.workflow_id;

      // Create new task with project info
      const taskTitle = `Debug: ${projectName}`;
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: taskTitle,
          description: `Debugging project ${projectIdValue}`,
          status: "active",
          workspaceSlug: slug,
          mode: "project_debugger",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;
      setCurrentTaskId(newTaskId);
      setTaskTitle(taskTitle);

      // Update URL without reloading
      const newUrl = `/w/${slug}/task/${newTaskId}`;
      window.history.replaceState({}, "", newUrl);

      // Store project context
      setCurrentProjectContext({
        projectId: projectIdValue,
        projectName: projectName,
        workflowId: workflowId,
      });

      // Call project debugger API endpoint
      const debuggerResponse = await fetch("/api/project-debugger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: newTaskId,
          message: `Analyzing project: ${projectName}`,
          projectId: projectIdValue,
        }),
      });

      if (!debuggerResponse.ok) {
        throw new Error(`Failed to start project debugger: ${debuggerResponse.statusText}`);
      }

      const debuggerResult = await debuggerResponse.json();

      // Store webhook from response
      if (debuggerResult.webhook) {
        setProjectDebuggerWebhook(debuggerResult.webhook);
      }

      // Set project ID for workflow monitoring
      if (debuggerResult.project?.id) {
        setProjectId(debuggerResult.project.id.toString());
        setStakworkProjectId(debuggerResult.project.id);
      }

      // Create initial message from API response
      const initialMessage: ChatMessage = createChatMessage({
        id: debuggerResult.message?.id || generateUniqueId(),
        message: debuggerResult.message?.message || `Analyzing project: ${projectName}`,
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        artifacts: debuggerResult.message?.artifacts || [],
      });

      setMessages([initialMessage]);
      setStarted(true);
      setWorkflowStatus(WorkflowStatus.IN_PROGRESS);
      setTaskMode("project_debugger");

      // Clear webhook for fresh project conversation
      setProjectDebuggerWebhook(debuggerResult.webhook || null);
    } catch (error) {
      console.error("Error in handleProjectSelect:", error);
      toast.error("Error", { description: "Failed to load project. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = async (msg: string, model?: ModelName, autoMerge?: boolean, images?: File[]) => {
    if (isLoading) return; // Prevent duplicate sends
    setIsLoading(true);

    // Update selected model if provided
    if (model) {
      setSelectedModel(model);
    }

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
            model: model || selectedModel, // Save selected AI model
            autoMerge: autoMerge || false, // Save auto-merge preference
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create task: ${response.statusText}`);
        }

        const result = await response.json();
        const newTaskId = result.data.id;
        setCurrentTaskId(newTaskId);

        // Set the task title from the response or fallback to the initial message
        if (result.data.title) {
          setTaskTitle(result.data.title);
        } else {
          setTaskTitle(msg); // Use the initial message as title fallback
        }

        // Upload images to S3 if provided
        let attachments: Array<{path: string, filename: string, mimeType: string, size: number}> | undefined;
        if (images && images.length > 0) {
          try {
            attachments = [];
            for (const image of images) {
              // Request presigned URL
              const presignedResponse = await fetch("/api/upload/presigned-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  taskId: newTaskId,
                  filename: image.name,
                  contentType: image.type,
                  size: image.size,
                }),
              });

              if (!presignedResponse.ok) {
                const error = await presignedResponse.json();
                throw new Error(error.error || "Failed to get presigned URL");
              }

              const { presignedUrl, s3Path } = await presignedResponse.json();

              // Upload to S3
              const uploadResponse = await fetch(presignedUrl, {
                method: "PUT",
                headers: { "Content-Type": image.type },
                body: image,
              });

              if (!uploadResponse.ok) {
                throw new Error("Failed to upload image to S3");
              }

              attachments.push({
                path: s3Path,
                filename: image.name,
                mimeType: image.type,
                size: image.size,
              });
            }
          } catch (uploadError) {
            console.error("Error uploading images:", uploadError);
            toast.error("Failed to upload one or more images");
            // Continue with task creation even if image upload fails
          }
        }

        const newUrl = `/w/${slug}/task/${newTaskId}`;
        // this updates the URL WITHOUT reloading the page
        window.history.replaceState({}, "", newUrl);

        // For agent mode, pass onPodReady callback so we switch to chat view
        // as soon as pod is claimed, before stream processing starts
        if (taskMode === "agent") {
          await sendMessage(msg, {
            taskId: newTaskId,
            onPodReady: () => setStarted(true),
            attachments,
          });
        } else {
          setStarted(true);
          await sendMessage(msg, { taskId: newTaskId, attachments });
        }
      } else {
        setStarted(true);
        await sendMessage(msg);
      }
    } catch (error) {
      console.error("Error in handleStart:", error);
      setIsLoading(false);
      toast.error("Error", { description: "Failed to start task. Please try again." });
    }
  };

  const handleSend = async (message: string, attachments?: Array<{path: string, filename: string, mimeType: string, size: number}>) => {
    // Allow sending if we have either text, attachments, or a pending debug/step attachment
    if (!message.trim() && !attachments?.length && !pendingDebugAttachment && !selectedStep) return;
    if (isLoading) return; // Prevent duplicate sends

    // Handle workflow_editor mode - always use workflow editor endpoint
    if (taskMode === "workflow_editor" && currentWorkflowContext && currentTaskId) {
      const messageText = message.trim() || (selectedStep ? "Modify this step" : "");
      if (!messageText) return; // Need a message if no step selected

      // Add user message to UI
      const newMessage: ChatMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
      });
      setMessages((msgs) => [...msgs, newMessage]);
      setIsLoading(true);

      try {
        // Use workflow editor webhook if available, otherwise try chatWebhook from FORM artifacts
        const webhookToUse = workflowEditorWebhook || chatWebhook;

        const response = await fetch("/api/workflow-editor", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId: currentTaskId,
            message: messageText,
            workflowId: currentWorkflowContext.workflowId,
            workflowName: currentWorkflowContext.workflowName,
            workflowRefId: currentWorkflowContext.workflowRefId,
            // Include webhook if available for continuing existing workflow
            ...(webhookToUse && { webhook: webhookToUse }),
            // Only include step data if a step is selected
            ...(selectedStep && {
              stepName: selectedStep.name,
              stepUniqueId: selectedStep.unique_id,
              stepDisplayName: selectedStep.display_name || selectedStep.name,
              stepType: getStepType(selectedStep),
              stepData: selectedStep,
            }),
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to send workflow editor request: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to send workflow editor request");
        }

        // Store webhook from response for subsequent messages
        if (result.workflow?.webhook) {
          setWorkflowEditorWebhook(result.workflow.webhook);
        }

        // Set project ID for the workflow link
        if (result.workflow?.project_id) {
          setProjectId(result.workflow.project_id.toString());
          setStakworkProjectId(result.workflow.project_id);
        }

        // Update message status
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)),
        );

        setSelectedStep(null); // Clear step after sending
      } catch (error) {
        console.error("Error in workflow editor:", error);
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg)),
        );
        toast.error("Error", { description: "Failed to send workflow editor request. Please try again." });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Handle project_debugger mode - use project debugger endpoint with webhook continuation
    if (taskMode === "project_debugger" && currentProjectContext && currentTaskId) {
      const messageText = message.trim();
      if (!messageText) return;

      // Add user message to UI
      const newMessage: ChatMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
      });
      setMessages((msgs) => [...msgs, newMessage]);
      setIsLoading(true);

      try {
        // Use project debugger webhook if available, otherwise try chatWebhook from FORM artifacts
        const webhookToUse = projectDebuggerWebhook || chatWebhook;

        const response = await fetch("/api/project-debugger", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            taskId: currentTaskId,
            message: messageText,
            projectId: currentProjectContext.projectId,
            // Include webhook if available for continuation
            ...(webhookToUse && { webhook: webhookToUse }),
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to send project debugger request: ${response.statusText}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Failed to send project debugger request");
        }

        // Store webhook from response for subsequent messages
        if (result.webhook) {
          setProjectDebuggerWebhook(result.webhook);
        }

        // Update message status
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)),
        );
      } catch (error) {
        console.error("Error in project debugger:", error);
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg)),
        );
        toast.error("Error", { description: "Failed to send project debugger request. Please try again." });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // For artifact-only or attachment-only messages, provide a default message
    const messageText = message.trim() || (pendingDebugAttachment ? "Debug analysis attached" : (attachments?.length ? "" : ""));

    await sendMessage(messageText, {
      ...(pendingDebugAttachment && { artifact: pendingDebugAttachment }),
      ...(chatWebhook && { webhook: chatWebhook }),
      ...(attachments && { attachments }),
    });
    setPendingDebugAttachment(null); // Clear attachment after sending
  };

  const sendMessage = useCallback(
    async (
      messageText: string,
      options?: {
        taskId?: string;
        replyId?: string;
        webhook?: string;
        artifact?: Artifact;
        attachments?: Array<{path: string, filename: string, mimeType: string, size: number}>;
        onPodReady?: () => void; // Called after pod is claimed, before stream starts
      },
    ) => {
      // Create artifacts array starting with any existing artifact
      const artifacts: Artifact[] = options?.artifact ? [options.artifact] : [];

      // Convert attachment metadata to Attachment objects for UI
      const attachments = options?.attachments?.map(att => ({
        id: generateUniqueId(),
        messageId: '', // Will be set by backend
        path: att.path,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const newMessage: ChatMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: options?.replyId,
        artifacts,
        attachments,
        createdBy: session?.user
          ? {
              id: session.user.id,
              name: session.user.name || null,
              email: session.user.email || null,
              image: session.user.image || null,
            }
          : undefined,
      });

      setMessages((msgs) => [...msgs, newMessage]);
      setIsLoading(true);
      hasReceivedContentRef.current = false;

      try {
        // Agent mode: new direct streaming flow
        if (taskMode === "agent") {
          // Mark user message as sent in UI
          setMessages((msgs) =>
            msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)),
          );

          // Prepare artifacts for backend
          const backendArtifacts = artifacts.map((artifact) => ({
            type: artifact.type,
            content: artifact.content,
          }));

          // 1. Call backend to create/refresh session
          const sessionResponse = await fetch("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId: options?.taskId || currentTaskId,
              message: messageText,
              artifacts: backendArtifacts,
            }),
          });

          if (!sessionResponse.ok) {
            const errorData = await sessionResponse.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to create session: ${sessionResponse.statusText}`);
          }

          const { streamToken, streamUrl, resume, historyContext, podUrls } = await sessionResponse.json();

          // If backend claimed a pod (new task or re-claim), update state and add artifacts
          if (podUrls) {
            setPodId(podUrls.podId);
            console.log(">>> Pod claimed by backend:", podUrls.podId);

            // Add BROWSER/IDE artifacts to the user message
            const browserArtifact = createArtifact({
              id: generateUniqueId(),
              messageId: "",
              type: ArtifactType.BROWSER,
              content: { url: podUrls.frontend },
            });
            const ideArtifact = createArtifact({
              id: generateUniqueId(),
              messageId: "",
              type: ArtifactType.IDE,
              content: { url: podUrls.ide },
            });

            // Update the message with new artifacts
            setMessages((msgs) =>
              msgs.map((msg) =>
                msg.id === newMessage.id
                  ? { ...msg, artifacts: [...(msg.artifacts || []), browserArtifact, ideArtifact] }
                  : msg
              )
            );
          }

          // Signal that pod is ready (for handleStart to switch views)
          options?.onPodReady?.();

          // 2. Connect directly to remote server for streaming
          // If historyContext is provided, the session was not found on the pod
          // so we prepend the chat history to help the agent understand the conversation
          const promptWithContext = historyContext ? `${historyContext}\n\n${messageText}` : messageText;

          const streamBody: Record<string, unknown> = { prompt: promptWithContext };
          if (resume) {
            streamBody.resume = true;
          }

          const streamResponse = await fetch(`${streamUrl}?token=${encodeURIComponent(streamToken)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(streamBody),
          });

          if (!streamResponse.ok) {
            throw new Error(`Stream failed: ${streamResponse.statusText}`);
          }

          // 3. Process stream using existing processor (now AI SDK native format)
          const assistantMessageId = generateUniqueId();

          await processStream(
            streamResponse,
            assistantMessageId,
            (updatedMessage) => {
              // Turn off loading as soon as we get the first content
              if (!hasReceivedContentRef.current) {
                hasReceivedContentRef.current = true;
                setIsLoading(false);
              }

              // Update messages array
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
            { role: "assistant" as const, timestamp: new Date() },
          );

          // Diff is now generated by the webhook on finish event and pushed via Pusher
          // The frontend receives it via the NEW_MESSAGE event subscription

          // Messages are persisted via webhook - no need to save here
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
          ...(options?.attachments && { attachments: options.attachments }),
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
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg)),
        );
      } catch (error) {
        console.error("Error sending message:", error);

        // Update message status to ERROR
        setMessages((msgs) =>
          msgs.map((msg) => (msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg)),
        );

        toast.error("Error", { description: "Failed to send message. Please try again." });
      } finally {
        setIsLoading(false);
      }
    },
    [taskMode, currentTaskId, processStream, clearLogs],
  );

  const handleArtifactAction = useCallback(
    async (messageId: string, action: Option, webhook: string) => {
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
    },
    [messages, sendMessage, setIsChainVisible],
  );

  const handleDebugMessage = async (_message: string, debugArtifact?: Artifact) => {
    if (debugArtifact) {
      // Set pending attachment instead of sending immediately
      setPendingDebugAttachment(debugArtifact);
      // Focus the input for user to add context
      // Note: This will be handled by the ChatInput component
    }
  };

  // Handle step selection from workflow artifact panel
  const handleStepSelect = useCallback((step: WorkflowTransition) => {
    setSelectedStep(step);
  }, []);

  const handleReleasePod = async () => {
    if (!effectiveWorkspaceId || !currentTaskId || !podId || isReleasingPod) return;

    setIsReleasingPod(true);
    try {
      const response = await fetch(
        `/api/pool-manager/drop-pod/${effectiveWorkspaceId}?podId=${podId}&taskId=${currentTaskId}`,
        { method: "POST" },
      );

      const data = await response.json();

      if (response.status === 409 && data.reassigned) {
        toast.error("Pod already released", {
          description: "This pod is no longer connected to this task.",
        });
        setPodId(null);
        setWorkflowStatus(WorkflowStatus.COMPLETED);
      } else if (!response.ok) {
        toast.error("Failed to release pod", {
          description: data.error || "An error occurred",
        });
      } else {
        toast.success("Pod released", {
          description: "The pod has been released successfully.",
        });
        setPodId(null);
        setWorkflowStatus(WorkflowStatus.COMPLETED);
      }
    } catch {
      toast.error("Failed to release pod", {
        description: "Network error occurred",
      });
    } finally {
      setIsReleasingPod(false);
    }
  };

  const handleCommit = async () => {
    if (!workspaceId || !currentTaskId) {
      console.error("Missing commit requirements:", { workspaceId, currentTaskId });
      toast.error("Error", {
        description: `Missing required information to commit. workspaceId: ${!!workspaceId}, taskId: ${!!currentTaskId}`,
      });
      return;
    }

    setIsGeneratingCommitInfo(true);

    try {
      // Check if there's an existing PR artifact (for subsequent commits)
      const existingPRArtifact = messages
        .slice()
        .reverse()
        .find((msg) => msg.artifacts?.some((artifact) => artifact.type === "PULL_REQUEST"));
      
      const isSubsequent = !!existingPRArtifact;
      setIsSubsequentCommit(isSubsequent);

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

      // For subsequent commits, extract the branch name from the existing PR artifact
      let branchNameToUse = branchResult.data.branch_name;
      if (isSubsequent && existingPRArtifact) {
        const prArtifact = existingPRArtifact.artifacts?.find((a) => a.type === "PULL_REQUEST");
        if (prArtifact) {
          const prContent = prArtifact.content as PullRequestContent;
          // Extract branch name from PR URL (format: /owner/repo/pull/123)
          // Or use a stored branch name if available in content
          if ('branch' in prContent) {
            branchNameToUse = (prContent as any).branch;
          }
        }
      }

      // Set the generated values and show the modal
      setCommitMessage(branchResult.data.commit_message);
      setBranchName(branchNameToUse);
      setShowCommitModal(true);
    } catch (error) {
      console.error("Error generating commit information:", error);
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Failed to generate commit information.",
      });
    } finally {
      setIsGeneratingCommitInfo(false);
    }
  };

  const handleConfirmCommit = async (finalCommitMessage: string, finalBranchName: string) => {
    if (!workspaceId || !currentTaskId) {
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

      // Check if PRs were created
      if (result.data?.prs && Object.keys(result.data.prs).length > 0) {
        // Display success message
        toast("Success", { description: "Changes committed and pushed successfully!" });

        // Save PR URLs as PULL_REQUEST artifacts
        const artifacts = Object.entries(result.data.prs).map(([repo, prUrl]) =>
          createArtifact({
            id: generateUniqueId(),
            messageId: "", // Will be set by the API
            type: ArtifactType.PULL_REQUEST,
            content: {
              repo,
              url: prUrl as string,
              status: "open",
            } as PullRequestContent,
          }),
        );

        // Save the PR artifacts as an assistant message
        const response = await fetch(`/api/tasks/${currentTaskId}/messages/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "",
            role: "ASSISTANT",
            artifacts: artifacts.map((artifact) => ({
              type: artifact.type,
              content: artifact.content,
              icon: artifact.icon,
            })),
          }),
        });

        const savedMessage = await response.json();

        // Add the message to the UI immediately
        if (savedMessage.success) {
          const newMessage: ChatMessage = createChatMessage({
            id: savedMessage.data.id,
            message: "",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            artifacts: savedMessage.data.artifacts,
          });
          setMessages((msgs) => [...msgs, newMessage]);
        }
      } else {
        // No PRs were created - show error
        toast.error("Error", { description: "Changes were pushed but no pull requests were created." });
      }
      // Display success message
      toast("Success", { description: "Changes committed and pushed successfully! Check the chat for PR links." });
    } catch (error) {
      console.error("Error committing:", error);
      toast.error("Error", { description: error instanceof Error ? error.message : "Failed to commit changes." });
    } finally {
      setIsCommitting(false);
    }
  };

  // Separate artifacts by type
  const allArtifacts = messages.flatMap((msg) => msg.artifacts || []);

  // Only keep the LATEST diff artifact, filter out earlier diffs
  const latestDiffArtifact = allArtifacts.reverse().find((a) => a.type === "DIFF");
  const artifactsWithoutOldDiffs = allArtifacts
    .reverse() // Reverse back to original order
    .filter((a) => {
      if (a.type === "DIFF") {
        return a === latestDiffArtifact; // Only keep the latest diff
      }
      return true; // Keep all other artifact types
    });

  const hasNonFormArtifacts = artifactsWithoutOldDiffs.some((a) => a.type !== "FORM" && a.type !== "LONGFORM");
  const browserArtifact = artifactsWithoutOldDiffs.find((a) => a.type === "BROWSER");

  // Check if code has been created (CODE or DIFF artifacts exist)
  const hasCodeArtifact = artifactsWithoutOldDiffs.some((a) => a.type === "CODE" || a.type === "DIFF");

  // Extract PR URL from PULL_REQUEST artifacts (get the first one if multiple exist)
  const prArtifact = messages
    .slice()
    .reverse()
    .find((msg) => msg.artifacts?.some((artifact) => artifact.type === "PULL_REQUEST"));
  const prUrl = prArtifact?.artifacts?.find((a) => a.type === "PULL_REQUEST")?.content as
    | PullRequestContent
    | undefined;
  const prLink = prUrl?.url || null;

  const isTerminalState =
    workflowStatus === WorkflowStatus.HALTED ||
    workflowStatus === WorkflowStatus.FAILED ||
    workflowStatus === WorkflowStatus.ERROR;

  // Live mode: restrict input based on workflow state and pod availability
  const liveModeSendAllowed =
    !started || // Fresh task - can send to kick off
    hasActiveChatForm || // FORM with chat option waiting for response
    workflowStatus === WorkflowStatus.COMPLETED || // Workflow done, can continue
    workflowStatus === WorkflowStatus.PENDING; // Not started yet

  const inputDisabled =
    isLoading ||
    !isConnected ||
    isTerminalState ||
    (taskMode !== "agent" && taskMode !== "workflow_editor" && !liveModeSendAllowed);

  return (
    <>
      <AnimatePresence mode="wait">
        {!started ? (
          <motion.div
            key="start"
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ duration: 0.6, ease: [0.4, 0.0, 0.2, 1] }}
          >
            <TaskStartInput
            onStart={handleStart}
            taskMode={taskMode}
            onModeChange={handleModeChange}
            isLoading={isLoading}
            hasAvailablePods={hasAvailablePods}
            isCheckingPods={poolStatusLoading}
            workspaceSlug={slug}
            workflows={workflows}
            onWorkflowSelect={handleWorkflowSelect}
            onNewWorkflow={handleNewWorkflow}
            onProjectSelect={handleProjectSelect}
            isLoadingWorkflows={isLoadingWorkflows}
            workflowsError={workflowsError}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.4, ease: [0.4, 0.0, 0.2, 1] }}
          className="h-[92vh] md:h-[97vh] flex overflow-hidden"
        >
          {taskMode === "agent" && hasNonFormArtifacts ? (
            isMobile ? (
              <div className="flex-1 min-w-0 flex flex-col">
                {showPreview && browserArtifact ? (
                  <ArtifactsPanel
                    artifacts={[browserArtifact]}
                    workspaceId={effectiveWorkspaceId || undefined}
                    taskId={currentTaskId || undefined}
                    podId={podId}
                    onDebugMessage={handleDebugMessage}
                    isMobile={isMobile}
                    onTogglePreview={() => setShowPreview(!showPreview)}
                  />
                ) : (
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
                    onCommit={hasCodeArtifact ? handleCommit : undefined}
                    isCommitting={isGeneratingCommitInfo || isCommitting}
                    showPreviewToggle={!!browserArtifact}
                    showPreview={showPreview}
                    onTogglePreview={() => setShowPreview(!showPreview)}
                    taskMode={taskMode}
                    podId={podId}
                    onReleasePod={handleReleasePod}
                    isReleasingPod={isReleasingPod}
                    prUrl={prLink}
                    featureId={featureId}
                    featureTitle={featureTitle}
                    onOpenBountyRequest={
                      canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <ResizablePanelGroup direction="horizontal" className="flex flex-1 min-w-0 min-h-0 gap-2">
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
                      onCommit={hasCodeArtifact ? handleCommit : undefined}
                      isCommitting={isGeneratingCommitInfo || isCommitting}
                      taskMode={taskMode}
                      podId={podId}
                      onReleasePod={handleReleasePod}
                      isReleasingPod={isReleasingPod}
                      prUrl={prLink}
                      featureId={featureId}
                      featureTitle={featureTitle}
                      onOpenBountyRequest={
                        canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                      }
                    />
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={60} minSize={25}>
                  <div className="h-full min-h-0 min-w-0">
                    <ArtifactsPanel
                      artifacts={artifactsWithoutOldDiffs}
                      workspaceId={effectiveWorkspaceId || undefined}
                      taskId={currentTaskId || undefined}
                      podId={podId}
                      onDebugMessage={handleDebugMessage}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )
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
                onCommit={hasCodeArtifact ? handleCommit : undefined}
                isCommitting={isGeneratingCommitInfo || isCommitting}
                taskMode={taskMode}
                podId={podId}
                onReleasePod={handleReleasePod}
                isReleasingPod={isReleasingPod}
                prUrl={prLink}
                featureId={featureId}
                featureTitle={featureTitle}
                onOpenBountyRequest={
                  canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                }
              />
            </div>
          ) : hasNonFormArtifacts ? (
            isMobile ? (
              <div className="flex-1 min-w-0 flex flex-col">
                {showPreview && browserArtifact ? (
                  <ArtifactsPanel
                    artifacts={[browserArtifact]}
                    workspaceId={effectiveWorkspaceId || undefined}
                    taskId={currentTaskId || undefined}
                    podId={podId}
                    onDebugMessage={handleDebugMessage}
                    isMobile={isMobile}
                    onTogglePreview={() => setShowPreview(!showPreview)}
                    onStepSelect={taskMode === "workflow_editor" ? handleStepSelect : undefined}
                  />
                ) : (
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
                    pendingStepAttachment={selectedStep}
                    onRemoveStepAttachment={() => setSelectedStep(null)}
                    workflowStatus={workflowStatus}
                    taskTitle={taskTitle}
                    workspaceSlug={slug}
                    showPreviewToggle={!!browserArtifact}
                    showPreview={showPreview}
                    onTogglePreview={() => setShowPreview(!showPreview)}
                    taskMode={taskMode}
                    taskId={currentTaskId}
                    podId={podId}
                    onReleasePod={handleReleasePod}
                    isReleasingPod={isReleasingPod}
                    featureId={featureId}
                    featureTitle={featureTitle}
                    onOpenBountyRequest={
                      canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <ResizablePanelGroup direction="horizontal" className="flex flex-1 min-w-0 min-h-0 gap-2">
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
                      pendingStepAttachment={selectedStep}
                      onRemoveStepAttachment={() => setSelectedStep(null)}
                      workflowStatus={workflowStatus}
                      taskTitle={taskTitle}
                      workspaceSlug={slug}
                      taskMode={taskMode}
                      taskId={currentTaskId}
                      podId={podId}
                      onReleasePod={handleReleasePod}
                      isReleasingPod={isReleasingPod}
                      featureId={featureId}
                      featureTitle={featureTitle}
                      onOpenBountyRequest={
                        canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                      }
                    />
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={60} minSize={25}>
                  <div className="h-full min-h-0 min-w-0">
                    <ArtifactsPanel
                      artifacts={artifactsWithoutOldDiffs}
                      workspaceId={effectiveWorkspaceId || undefined}
                      taskId={currentTaskId || undefined}
                      podId={podId}
                      onDebugMessage={handleDebugMessage}
                      onStepSelect={taskMode === "workflow_editor" ? handleStepSelect : undefined}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )
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
                pendingStepAttachment={selectedStep}
                onRemoveStepAttachment={() => setSelectedStep(null)}
                workflowStatus={workflowStatus}
                taskTitle={taskTitle}
                workspaceSlug={slug}
                taskMode={taskMode}
                taskId={currentTaskId}
                podId={podId}
                onReleasePod={handleReleasePod}
                isReleasingPod={isReleasingPod}
                featureId={featureId}
                featureTitle={featureTitle}
                onOpenBountyRequest={
                  canRequestBounty && prUrl?.status !== "merged" ? () => setShowBountyModal(true) : undefined
                }
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>

    {/* Commit Modal */}
    <CommitModal
      isOpen={showCommitModal}
      onClose={() => setShowCommitModal(false)}
      onConfirm={handleConfirmCommit}
      initialCommitMessage={commitMessage}
      initialBranchName={branchName}
      isCommitting={isCommitting}
      isSubsequentCommit={isSubsequentCommit}
    />

    {/* Bounty Request Modal */}
    {currentTaskId && taskTitle && effectiveWorkspaceId && (
      <BountyRequestModal
        isOpen={showBountyModal}
        onClose={() => setShowBountyModal(false)}
        sourceTaskId={currentTaskId}
        sourceWorkspaceSlug={slug}
        sourceWorkspaceId={effectiveWorkspaceId}
        sourceTaskTitle={taskTitle}
        sourceTaskDescription={taskDescription}
      />
    )}
    </>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
  Option,
  Artifact,
} from "@/lib/chat";
import { useParams } from "next/navigation";
import { usePusherConnection, WorkflowStatusUpdate } from "@/hooks/usePusherConnection";
import { useChatForm } from "@/hooks/useChatForm";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import { TaskStartInput, ChatArea, ArtifactsPanel } from "./components";

export default function TaskChatPage() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session } = useSession(); // TODO: Use for authentication when creating tasks
  const { toast } = useToast();
  const params = useParams();

  const [taskMode, setTaskMode] = useState("live");

  const slug = params.slug as string;
  const taskParams = params.taskParams as string[];

  const isNewTask = taskParams?.[0] === "new";
  const taskIdFromUrl = !isNewTask ? taskParams?.[0] : null;

  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [started, setStarted] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(
    taskIdFromUrl,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isChainVisible, setIsChainVisible] = useState(false);
  const [pendingDebugAttachment, setPendingDebugAttachment] = useState<Artifact | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(WorkflowStatus.PENDING);

  // Use hook to check for active chat form and get webhook
  const { hasActiveChatForm, webhook: chatWebhook } = useChatForm(messages);

  useEffect(() => {
    const mode = localStorage.getItem("task_mode");
    setTaskMode(mode || "live");
  }, []);

  const { lastLogLine, clearLogs } = useProjectLogWebSocket(
    projectId,
    currentTaskId,
    true,
  );

  // Handle incoming SSE messages
  const handleSSEMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);

      // Clear logs when we get a new message (similar to old implementation)
      if (message.artifacts?.length === 0) {
        clearLogs();
      }

      // Hide chain visibility when message processing is complete
      setIsChainVisible(false);
    },
    [clearLogs],
  );

  // Handle workflow status updates
  const handleWorkflowStatusUpdate = useCallback(
    (update: WorkflowStatusUpdate) => {
      setWorkflowStatus(update.workflowStatus);
    },
    [],
  );

  // Use the Pusher connection hook
  const { isConnected, error: connectionError } = usePusherConnection({
    taskId: currentTaskId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
  });

  // Show connection errors as toasts
  useEffect(() => {
    if (connectionError) {
      toast({
        title: "Connection Error",
        description:
          "Lost connection to chat server. Attempting to reconnect...",
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
        
        // Set initial workflow status from task data
        if (result.data.task?.workflowStatus) {
          setWorkflowStatus(result.data.task.workflowStatus);
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
    if (isNewTask) {
      // Create new task
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
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;
      setCurrentTaskId(newTaskId);

      const newUrl = `/w/${slug}/task/${newTaskId}`;
      // this updates the URL WITHOUT reloading the page
      window.history.replaceState({}, "", newUrl);

      setStarted(true);
      await sendMessage(msg, undefined, { taskId: newTaskId });
    } else {
      setStarted(true);
      await sendMessage(msg, undefined);
    }
  };

  const handleSend = async (message: string) => {
    // Allow sending if we have either text or a pending debug attachment
    if (!message.trim() && !pendingDebugAttachment) return;

    // For artifact-only messages, provide a default message
    const messageText = message.trim() || (pendingDebugAttachment ? "Debug analysis attached" : "");
    
    await sendMessage(
      messageText,
      pendingDebugAttachment || undefined,
      chatWebhook ? { webhook: chatWebhook } : undefined,
    );
    setPendingDebugAttachment(null); // Clear attachment after sending
  };

  const sendMessage = async (
    messageText: string,
    artifact?: Artifact,
    options?: {
      taskId?: string;
      replyId?: string;
      webhook?: string;
    },
  ) => {
    if (isLoading) return;

    // Don't add optimistic messages - let them come from Pusher only
    setIsLoading(true);

    // console.log("Sending message:", messageText, options);

    try {
      const body: { [k: string]: unknown } = {
        taskId: options?.taskId || currentTaskId,
        message: messageText,
        contextTags: [],
        mode: taskMode,
        ...(options?.replyId && { replyId: options.replyId }),
        ...(options?.webhook && { webhook: options.webhook }),
        ...(artifact && { artifacts: [artifact] }),
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

      if (result.data?.project_id) {
        console.log("Project ID:", result.data.project_id);
        setProjectId(result.data.project_id);
        setIsChainVisible(true);
        clearLogs();
      }

      // Message will be added via Pusher broadcast
    } catch (error) {
      console.error("Error sending message:", error);

      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArtifactAction = async (
    messageId: string,
    action: Option,
    webhook: string,
  ) => {
    // console.log("Action triggered:", action);

    // Find the original message that contains artifacts
    const originalMessage = messages.find((msg) => msg.id === messageId);

    if (originalMessage) {
      setIsChainVisible(true);
      // Send the artifact action response to the backend
      await sendMessage(action.optionResponse, undefined, {
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

  // Separate artifacts by type
  const allArtifacts = messages.flatMap((msg) => msg.artifacts || []);
  const hasNonFormArtifacts = allArtifacts.some(
    (a) => a.type !== "FORM" && a.type !== "LONGFORM",
  );

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
          <TaskStartInput onStart={handleStart} onModeChange={setTaskMode} />
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.4, ease: [0.4, 0.0, 0.2, 1] }}
          className="h-[92vh] md:h-[97vh] flex gap-4"
        >
          <ChatArea
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
          />

          <AnimatePresence>
            {hasNonFormArtifacts && <ArtifactsPanel artifacts={allArtifacts} onDebugMessage={handleDebugMessage} />}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

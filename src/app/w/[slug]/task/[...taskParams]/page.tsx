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
} from "@/lib/chat";
import { useParams } from "next/navigation";
import { usePusherConnection, WorkflowStatusUpdate } from "@/hooks/usePusherConnection";
import { useChatForm } from "@/hooks/useChatForm";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import { TaskStartInput, ChatArea, ArtifactsPanel } from "./components";

// Generate unique IDs to prevent collisions
function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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

      // Hide thinking logs only when we receive a FORM artifact (action artifacts where user needs to make a decision)
      // Keep thinking logs visible for CODE, BROWSER, IDE, MEDIA, STREAM artifacts
      const hasActionArtifact = message.artifacts?.some(artifact => artifact.type === 'FORM');
      
      if (hasActionArtifact) {
        setIsChainVisible(false);
      }
      // For all other artifact types (message, ide, etc.), keep thinking logs visible
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
        
        // Set project ID for log subscription if available
        if (result.data.task?.stakworkProjectId) {
          console.log("Setting project ID from task data:", result.data.task.stakworkProjectId);
          setProjectId(result.data.task.stakworkProjectId.toString());
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
      await sendMessage(msg, { taskId: newTaskId });
    } else {
      setStarted(true);
      await sendMessage(msg);
    }
  };

  const handleSend = async (message: string) => {
    await sendMessage(
      message,
      chatWebhook ? { webhook: chatWebhook } : undefined,
    );
  };

  const sendMessage = async (
    messageText: string,
    options?: {
      taskId?: string;
      replyId?: string;
      webhook?: string;
    },
  ) => {
    if (isLoading) return;

    const newMessage: ChatMessage = createChatMessage({
      id: generateUniqueId(),
      message: messageText,
      role: ChatRole.USER,
      status: ChatStatus.SENDING,
      replyId: options?.replyId,
    });

    setMessages((msgs) => [...msgs, newMessage]);
    setIsLoading(true);

    // console.log("Sending message:", messageText, options);

    try {
      const body: { [k: string]: string | string[] | null } = {
        taskId: options?.taskId || currentTaskId,
        message: messageText,
        contextTags: [],
        mode: taskMode,
        ...(options?.replyId && { replyId: options.replyId }),
        ...(options?.webhook && { webhook: options.webhook }),
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
        setIsChainVisible(true);
        clearLogs();
      }

      // Update the temporary message status instead of replacing entirely
      // This prevents re-animation since React sees it as the same message
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg,
        ),
      );
    } catch (error) {
      console.error("Error sending message:", error);

      // Update message status to ERROR
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg,
        ),
      );

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
      await sendMessage(action.optionResponse, {
        replyId: originalMessage.id,
        webhook: webhook,
      });
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
            workflowStatus={workflowStatus}
          />

          <AnimatePresence>
            {hasNonFormArtifacts && <ArtifactsPanel artifacts={allArtifacts} />}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

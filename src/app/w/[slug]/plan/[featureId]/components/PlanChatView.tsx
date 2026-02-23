"use client";

import React, { useState, useCallback, useEffect } from "react";
import { ChatArea, ArtifactsPanel } from "@/components/chat";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePusherConnection } from "@/hooks/usePusherConnection";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
} from "@/lib/chat";

function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

interface PlanChatViewProps {
  featureId: string;
  workspaceSlug: string;
  workspaceId: string;
}

export function PlanChatView({ featureId, workspaceSlug, workspaceId }: PlanChatViewProps) {
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [featureTitle, setFeatureTitle] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Load existing messages
  useEffect(() => {
    async function loadMessages() {
      try {
        const res = await fetch(`/api/features/${featureId}/chat`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.data || []);
        }
      } catch (error) {
        console.error("Error loading feature messages:", error);
      } finally {
        setInitialLoadDone(true);
      }
    }

    // Load feature title
    async function loadFeature() {
      try {
        const res = await fetch(`/api/features/${featureId}`);
        if (res.ok) {
          const data = await res.json();
          setFeatureTitle(data.data?.title || null);
        }
      } catch (error) {
        console.error("Error loading feature:", error);
      }
    }

    loadMessages();
    loadFeature();
  }, [featureId]);

  // Handle incoming Pusher messages
  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((msgs) => {
      const exists = msgs.some((m) => m.id === message.id);
      if (exists) return msgs;
      return [...msgs, message];
    });
    setIsLoading(false);
    setWorkflowStatus(WorkflowStatus.COMPLETED);
  }, []);

  // Handle workflow status updates
  const handleWorkflowStatusUpdate = useCallback(
    (update: { taskId: string; workflowStatus: WorkflowStatus }) => {
      setWorkflowStatus(update.workflowStatus);
      if (
        update.workflowStatus === WorkflowStatus.COMPLETED ||
        update.workflowStatus === WorkflowStatus.FAILED ||
        update.workflowStatus === WorkflowStatus.ERROR
      ) {
        setIsLoading(false);
      }
    },
    [],
  );

  // Pusher connection for feature channel
  usePusherConnection({
    featureId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
  });

  // Send a message
  const sendMessage = useCallback(
    async (messageText: string) => {
      const newMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
      });

      setMessages((msgs) => [...msgs, newMessage]);
      setIsLoading(true);
      setWorkflowStatus(WorkflowStatus.IN_PROGRESS);

      try {
        const res = await fetch(`/api/features/${featureId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText }),
        });

        if (res.ok) {
          const data = await res.json();
          // Update the temp message with the real one
          setMessages((msgs) =>
            msgs.map((m) => (m.id === newMessage.id ? { ...data.message, status: ChatStatus.SENT } : m)),
          );
        } else {
          setMessages((msgs) =>
            msgs.map((m) => (m.id === newMessage.id ? { ...m, status: ChatStatus.ERROR } : m)),
          );
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Error sending message:", error);
        setMessages((msgs) =>
          msgs.map((m) => (m.id === newMessage.id ? { ...m, status: ChatStatus.ERROR } : m)),
        );
        setIsLoading(false);
      }
    },
    [featureId],
  );

  // Handle send from ChatArea
  const handleSend = useCallback(
    async (message: string) => {
      await sendMessage(message);
    },
    [sendMessage],
  );

  // Handle artifact actions (no-op for plan mode but required by ChatArea)
  const handleArtifactAction = useCallback(async () => {
    // Plan mode doesn't support artifact actions
  }, []);

  // Collect all artifacts from messages
  const allArtifacts = messages.flatMap((m) => m.artifacts || []);
  const hasArtifacts = allArtifacts.length > 0;

  if (!initialLoadDone) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <ResizablePanelGroup direction="horizontal" className="flex flex-1 min-w-0 min-h-0 gap-2">
        <ResizablePanel defaultSize={hasArtifacts && !isMobile ? 50 : 100} minSize={30}>
          <div className="h-full min-h-0 min-w-0">
            <ChatArea
              messages={messages}
              onSend={handleSend}
              onArtifactAction={handleArtifactAction}
              isLoading={isLoading}
              workflowStatus={workflowStatus}
              taskTitle={featureTitle}
              workspaceSlug={workspaceSlug}
              featureId={featureId}
              featureTitle={featureTitle}
              taskMode="live"
            />
          </div>
        </ResizablePanel>
        {hasArtifacts && !isMobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full min-h-0 min-w-0">
                <ArtifactsPanel
                  artifacts={allArtifacts}
                  workspaceId={workspaceId}
                  taskId={featureId}
                />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

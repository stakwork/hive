"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChatArea, ArtifactsPanel } from "@/components/chat";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePusherConnection, type WorkflowStatusUpdate } from "@/hooks/usePusherConnection";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlanPresence } from "@/hooks/usePlanPresence";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  createChatMessage,
} from "@/lib/chat";
import { getPusherClient } from "@/lib/pusher";
import { PlanSection, PlanData } from "./PlanArtifact";
import type { FeatureDetail } from "@/types/roadmap";

function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

interface PlanChatViewProps {
  featureId: string;
  workspaceSlug: string;
  workspaceId: string;
}

export function PlanChatView({ featureId, workspaceSlug, workspaceId }: PlanChatViewProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Real-time presence tracking
  const { collaborators } = usePlanPresence({ featureId });

  const fetchFeature = useCallback(async (id: string) => {
    const response = await fetch(`/api/features/${id}`);
    if (!response.ok) {
      throw new Error("Failed to fetch feature");
    }
    return response.json();
  }, []);

  const {
    data: feature,
    setData: setFeature,
    loading,
    error,
  } = useDetailResource<FeatureDetail>({
    resourceId: featureId,
    fetchFn: fetchFeature,
  });

  // Redirect to plan list if feature not found
  useEffect(() => {
    if (!loading && error) {
      router.push(`/w/${workspaceSlug}/plan`);
    }
  }, [loading, error, router, workspaceSlug]);

  const refetchFeature = useCallback(async () => {
    try {
      const result = await fetchFeature(featureId);
      if (result.success && result.data) {
        setFeature(result.data);
      }
    } catch (error) {
      console.error("Error fetching feature:", error);
    }
  }, [featureId, fetchFeature, setFeature]);

  // Hydrate workflow status from persisted feature data
  useEffect(() => {
    if (feature?.workflowStatus) {
      setWorkflowStatus(feature.workflowStatus);
    }
  }, [feature?.workflowStatus]);

  // Load existing messages - promoted to useCallback for visibility refetch
  const loadMessages = useCallback(async () => {
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
  }, [featureId]);

  // Initial load
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Refetch on tab visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchFeature();
        loadMessages();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetchFeature, loadMessages]);

  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((msgs) => {
      const exists = msgs.some((m) => m.id === message.id);
      if (exists) return msgs;
      return [...msgs, message];
    });
    setIsLoading(false);
  }, []);

  const handleWorkflowStatusUpdate = useCallback(
    (update: WorkflowStatusUpdate) => {
      setWorkflowStatus(update.workflowStatus);
      if (
        update.workflowStatus === WorkflowStatus.COMPLETED ||
        update.workflowStatus === WorkflowStatus.FAILED ||
        update.workflowStatus === WorkflowStatus.ERROR ||
        update.workflowStatus === WorkflowStatus.HALTED
      ) {
        setIsLoading(false);
      }
    },
    [],
  );

  usePusherConnection({
    featureId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
    onFeatureUpdated: refetchFeature,
  });

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
          body: JSON.stringify({ message: messageText, sourceWebsocketID: getPusherClient().connection.socket_id }),
        });

        if (res.ok) {
          const data = await res.json();
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

  const handleArtifactAction = useCallback(
    async (messageId: string, action: { optionResponse: string }) => {
      const newMessage = createChatMessage({
        id: generateUniqueId(),
        message: action.optionResponse,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: messageId,
      });

      setMessages((msgs) => [...msgs, newMessage]);
      setIsLoading(true);
      setWorkflowStatus(WorkflowStatus.IN_PROGRESS);

      try {
        const res = await fetch(`/api/features/${featureId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: action.optionResponse,
            replyId: messageId,
          }),
        });

        if (res.ok) {
          const data = await res.json();
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

  const allArtifacts = useMemo(() => messages.flatMap((m) => m.artifacts || []), [messages]);

  const planData: PlanData = useMemo(() => {
    const stories = feature?.userStories ?? [];
    let userStoriesContent: string | null = null;
    if (stories.length === 1) {
      userStoriesContent = stories[0].title;
    } else if (stories.length > 1) {
      userStoriesContent = stories.map((s) => `- ${s.title}`).join("\n");
    }

    const sections: PlanSection[] = [
      { key: "brief", label: "Brief", content: feature?.brief || null },
      { key: "user-stories", label: "User Stories", content: userStoriesContent },
      { key: "requirements", label: "Requirements", content: feature?.requirements || null },
      { key: "architecture", label: "Architecture", content: feature?.architecture || null },
    ];

    return {
      featureTitle: feature?.title || null,
      sections,
    };
  }, [feature]);

  const featureTitle = feature?.title || null;

  const inputDisabled =
    isLoading || workflowStatus === WorkflowStatus.IN_PROGRESS;

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
        <ResizablePanel defaultSize={isMobile ? 100 : 50} minSize={30}>
          <div className="h-full min-h-0 min-w-0">
            <ChatArea
              messages={messages}
              onSend={sendMessage}
              onArtifactAction={handleArtifactAction}
              inputDisabled={inputDisabled}
              collaborators={collaborators}
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
        {!isMobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full min-h-0 min-w-0">
                <ArtifactsPanel
                  artifacts={allArtifacts}
                  workspaceId={workspaceId}
                  taskId={featureId}
                  planData={planData}
                  feature={feature}
                  featureId={featureId}
                  onFeatureUpdate={setFeature}
                />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

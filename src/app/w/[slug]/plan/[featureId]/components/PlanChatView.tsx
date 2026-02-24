"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
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
import { PlanSection, PlanData } from "./PlanArtifact";

function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

interface FeatureData {
  title: string | null;
  brief: string | null;
  requirements: string | null;
  architecture: string | null;
  userStories: { id: string; title: string }[];
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
  const [featureData, setFeatureData] = useState<FeatureData | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const refetchFeature = useCallback(async () => {
    try {
      const res = await fetch(`/api/features/${featureId}`);
      if (res.ok) {
        const data = await res.json();
        const feature = data.data;
        if (feature) {
          setFeatureData({
            title: feature.title || null,
            brief: feature.brief || null,
            requirements: feature.requirements || null,
            architecture: feature.architecture || null,
            userStories: feature.userStories || [],
          });
        }
      }
    } catch (error) {
      console.error("Error fetching feature:", error);
    }
  }, [featureId]);

  // Load existing messages and feature data
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

    loadMessages();
    refetchFeature();
  }, [featureId, refetchFeature]);

  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((msgs) => {
      const exists = msgs.some((m) => m.id === message.id);
      if (exists) return msgs;
      return [...msgs, message];
    });
    setIsLoading(false);
    setWorkflowStatus(WorkflowStatus.COMPLETED);
  }, []);

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
          body: JSON.stringify({ message: messageText }),
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

  const handleSend = useCallback(
    async (message: string) => {
      await sendMessage(message);
    },
    [sendMessage],
  );

  const handleArtifactAction = useCallback(
    async (_messageId: string, action: { optionResponse: string }) => {
      await sendMessage(action.optionResponse);
    },
    [sendMessage],
  );

  const allArtifacts = messages.flatMap((m) => m.artifacts || []);

  const planData: PlanData = useMemo(() => {
    const userStoriesContent =
      featureData?.userStories && featureData.userStories.length > 0
        ? featureData.userStories.length === 1
          ? featureData.userStories[0].title
          : featureData.userStories.map((s) => `- ${s.title}`).join("\n")
        : null;

    const sections: PlanSection[] = [
      { key: "brief", label: "Brief", content: featureData?.brief || null },
      { key: "user-stories", label: "User Stories", content: userStoriesContent },
      { key: "requirements", label: "Requirements", content: featureData?.requirements || null },
      { key: "architecture", label: "Architecture", content: featureData?.architecture || null },
    ];

    return {
      featureTitle: featureData?.title || null,
      sections,
    };
  }, [featureData]);

  const featureTitle = featureData?.title || null;

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
                />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

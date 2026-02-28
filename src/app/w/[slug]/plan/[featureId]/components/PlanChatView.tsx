"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { diffWords } from "diff";
import { ClipboardList } from "lucide-react";
import { ChatArea, ArtifactsPanel } from "@/components/chat";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePusherConnection, type WorkflowStatusUpdate, type FeatureTitleUpdateEvent } from "@/hooks/usePusherConnection";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlanPresence } from "@/hooks/usePlanPresence";
import { useProjectLogWebSocket } from "@/hooks/useProjectLogWebSocket";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  WorkflowStatus,
  ArtifactType,
  createChatMessage,
} from "@/lib/chat";
import { getPusherClient } from "@/lib/pusher";
import { PlanSection, PlanData, SectionHighlights, DiffToken } from "./PlanArtifact";
import type { FeatureDetail } from "@/types/roadmap";

function generateUniqueId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

const VALID_PLAN_TABS: ArtifactType[] = ["PLAN", "TASKS", "VERIFY"];

const PLAN_SECTION_KEYS = ["brief", "requirements", "architecture", "user-stories"] as const;

function getUserStoriesText(feature: FeatureDetail): string | null {
  const stories = feature.userStories ?? [];
  if (stories.length === 0) return null;
  if (stories.length === 1) return stories[0].title;
  return stories.map((s) => s.title).join("\n");
}

function getSectionValue(feature: FeatureDetail, key: string): string | null {
  if (key === "user-stories") return getUserStoriesText(feature);
  return (feature[key as keyof FeatureDetail] as string) ?? null;
}

function computeDiffTokens(prevVal: string, nextVal: string): DiffToken[] {
  const parts = diffWords(prevVal, nextVal);
  return parts.flatMap((part) => {
    if (part.removed) return [];
    return (part.value.match(/\S+|\s+/g) ?? []).map((word) => ({
      word,
      isNew: !!part.added,
    }));
  });
}

export function computeSectionHighlights(
  prev: FeatureDetail,
  next: FeatureDetail
): SectionHighlights | null {
  const highlights: SectionHighlights = {};

  for (const key of PLAN_SECTION_KEYS) {
    const prevVal = getSectionValue(prev, key);
    const nextVal = getSectionValue(next, key);

    if (!nextVal) continue;
    if (!prevVal) {
      highlights[key] = { type: "new" };
    } else if (prevVal !== nextVal) {
      highlights[key] = { type: "diff", tokens: computeDiffTokens(prevVal, nextVal) };
    }
  }

  return Object.keys(highlights).length > 0 ? highlights : null;
}

interface PlanChatViewProps {
  featureId: string;
  workspaceSlug: string;
  workspaceId: string;
}

export function PlanChatView({ featureId, workspaceSlug, workspaceId }: PlanChatViewProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isChainVisible, setIsChainVisible] = useState(false);
  const [sectionHighlights, setSectionHighlights] = useState<SectionHighlights | null>(null);
  const prevFeatureRef = useRef<FeatureDetail | null>(null);
  const [sphinxReady, setSphinxReady] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Project log WebSocket for live thinking logs
  const { logs, lastLogLine, clearLogs } = useProjectLogWebSocket(projectId, featureId, true);

  // Resolve initial tab state: URL param → localStorage → default
  const resolveInitialTab = useCallback((): ArtifactType => {
    // Priority 1: URL param — read directly from window to survive hard refresh
    if (typeof window !== "undefined") {
      const tabParam = new URLSearchParams(window.location.search).get("tab");
      if (tabParam) {
        const uppercased = tabParam.toUpperCase() as ArtifactType;
        if (VALID_PLAN_TABS.includes(uppercased)) return uppercased;
      }
    }
    // Priority 2: localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(`plan_tab_${featureId}`);
      if (stored && VALID_PLAN_TABS.includes(stored as ArtifactType)) return stored as ArtifactType;
    }
    // Priority 3: default
    return "PLAN";
  }, [featureId]);

  const [activeTab, setActiveTab] = useState<ArtifactType>(resolveInitialTab);

  // Sync activeTab when searchParams changes after hydration (e.g. browser navigation)
  useEffect(() => {
    const tabParam = searchParams?.get("tab");
    if (tabParam) {
      const uppercased = tabParam.toUpperCase() as ArtifactType;
      if (VALID_PLAN_TABS.includes(uppercased) && uppercased !== activeTab) {
        setActiveTab(uppercased);
      }
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = useCallback(
    (tab: ArtifactType) => {
      setActiveTab(tab);
      router.replace(`?tab=${tab.toLowerCase()}`, { scroll: false });
      if (typeof window !== "undefined") {
        localStorage.setItem(`plan_tab_${featureId}`, tab);
      }
    },
    [featureId, router]
  );

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
    updateData: updateFeature,
    loading,
    error,
  } = useDetailResource<FeatureDetail>({
    resourceId: featureId,
    fetchFn: fetchFeature,
  });

  // Initialize prevFeatureRef on first load
  useEffect(() => {
    if (feature && !prevFeatureRef.current) {
      prevFeatureRef.current = feature;
    }
  }, [feature]);

  // Redirect to plan list if feature not found
  useEffect(() => {
    if (!loading && error) {
      router.push(`/w/${workspaceSlug}/plan`);
    }
  }, [loading, error, router, workspaceSlug]);

  const refetchFeature = useCallback(async () => {
    try {
      const result = await fetchFeature(featureId);
      if (!result.success || !result.data) return;

      const next = result.data;
      const prev = prevFeatureRef.current;

      if (prev) {
        const highlights = computeSectionHighlights(prev, next);
        if (highlights) {
          setSectionHighlights(highlights);
          setTimeout(() => setSectionHighlights(null), 5000);
        }
      }

      prevFeatureRef.current = next;
      setFeature(next);
    } catch (err) {
      console.error("Error fetching feature:", err);
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

  // Fetch Sphinx integration status
  useEffect(() => {
    const fetchSphinxStatus = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceSlug}/settings/sphinx-integration`);
        if (response.ok) {
          const data = await response.json();
          const isReady = !!(
            data.sphinxEnabled &&
            data.sphinxChatPubkey &&
            data.sphinxBotId &&
            data.hasBotSecret
          );
          setSphinxReady(isReady);
        }
      } catch (error) {
        console.error("Error fetching Sphinx status:", error);
      }
    };

    fetchSphinxStatus();
  }, [workspaceSlug]);

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
        setIsChainVisible(false);
      }
    },
    [],
  );

  const handleFeatureTitleUpdate = useCallback(
    (update: FeatureTitleUpdateEvent) => {
      updateFeature({ title: update.newTitle });
    },
    [updateFeature],
  );

  usePusherConnection({
    featureId,
    onMessage: handleSSEMessage,
    onWorkflowStatusUpdate: handleWorkflowStatusUpdate,
    onFeatureUpdated: refetchFeature,
    onFeatureTitleUpdate: handleFeatureTitleUpdate,
  });

  const sendMessage = useCallback(
    async (messageText: string) => {
      const newMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
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
          
          // Start project log subscription if workflow was triggered
          if (data.workflow?.project_id) {
            setProjectId(data.workflow.project_id.toString());
            setIsChainVisible(true);
            clearLogs();
          }
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
    [featureId, session, clearLogs],
  );

  const handleArtifactAction = useCallback(
    async (messageId: string, action: { optionResponse: string }) => {
      const newMessage = createChatMessage({
        id: generateUniqueId(),
        message: action.optionResponse,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: messageId,
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
          
          // Start project log subscription if workflow was triggered
          if (data.workflow?.project_id) {
            setProjectId(data.workflow.project_id.toString());
            setIsChainVisible(true);
            clearLogs();
          }
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
    [featureId, session, clearLogs],
  );

  const allArtifacts = useMemo(() => (Array.isArray(messages) ? messages.flatMap((m) => m.artifacts || []) : []), [messages]);

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

  const togglePreview = useCallback(() => setShowPreview((v) => !v), []);

  const chatAreaProps = {
    messages,
    onSend: sendMessage,
    onArtifactAction: handleArtifactAction,
    inputDisabled,
    collaborators,
    isLoading,
    workflowStatus,
    taskTitle: featureTitle,
    workspaceSlug,
    featureId,
    featureTitle,
    taskMode: "live" as const,
    isChainVisible,
    lastLogLine,
    logs,
    sphinxInviteEnabled: sphinxReady,
  };

  const artifactsPanelProps = {
    artifacts: allArtifacts,
    workspaceId,
    taskId: featureId,
    planData,
    feature,
    featureId,
    onFeatureUpdate: setFeature,
    controlledTab: activeTab,
    onControlledTabChange: handleTabChange,
    sectionHighlights,
  };

  if (!initialLoadDone) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {showPreview ? (
          <ArtifactsPanel
            {...artifactsPanelProps}
            isMobile
            onTogglePreview={togglePreview}
          />
        ) : (
          <ChatArea
            {...chatAreaProps}
            showPreviewToggle
            showPreview={showPreview}
            onTogglePreview={togglePreview}
            previewToggleIcon={ClipboardList}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <ResizablePanelGroup direction="horizontal" className="flex flex-1 min-w-0 min-h-0 gap-2">
        <ResizablePanel defaultSize={40} minSize={30}>
          <div className="h-full min-h-0 min-w-0">
            <ChatArea {...chatAreaProps} />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={60} minSize={25}>
          <div className="h-full min-h-0 min-w-0">
            <ArtifactsPanel {...artifactsPanelProps} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

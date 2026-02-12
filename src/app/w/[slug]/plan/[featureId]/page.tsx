"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Check, Trash2, Bot, Mic } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import type { StakworkRunType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditableTitle } from "@/components/ui/editable-title";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { FeaturePriorityPopover } from "@/components/ui/feature-priority-popover";
import { ActionMenu } from "@/components/ui/action-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { UserStoriesSection } from "@/components/features/UserStoriesSection";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { AITextareaSection } from "@/components/features/AITextareaSection";
import { PersonasSection } from "@/components/features/PersonasSection";
import { TicketsList } from "@/components/features/TicketsList";
import { FeatureWhiteboardSection } from "@/components/features/FeatureWhiteboardSection";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { FeatureDetail } from "@/types/roadmap";

export default function FeatureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { slug: workspaceSlug, id: workspaceId } = useWorkspace();
  const featureId = params.featureId as string;
  
  // Get the page parameter to preserve pagination when navigating back
  const returnPage = searchParams.get("page") || "1";
  
  // Helper function to get the back navigation path
  const getBackPath = () => {
    const basePath = `/w/${workspaceSlug}/plan`;
    return returnPage !== "1" ? `${basePath}?page=${returnPage}` : basePath;
  };

  // Tab state management
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "overview");

  // User story creation state
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [creatingStory, setCreatingStory] = useState(false);
  const storyFocusRef = useRef(false);

  // Speech recognition state
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const ctrlHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isCtrlHoldingRef = useRef(false);
  const fieldForTranscriptRef = useRef<string | null>(null);
  const wasListeningRef = useRef(false);
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Pending StakworkRuns state (for tab indicators)
  const [pendingRunTypes, setPendingRunTypes] = useState<Set<StakworkRunType>>(new Set());

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

  // Fetch pending StakworkRuns for this feature (for tab indicators)
  const fetchPendingRuns = useCallback(async () => {
    if (!workspaceId || !featureId) return;

    try {
      const params = new URLSearchParams({
        workspaceId,
        featureId,
        status: "COMPLETED",
      });
      const response = await fetch(`/api/stakwork/runs?${params}`);
      if (response.ok) {
        const data = await response.json();
        // Check if tasks already exist in the feature
        const hasTasks = feature?.phases?.some(phase => phase.tasks && phase.tasks.length > 0) ?? false;
        
        // Filter for runs that need attention (decision is null)
        const pendingTypes = new Set<StakworkRunType>(
          data.runs
            .filter((run: { decision: string | null; type: StakworkRunType }) => {
              if (run.decision !== null) return false;
              // If tasks already exist, don't show indicator for TASK_GENERATION
              if (run.type === "TASK_GENERATION" && hasTasks) return false;
              return ["ARCHITECTURE", "REQUIREMENTS", "TASK_GENERATION", "USER_STORIES"].includes(run.type);
            })
            .map((run: { type: StakworkRunType }) => run.type)
        );
        setPendingRunTypes(pendingTypes);
      }
    } catch (err) {
      console.error("Failed to fetch pending runs:", err);
    }
  }, [workspaceId, featureId, feature?.phases]);

  useEffect(() => {
    fetchPendingRuns();
  }, [fetchPendingRuns]);

  // Clear focused field when clicking outside text inputs
  useEffect(() => {
    const handleFocusOut = (e: FocusEvent) => {
      // Check if the new focus target is a text input
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const isTextInput = relatedTarget?.tagName === "TEXTAREA" || relatedTarget?.tagName === "INPUT";
      if (!isTextInput) {
        setFocusedField(null);
      }
    };

    document.addEventListener("focusout", handleFocusOut);
    return () => document.removeEventListener("focusout", handleFocusOut);
  }, []);

  // Handle Ctrl key hold for speech recognition (only when a field is focused)
  useEffect(() => {
    if (!isSupported || !focusedField) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" && !e.repeat && !isCtrlHoldingRef.current) {
        ctrlHoldTimerRef.current = setTimeout(() => {
          isCtrlHoldingRef.current = true;
          startListening();
        }, 500);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        if (ctrlHoldTimerRef.current) {
          clearTimeout(ctrlHoldTimerRef.current);
          ctrlHoldTimerRef.current = null;
        }
        if (isCtrlHoldingRef.current) {
          isCtrlHoldingRef.current = false;
          stopListening();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (ctrlHoldTimerRef.current) clearTimeout(ctrlHoldTimerRef.current);
      // Stop listening if component unmounts or focusedField changes while recording
      if (isCtrlHoldingRef.current) {
        isCtrlHoldingRef.current = false;
        stopListening();
      }
    };
  }, [isSupported, focusedField, startListening, stopListening]);

  const handleSave = useCallback(
    async (updates: Partial<FeatureDetail> | { assigneeId: string | null }) => {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update feature");
      }

      const result = await response.json();
      if (result.success) {
        setFeature(result.data);
        updateOriginalData(result.data);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [featureId, setFeature],
  );

  const { saving, saved, savedField, handleFieldBlur, updateOriginalData, triggerSaved } = useAutoSave({
    data: feature,
    onSave: handleSave,
  });

  // Track which field we're recording for, and apply transcript when listening stops
  useEffect(() => {
    // When listening starts, capture which field we're recording for
    if (isListening && !wasListeningRef.current) {
      fieldForTranscriptRef.current = focusedField;
      wasListeningRef.current = true;
    }
    
    // When listening stops, apply the transcript to the field
    if (!isListening && wasListeningRef.current) {
      wasListeningRef.current = false;
      const targetField = fieldForTranscriptRef.current;
      
      if (transcript && targetField) {
        if (targetField === "newStory") {
          // For user stories input, append to the current value (no auto-save needed)
          const currentValue = newStoryTitle;
          const newValue = currentValue ? `${currentValue} ${transcript}` : transcript;
          setNewStoryTitle(newValue);
        } else if (feature) {
          const currentValue = 
            targetField === "brief" ? (feature.brief || "") :
            targetField === "requirements" ? (feature.requirements || "") :
            targetField === "architecture" ? (feature.architecture || "") : "";
          
          const newValue = currentValue ? `${currentValue} ${transcript}` : transcript;
          
          // Update local state and trigger auto-save
          if (targetField === "brief") {
            updateFeature({ brief: newValue });
            handleFieldBlur("brief", newValue);
          } else if (targetField === "requirements") {
            updateFeature({ requirements: newValue });
            handleFieldBlur("requirements", newValue);
          } else if (targetField === "architecture") {
            updateFeature({ architecture: newValue });
            handleFieldBlur("architecture", newValue);
          }
        }
      }
      
      resetTranscript();
      fieldForTranscriptRef.current = null;
    }
  }, [isListening, transcript, focusedField, feature, updateFeature, resetTranscript, newStoryTitle, setNewStoryTitle, handleFieldBlur]);

  const handleUpdateStatus = async (status: FeatureDetail["status"]) => {
    await handleSave({ status });
    triggerSaved("title");
  };

  const handleUpdatePriority = async (priority: FeatureDetail["priority"]) => {
    await handleSave({ priority });
    triggerSaved("title");
  };

  const handleUpdateAssignee = async (assigneeId: string | null) => {
    await handleSave({ assigneeId } as Partial<FeatureDetail>);
    triggerSaved("title");
  };

  const handleAddUserStory = async () => {
    if (!newStoryTitle.trim()) return;

    try {
      setCreatingStory(true);
      const response = await fetch(`/api/features/${featureId}/user-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newStoryTitle.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to create user story");
      }

      const result = await response.json();
      if (result.success && feature) {
        setFeature({
          ...feature,
          userStories: [...feature.userStories, result.data],
        });
        storyFocusRef.current = true;
        setNewStoryTitle("");
      }
    } catch (error) {
      console.error("Failed to create user story:", error);
    } finally {
      setCreatingStory(false);
    }
  };

  const handleUpdateUserStory = async (storyId: string, title: string) => {
    try {
      const response = await fetch(`/api/user-stories/${storyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user story");
      }

      const result = await response.json();
      if (result.success && feature) {
        setFeature({
          ...feature,
          userStories: feature.userStories.map((story) => (story.id === storyId ? { ...story, title } : story)),
        });
      }
    } catch (error) {
      console.error("Failed to update user story:", error);
      throw error;
    }
  };

  const handleDeleteUserStory = async (storyId: string) => {
    try {
      const response = await fetch(`/api/user-stories/${storyId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete user story");
      }

      if (feature) {
        setFeature({
          ...feature,
          userStories: feature.userStories.filter((story) => story.id !== storyId),
        });
      }
    } catch (error) {
      console.error("Failed to delete user story:", error);
    }
  };

  const handleReorderUserStories = async (stories: FeatureDetail["userStories"]) => {
    if (!feature) return;

    // Optimistic update
    setFeature({
      ...feature,
      userStories: stories,
    });

    try {
      const reorderData = stories.map((story, index) => ({
        id: story.id,
        order: index,
      }));

      const response = await fetch(`/api/features/${featureId}/user-stories/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stories: reorderData }),
      });

      if (!response.ok) {
        throw new Error("Failed to reorder user stories");
      }
    } catch (error) {
      console.error("Failed to reorder user stories:", error);
      // On error, refetch to restore correct order
      const response = await fetch(`/api/features/${featureId}`);
      const result = await response.json();
      if (result.success) {
        setFeature(result.data);
      }
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Update URL without navigation
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState({}, "", url.toString());
  };

  // Map tabs to their associated StakworkRun types
  const TAB_RUN_TYPES: Record<string, StakworkRunType[]> = {
    overview: ["REQUIREMENTS", "USER_STORIES"],
    architecture: ["ARCHITECTURE"],
    tasks: ["TASK_GENERATION"],
  };

  const tabNeedsAttention = (tab: string): boolean => {
    return TAB_RUN_TYPES[tab]?.some((type) => pendingRunTypes.has(type)) ?? false;
  };

  const handleDeleteFeature = async () => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete feature");
      }

      // Navigate back to the list, preserving the page number
      router.push(getBackPath());
    } catch (error) {
      console.error("Failed to delete feature:", error);
    }
  };

  const handleAcceptGeneratedStory = async (storyTitle: string) => {
    try {
      const response = await fetch(`/api/features/${featureId}/user-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: storyTitle }),
      });

      if (!response.ok) {
        throw new Error("Failed to create user story");
      }

      const result = await response.json();
      if (result.success && feature) {
        setFeature({
          ...feature,
          userStories: [...feature.userStories, result.data],
        });
      }
    } catch (error) {
      console.error("Failed to accept generated story:", error);
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push(getBackPath())}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </span>
        </div>

        {/* Feature Details Card */}
        <Card>
          <CardHeader>
            <div className="space-y-4">
              {/* Title - match text-4xl size */}
              <Skeleton className="h-14 w-3/4" />

              {/* Status & Assignee */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Status:</Label>
                  <Skeleton className="h-7 w-24" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Assigned:</Label>
                  <Skeleton className="h-7 w-32" />
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue="overview">
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="architecture">Architecture</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 pt-0">
                {/* Brief */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 min-h-9">
                    <Label className="text-base font-semibold">Brief</Label>
                  </div>
                  <Skeleton className="h-24 w-full rounded-md" />
                </div>
              </TabsContent>

              <TabsContent value="architecture" className="space-y-6 pt-0">
                {/* Architecture */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 min-h-9">
                    <Label className="text-sm font-medium">Architecture</Label>
                  </div>
                  <Skeleton className="h-48 w-full rounded-md" />
                </div>
              </TabsContent>

              <TabsContent value="tasks" className="space-y-6 pt-0">
                {/* Tasks */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 min-h-9">
                    <Label className="text-sm font-medium">Tasks</Label>
                  </div>
                  <Skeleton className="h-14 w-full rounded-lg" />
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !feature) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push(getBackPath())}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error || "Feature not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(getBackPath())}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      {/* Feature Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Title - inline editable */}
            <div className="flex items-center gap-3">
              <EditableTitle
                id="title"
                value={feature.title}
                onChange={(value) => updateFeature({ title: value })}
                onBlur={(value) => handleFieldBlur("title", value)}
                placeholder="Enter feature title..."
                size="large"
              />
              {/* Save indicator - only show for title/status/assignee changes */}
              {savedField === "title" && saved && !saving && (
                <div className="flex items-center gap-2 text-sm flex-shrink-0">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">Saved</span>
                </div>
              )}
            </div>

            {/* Status, Priority, Assignee & Actions */}
            <div className="flex flex-wrap items-center gap-4">
              <StatusPopover statusType="feature" currentStatus={feature.status} onUpdate={handleUpdateStatus} />
              <FeaturePriorityPopover currentPriority={feature.priority} onUpdate={handleUpdatePriority} showLowPriority={true} />
              <AssigneeCombobox
                workspaceSlug={workspaceSlug}
                currentAssignee={feature.assignee}
                onSelect={handleUpdateAssignee}
              />

              {/* Actions Menu */}
              <ActionMenu
                actions={[
                  {
                    label: "Delete",
                    icon: Trash2,
                    variant: "destructive",
                    confirmation: {
                      title: "Delete Feature",
                      description: `Are you sure you want to delete "${feature.title}"? This will also delete all associated phases and tickets.`,
                      onConfirm: handleDeleteFeature,
                    },
                  },
                ]}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            {(() => {
              // Compute Task Coordinator progress from all phases
              const allTasks = feature.phases?.flatMap((p) => p.tasks) || [];
              const tcTasks = allTasks.filter((t) => t.assignee?.id?.startsWith("system:task-coordinator"));
              const tcTotal = tcTasks.length;
              const tcQueued = tcTasks.filter((t) => t.status === "TODO").length;
              const tcRunning = tcTasks.filter((t) => t.status === "IN_PROGRESS").length;
              const tcDone = tcTasks.filter((t) => t.status === "DONE").length;
              const showTcProgress = tcTotal > 0 && tcDone < tcTotal;

              return (
                <div className="flex items-center gap-4 mb-6">
                  <TabsList>
                    {["overview", "architecture", "tasks"].map((tab) => (
                      <TabsTrigger key={tab} value={tab}>
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        {tabNeedsAttention(tab) && (
                          <span className="ml-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full inline-block" />
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {/* Speech Recognition Indicator */}
                  {isSupported && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={`flex items-center gap-1.5 text-xs ${isListening ? "text-foreground" : "text-muted-foreground"}`}>
                            <Mic className={`h-4 w-4 ${isListening ? "animate-pulse" : ""}`} />
                            {isListening && <span>Listening...</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Hold Ctrl while focused on a text field to use voice input</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Task Coordinator Progress */}
                  {showTcProgress && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="h-4 w-4" />
                      <div className="flex items-center gap-3">
                        {tcQueued > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                            <span>{tcQueued} queued</span>
                          </div>
                        )}
                        {tcRunning > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            <span>{tcRunning} running</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>{tcDone} done</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <TabsContent value="overview" className="space-y-6 pt-0">
              {/* Brief - Always visible */}
              <AutoSaveTextarea
                id="brief"
                label="Brief"
                value={feature.brief}
                rows={4}
                className="resize-none"
                savedField={savedField}
                saving={saving}
                saved={saved}
                onChange={(value) => updateFeature({ brief: value })}
                onBlur={(value) => handleFieldBlur("brief", value)}
                onFocus={() => setFocusedField("brief")}
                featureId={featureId}
                enableImageUpload={true}
                isListening={isListening && focusedField === "brief"}
                transcript={focusedField === "brief" ? transcript : ""}
              />

              {/* User Personas - Always visible */}
              <PersonasSection
                personas={feature.personas || []}
                savedField={savedField}
                saving={saving}
                saved={saved}
                onChange={(value) => updateFeature({ personas: value })}
                onBlur={(value) => handleFieldBlur("personas", value)}
              />

              {/* User Stories - Always visible */}
              <UserStoriesSection
                featureId={featureId}
                userStories={feature.userStories}
                newStoryTitle={newStoryTitle}
                creatingStory={creatingStory}
                onNewStoryTitleChange={setNewStoryTitle}
                onAddUserStory={handleAddUserStory}
                onDeleteUserStory={handleDeleteUserStory}
                onUpdateUserStory={handleUpdateUserStory}
                onReorderUserStories={handleReorderUserStories}
                onAcceptGeneratedStory={handleAcceptGeneratedStory}
                shouldFocusRef={storyFocusRef}
                onFocus={() => setFocusedField("newStory")}
                isListening={isListening && focusedField === "newStory"}
                transcript={focusedField === "newStory" ? transcript : ""}
              />

              {/* Requirements - Always visible */}
              <AITextareaSection
                id="requirements"
                label="Requirements"
                type="requirements"
                featureId={featureId}
                value={feature.requirements}
                savedField={savedField}
                saving={saving}
                saved={saved}
                onChange={(value) => updateFeature({ requirements: value })}
                onBlur={(value) => handleFieldBlur("requirements", value)}
                onFocus={() => setFocusedField("requirements")}
                onDecisionMade={fetchPendingRuns}
                isListening={isListening && focusedField === "requirements"}
                transcript={focusedField === "requirements" ? transcript : ""}
              />

              {/* Navigation buttons */}
              <div className="flex justify-end pt-4">
                <Button onClick={() => setActiveTab("architecture")}>Next</Button>
              </div>
            </TabsContent>

            <TabsContent value="architecture" className="space-y-6 pt-0">
              <AITextareaSection
                id="architecture"
                label="Architecture"
                type="architecture"
                featureId={featureId}
                value={feature.architecture}
                savedField={savedField}
                saving={saving}
                saved={saved}
                onChange={(value) => updateFeature({ architecture: value })}
                onBlur={(value) => handleFieldBlur("architecture", value)}
                onFocus={() => setFocusedField("architecture")}
                initialDiagramUrl={feature.diagramUrl}
                onDecisionMade={fetchPendingRuns}
                isListening={isListening && focusedField === "architecture"}
                transcript={focusedField === "architecture" ? transcript : ""}
              />

              {/* Whiteboard Section */}
              <FeatureWhiteboardSection
                featureId={featureId}
                workspaceId={workspaceId}
              />

              {/* Navigation buttons */}
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveTab("overview")}>
                  Back
                </Button>
                <Button onClick={() => setActiveTab("tasks")}>Next</Button>
              </div>
            </TabsContent>

            <TabsContent value="tasks" className="space-y-6 pt-0">
              <TicketsList featureId={featureId} feature={feature} onUpdate={setFeature} onDecisionMade={fetchPendingRuns} />

              {/* Navigation buttons */}
              <div className="flex justify-start pt-4">
                <Button variant="outline" onClick={() => setActiveTab("architecture")}>
                  Back
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

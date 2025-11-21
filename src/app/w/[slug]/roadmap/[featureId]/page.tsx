"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Check, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditableTitle } from "@/components/ui/editable-title";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { ActionMenu } from "@/components/ui/action-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { UserStoriesSection } from "@/components/features/UserStoriesSection";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { AITextareaSection } from "@/components/features/AITextareaSection";
import { PersonasSection } from "@/components/features/PersonasSection";
import { TicketsList } from "@/components/features/TicketsList";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { FeatureDetail } from "@/types/roadmap";

export default function FeatureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const featureId = params.featureId as string;

  // Tab state management
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "overview");
  const [personasExpanded, setPersonasExpanded] = useState(false);
  const [userStoriesExpanded, setUserStoriesExpanded] = useState(false);
  const [requirementsExpanded, setRequirementsExpanded] = useState(false);

  // User story creation state
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [creatingStory, setCreatingStory] = useState(false);
  const storyFocusRef = useRef(false);

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

  // Auto-expand sections if they have content
  useEffect(() => {
    if (feature) {
      // Check if personas have content
      const hasPersonas =
        feature.personas && feature.personas.length > 0 && feature.personas.some((p) => p.trim().length > 0);
      setPersonasExpanded(hasPersonas || false);

      // Check if user stories exist
      const hasUserStories = feature.userStories && feature.userStories.length > 0;
      setUserStoriesExpanded(hasUserStories || false);

      // Check if requirements have content
      const hasRequirements = feature.requirements && feature.requirements.trim().length > 0;
      setRequirementsExpanded(hasRequirements || false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature?.id]); // Only run when feature id changes (initial load)

  const handleUpdateStatus = async (status: FeatureDetail["status"]) => {
    await handleSave({ status });
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

  const handleDeleteFeature = async () => {
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete feature");
      }

      router.push(`/w/${workspaceSlug}/roadmap`);
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
          <Button variant="ghost" size="sm" onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}>
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
                <TabsTrigger value="tickets">Tasks</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 pt-0">
                {/* Brief */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 min-h-9">
                    <Label className="text-sm font-medium">Brief</Label>
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

              <TabsContent value="tickets" className="space-y-6 pt-0">
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
        <Button variant="ghost" size="sm" onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}>
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
        <Button variant="ghost" size="sm" onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}>
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

            {/* Status, Assignee & Actions */}
            <div className="flex flex-wrap items-center gap-4">
              <StatusPopover statusType="feature" currentStatus={feature.status} onUpdate={handleUpdateStatus} />
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
            <TabsList className="mb-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="architecture">Architecture</TabsTrigger>
              <TabsTrigger value="tickets">Tasks</TabsTrigger>
            </TabsList>

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
                featureId={featureId}
                enableImageUpload={true}
              />

              {/* User Personas - Collapsible */}
              <Collapsible open={personasExpanded} onOpenChange={setPersonasExpanded}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                  <ChevronRight className={`h-4 w-4 transition-transform ${personasExpanded ? "rotate-90" : ""}`} />
                  User Personas
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <PersonasSection
                    personas={feature.personas || []}
                    savedField={savedField}
                    saving={saving}
                    saved={saved}
                    onChange={(value) => updateFeature({ personas: value })}
                    onBlur={(value) => handleFieldBlur("personas", value)}
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* User Stories - Collapsible */}
              <Collapsible open={userStoriesExpanded} onOpenChange={setUserStoriesExpanded}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                  <ChevronRight className={`h-4 w-4 transition-transform ${userStoriesExpanded ? "rotate-90" : ""}`} />
                  User Stories
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
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
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* Requirements - Collapsible */}
              <Collapsible open={requirementsExpanded} onOpenChange={setRequirementsExpanded}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                  <ChevronRight className={`h-4 w-4 transition-transform ${requirementsExpanded ? "rotate-90" : ""}`} />
                  Requirements
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
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
                  />
                </CollapsibleContent>
              </Collapsible>

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
              />

              {/* Navigation buttons */}
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setActiveTab("overview")}>
                  Back
                </Button>
                <Button onClick={() => setActiveTab("tickets")}>Next</Button>
              </div>
            </TabsContent>

            <TabsContent value="tickets" className="space-y-6 pt-0">
              <TicketsList featureId={featureId} feature={feature} onUpdate={setFeature} />

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

"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditableTitle } from "@/components/ui/editable-title";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { ActionMenu } from "@/components/ui/action-menu";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { UserStoriesSection } from "@/components/features/UserStoriesSection";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { AITextareaSection } from "@/components/features/AITextareaSection";
import { PhaseSection } from "@/components/features/PhaseSection";
import { PersonasSection } from "@/components/features/PersonasSection";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useDetailResource } from "@/hooks/useDetailResource";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { FeatureDetail } from "@/types/roadmap";

export default function FeatureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const featureId = params.featureId as string;

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
    [featureId, setFeature],
  );

  const { saving, saved, savedField, handleFieldBlur, updateOriginalData, triggerSaved } = useAutoSave({
    data: feature,
    onSave: handleSave,
  });

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

  const handleUpdatePhases = (updatedPhases: FeatureDetail["phases"]) => {
    if (!feature) return;
    setFeature({
      ...feature,
      phases: updatedPhases,
    });
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
              {/* Title */}
              <Skeleton className="h-16 w-3/4" />

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

          <CardContent className="space-y-6">
            <Separator />

            {/* Brief */}
            <div className="space-y-2">
              <Label htmlFor="brief" className="text-sm font-medium">
                Brief
              </Label>
              <Skeleton className="h-24 w-full rounded-md" />
            </div>

            <Separator />

            {/* User Personas */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">User Personas</Label>
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>

            <Separator />

            {/* User Stories */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">User Stories</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Define the user stories and acceptance criteria for this feature.
                </p>
              </div>
              <Skeleton className="h-14 w-full rounded-lg" />
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>

            <Separator />

            {/* Requirements */}
            <div className="space-y-2">
              <Label htmlFor="requirements" className="text-sm font-medium">
                Requirements
              </Label>
              <p className="text-sm text-muted-foreground">
                Detailed product and technical requirements for implementation.
              </p>
              <Skeleton className="h-32 w-full rounded-md" />
            </div>

            {/* Architecture */}
            <div className="space-y-2">
              <Label htmlFor="architecture" className="text-sm font-medium">
                Architecture
              </Label>
              <p className="text-sm text-muted-foreground">
                Technical architecture, design decisions, and implementation notes.
              </p>
              <Skeleton className="h-32 w-full rounded-md" />
            </div>
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
                size="xlarge"
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

        <CardContent className="space-y-6">
          <AutoSaveTextarea
            id="brief"
            label="Brief"
            description="High-level overview of what this feature is and why it matters."
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

          <PersonasSection
            personas={feature.personas || []}
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => updateFeature({ personas: value })}
            onBlur={(value) => handleFieldBlur("personas", value)}
          />

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

          <AITextareaSection
            id="requirements"
            label="Requirements"
            description="Functional and technical specifications for implementation."
            type="requirements"
            featureId={featureId}
            value={feature.requirements}
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => updateFeature({ requirements: value })}
            onBlur={(value) => handleFieldBlur("requirements", value)}
          />

          <AITextareaSection
            id="architecture"
            label="Architecture"
            description="Technical design decisions and implementation approach."
            type="architecture"
            featureId={featureId}
            value={feature.architecture}
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => updateFeature({ architecture: value })}
            onBlur={(value) => handleFieldBlur("architecture", value)}
          />

          <PhaseSection
            featureId={featureId}
            workspaceSlug={workspaceSlug}
            phases={feature.phases || []}
            onUpdate={handleUpdatePhases}
          />
        </CardContent>
      </Card>
    </div>
  );
}

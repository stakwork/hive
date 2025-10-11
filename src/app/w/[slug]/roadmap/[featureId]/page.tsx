"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPopover } from "@/components/ui/status-popover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { UserStoriesSection } from "@/components/features/UserStoriesSection";
import { AutoSaveTextarea } from "@/components/features/AutoSaveTextarea";
import { PhaseSection } from "@/components/features/PhaseSection";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { FeatureDetail } from "@/types/roadmap";

export default function FeatureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const featureId = params.featureId as string;

  const [feature, setFeature] = useState<FeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null); // Track which field is being edited
  const [savedField, setSavedField] = useState<string | null>(null); // Track which field is being saved/was saved

  // Track original feature values for comparison
  const originalFeatureRef = useRef<FeatureDetail | null>(null);

  // User story creation state
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [creatingStory, setCreatingStory] = useState(false);

  // Fetch feature data
  useEffect(() => {
    const fetchFeature = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/features/${featureId}`);

        if (!response.ok) {
          throw new Error("Failed to fetch feature");
        }

        const result = await response.json();
        if (result.success) {
          setFeature(result.data);
          // Store original values for comparison
          originalFeatureRef.current = result.data;
        } else {
          throw new Error("Failed to fetch feature");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (featureId) {
      fetchFeature();
    }
  }, [featureId]);

  const updateFeature = async (updates: Partial<FeatureDetail> & { assigneeId?: string | null }) => {
    try {
      setSaving(true);

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
        // Update original values after successful save
        originalFeatureRef.current = result.data;

        // Show "Saved" indicator
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          setSavedField(null);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to update feature:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldBlur = (field: string, value: string | null) => {
    // Compare against original value, not current state
    const originalValue = originalFeatureRef.current?.[field as keyof FeatureDetail];
    if (feature && originalValue !== value) {
      setSavedField(field); // Track which field is being saved
      updateFeature({ [field]: value });
    }
  };

  const handleFieldChange = (field: string) => {
    // Set active field for textarea edits
    if (field === 'brief' || field === 'requirements' || field === 'architecture') {
      setActiveField(field);
    } else {
      setActiveField('general'); // For title, status, assignee
    }

    // Clear saved state
    setSaved(false);
  };

  const handleUpdateStatus = async (status: FeatureDetail["status"]) => {
    setSavedField('general');
    await updateFeature({ status });
  };

  const handleUpdateAssignee = async (assigneeId: string | null) => {
    setSavedField('general');
    await updateFeature({ assigneeId });
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
        setNewStoryTitle("");
      }
    } catch (error) {
      console.error("Failed to create user story:", error);
    } finally {
      setCreatingStory(false);
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

      const response = await fetch(
        `/api/features/${featureId}/user-stories/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stories: reorderData }),
        }
      );

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

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Roadmap
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Roadmap
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Roadmap
        </Button>
      </div>

      {/* Feature Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Title - inline editable */}
            <div className="flex items-center gap-3">
              <Input
                id="title"
                value={feature.title}
                onChange={(e) => {
                  setFeature({ ...feature, title: e.target.value });
                  handleFieldChange('title');
                }}
                onBlur={(e) => handleFieldBlur("title", e.target.value)}
                className="!text-5xl !font-bold !h-auto !py-0 !px-0 !border-none !bg-transparent !shadow-none focus-visible:!ring-0 focus-visible:!border-none focus:!border-none focus:!bg-transparent focus:!shadow-none focus:!ring-0 focus:!outline-none !tracking-tight !rounded-none flex-1"
                placeholder="Enter feature title..."
              />
              {/* Save indicator for general edits (title, status, assignee) */}
              {savedField === 'general' && saved && !saving && (
                <div className="flex items-center gap-2 text-sm flex-shrink-0">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">Saved</span>
                </div>
              )}
            </div>

            {/* Status & Assignee */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Status:</Label>
                <StatusPopover
                  statusType="feature"
                  currentStatus={feature.status}
                  onUpdate={handleUpdateStatus}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Assigned:</Label>
                <AssigneeCombobox
                  workspaceSlug={workspaceSlug}
                  currentAssignee={feature.assignee}
                  onSelect={handleUpdateAssignee}
                />
              </div>
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
            onChange={(value) => {
              setFeature({ ...feature, brief: value });
              handleFieldChange('brief');
            }}
            onBlur={(value) => handleFieldBlur("brief", value)}
            onFocus={() => setActiveField('brief')}
          />

          <UserStoriesSection
            userStories={feature.userStories}
            newStoryTitle={newStoryTitle}
            creatingStory={creatingStory}
            onNewStoryTitleChange={setNewStoryTitle}
            onAddUserStory={handleAddUserStory}
            onDeleteUserStory={handleDeleteUserStory}
            onReorderUserStories={handleReorderUserStories}
          />

          <AutoSaveTextarea
            id="requirements"
            label="Requirements"
            description="Functional and technical specifications for implementation."
            value={feature.requirements}
            rows={8}
            className="font-mono text-sm min-h-[200px]"
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => {
              setFeature({ ...feature, requirements: value });
              handleFieldChange('requirements');
            }}
            onBlur={(value) => handleFieldBlur("requirements", value)}
            onFocus={() => setActiveField('requirements')}
          />

          <AutoSaveTextarea
            id="architecture"
            label="Architecture"
            description="Technical design decisions and implementation approach."
            value={feature.architecture}
            rows={8}
            className="font-mono text-sm min-h-[200px]"
            savedField={savedField}
            saving={saving}
            saved={saved}
            onChange={(value) => {
              setFeature({ ...feature, architecture: value });
              handleFieldChange('architecture');
            }}
            onBlur={(value) => handleFieldBlur("architecture", value)}
            onFocus={() => setActiveField('architecture')}
          />

          <PhaseSection
            featureId={featureId}
            phases={feature.phases || []}
            onUpdate={handleUpdatePhases}
          />
        </CardContent>
      </Card>
    </div>
  );
}

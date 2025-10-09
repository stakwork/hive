"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Trash2, Eye, Edit3, Check, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Item,
  ItemGroup,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import { StatusPopover } from "@/components/features/StatusPopover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { FeatureStatus, FeaturePriority } from "@/types/roadmap";

interface UserStory {
  id: string;
  title: string;
  order: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Feature {
  id: string;
  title: string;
  brief: string | null;
  requirements: string | null;
  architecture: string | null;
  status: FeatureStatus;
  priority: FeaturePriority;
  assignee: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  userStories: UserStory[];
  createdAt: string;
  updatedAt: string;
}

function SortableUserStory({
  story,
  onDelete,
}: {
  story: UserStory;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: story.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50 z-50" : ""}
    >
      <Item variant="outline" size="sm">
        <Button
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 hover:bg-transparent cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
          <span className="sr-only">Drag to reorder</span>
        </Button>
        <ItemContent>
          <ItemTitle>{story.title}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(story.id)}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </ItemActions>
      </Item>
    </div>
  );
}

export default function FeatureDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { id: workspaceId, slug: workspaceSlug } = useWorkspace();
  const featureId = params.featureId as string;

  const [feature, setFeature] = useState<Feature | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track original feature values for comparison
  const originalFeatureRef = useRef<Feature | null>(null);

  // User story creation state
  const [newStoryTitle, setNewStoryTitle] = useState("");
  const [creatingStory, setCreatingStory] = useState(false);
  const storyInputRef = useRef<HTMLInputElement>(null);

  // Markdown preview state
  const [requirementsPreview, setRequirementsPreview] = useState(false);
  const [architecturePreview, setArchitecturePreview] = useState(false);

  const statusColors: Record<string, string> = {
    BACKLOG: "bg-gray-100 text-gray-700 border-gray-200",
    PLANNED: "bg-purple-50 text-purple-700 border-purple-200",
    IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
    COMPLETED: "bg-green-50 text-green-700 border-green-200",
    CANCELLED: "bg-red-50 text-red-700 border-red-200",
  };

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

  const updateFeature = async (updates: Partial<Feature>) => {
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
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      console.error("Failed to update feature:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldBlur = (field: string, value: string | null) => {
    // Compare against original value, not current state
    const originalValue = originalFeatureRef.current?.[field as keyof Feature];
    if (feature && originalValue !== value) {
      updateFeature({ [field]: value });
    }
  };

  const handleUpdateStatus = async (status: FeatureStatus) => {
    await updateFeature({ status });
  };

  const handleUpdateAssignee = async (assigneeId: string | null) => {
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
      // Auto-focus the input for continuous entry after state updates
      requestAnimationFrame(() => {
        storyInputRef.current?.focus();
      });
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

  const reorderUserStories = async (stories: UserStory[]) => {
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

      // Don't update state on success - we already did optimistic update
      // This prevents the glitch/flicker
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

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Memoize story IDs for sortable context
  const storyIds = useMemo(
    () => feature?.userStories.map((story) => story.id) ?? [],
    [feature?.userStories]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!feature || !over || active.id === over.id) {
      return;
    }

    const oldIndex = feature.userStories.findIndex((s) => s.id === active.id);
    const newIndex = feature.userStories.findIndex((s) => s.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedStories = arrayMove(
        feature.userStories,
        oldIndex,
        newIndex
      ).map((story, index) => ({
        ...story,
        order: index, // Update the order property to match new position
      }));

      // Optimistic update
      setFeature({
        ...feature,
        userStories: reorderedStories,
      });

      // Call API to save new order
      reorderUserStories(reorderedStories);
    }
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
              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm font-medium">
                  Feature Title
                </Label>
                <Skeleton className="h-14 w-full" />
              </div>

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
        {saving && (
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving...
          </span>
        )}
        {!saving && saved && (
          <span className="text-sm text-green-600 flex items-center gap-2">
            <Check className="h-3 w-3" />
            Saved
          </span>
        )}
      </div>

      {/* Feature Details Card */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium">
                Feature Title
              </Label>
              <Input
                id="title"
                value={feature.title}
                onChange={(e) => setFeature({ ...feature, title: e.target.value })}
                onBlur={(e) => handleFieldBlur("title", e.target.value)}
                className="text-2xl font-semibold h-auto py-3 px-4"
                placeholder="Enter feature title..."
              />
            </div>

            {/* Status & Assignee */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Status:</Label>
                <StatusPopover
                  currentStatus={feature.status}
                  onUpdate={handleUpdateStatus}
                  statusColors={statusColors}
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
          <Separator />

          {/* Brief */}
          <div className="space-y-2">
            <Label htmlFor="brief" className="text-sm font-medium">
              Brief
            </Label>
            <Textarea
              id="brief"
              placeholder="Describe why you want to add this feature in a few sentences..."
              value={feature.brief || ""}
              onChange={(e) => setFeature({ ...feature, brief: e.target.value })}
              onBlur={(e) => handleFieldBlur("brief", e.target.value || null)}
              rows={4}
              className="resize-none"
            />
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

            <div className="rounded-lg border bg-muted/30">
              <div className="flex gap-2 p-4">
                <Input
                  ref={storyInputRef}
                  placeholder="As a user, I want to..."
                  value={newStoryTitle}
                  onChange={(e) => setNewStoryTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creatingStory) {
                      handleAddUserStory();
                    }
                  }}
                  disabled={creatingStory}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleAddUserStory}
                  disabled={creatingStory || !newStoryTitle.trim()}
                >
                  {creatingStory ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>

              {feature.userStories.length > 0 && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={storyIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="px-4 pb-4 flex flex-col gap-2">
                      {feature.userStories
                        .sort((a, b) => a.order - b.order)
                        .map((story) => (
                          <SortableUserStory
                            key={story.id}
                            story={story}
                            onDelete={handleDeleteUserStory}
                          />
                        ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          <Separator />

          {/* Requirements */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="requirements" className="text-sm font-medium">
                  Requirements
                </Label>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={!requirementsPreview ? "secondary" : "ghost"}
                  onClick={() => setRequirementsPreview(false)}
                  className="h-8 px-2"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={requirementsPreview ? "secondary" : "ghost"}
                  onClick={() => setRequirementsPreview(true)}
                  className="h-8 px-2"
                  disabled={!feature.requirements?.trim()}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {!requirementsPreview ? (
              <Textarea
                id="requirements"
                placeholder="List the functional and technical requirements..."
                value={feature.requirements || ""}
                onChange={(e) => setFeature({ ...feature, requirements: e.target.value })}
                onBlur={(e) => handleFieldBlur("requirements", e.target.value || null)}
                rows={8}
                className="resize-y font-mono text-sm min-h-[200px]"
              />
            ) : (
              <div className="rounded-md border p-4 min-h-[200px]">
                <MarkdownRenderer>{feature.requirements || ""}</MarkdownRenderer>
              </div>
            )}
          </div>

          {/* Architecture */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="architecture" className="text-sm font-medium">
                  Architecture
                </Label>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={!architecturePreview ? "secondary" : "ghost"}
                  onClick={() => setArchitecturePreview(false)}
                  className="h-8 px-2"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={architecturePreview ? "secondary" : "ghost"}
                  onClick={() => setArchitecturePreview(true)}
                  className="h-8 px-2"
                  disabled={!feature.architecture?.trim()}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {!architecturePreview ? (
              <Textarea
                id="architecture"
                placeholder="Describe the technical architecture and design approach..."
                value={feature.architecture || ""}
                onChange={(e) => setFeature({ ...feature, architecture: e.target.value })}
                onBlur={(e) => handleFieldBlur("architecture", e.target.value || null)}
                rows={8}
                className="resize-y font-mono text-sm min-h-[200px]"
              />
            ) : (
              <div className="rounded-md border p-4 min-h-[200px]">
                <MarkdownRenderer>{feature.architecture || ""}</MarkdownRenderer>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

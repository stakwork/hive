"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Loader2, Check, X, Sparkles } from "lucide-react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SortableUserStory } from "./SortableUserStory";
import { AIButton } from "@/components/ui/ai-button";
import type { FeatureDetail } from "@/types/roadmap";

interface GeneratedStory {
  title: string;
}

interface UserStoriesSectionProps {
  featureId: string;
  userStories: FeatureDetail["userStories"];
  newStoryTitle: string;
  creatingStory: boolean;
  onNewStoryTitleChange: (title: string) => void;
  onAddUserStory: () => void;
  onDeleteUserStory: (storyId: string) => void;
  onUpdateUserStory: (storyId: string, title: string) => Promise<void>;
  onReorderUserStories: (stories: FeatureDetail["userStories"]) => void;
  onAcceptGeneratedStory: (title: string) => Promise<void>;
  shouldFocusRef: React.MutableRefObject<boolean>;
}

export function UserStoriesSection({
  featureId,
  userStories,
  newStoryTitle,
  creatingStory,
  onNewStoryTitleChange,
  onAddUserStory,
  onDeleteUserStory,
  onUpdateUserStory,
  onReorderUserStories,
  onAcceptGeneratedStory,
  shouldFocusRef,
}: UserStoriesSectionProps) {
  const storyInputRef = useRef<HTMLInputElement>(null);
  const [aiSuggestions, setAiSuggestions] = useState<GeneratedStory[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedStoryId, setSavedStoryId] = useState<string | null>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Auto-focus after story creation (not on mount)
  useEffect(() => {
    if (shouldFocusRef.current && !creatingStory && !newStoryTitle) {
      storyInputRef.current?.focus();
      shouldFocusRef.current = false;
    }
  }, [creatingStory, newStoryTitle]);

  // Memoize story IDs for sortable context
  const storyIds = useMemo(() => userStories.map((story) => story.id), [userStories]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = userStories.findIndex((s) => s.id === active.id);
    const newIndex = userStories.findIndex((s) => s.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedStories = arrayMove(userStories, oldIndex, newIndex).map((story, index) => ({
        ...story,
        order: index,
      }));

      onReorderUserStories(reorderedStories);
    }
  };

  const handleAiGenerated = (stories: GeneratedStory[]) => {
    // Stagger animation: add delay between each story
    stories.forEach((story, index) => {
      setTimeout(() => {
        setAiSuggestions((prev) => [...prev, story]);
      }, index * 200);
    });
  };

  const handleAcceptAi = async (story: GeneratedStory, index: number) => {
    setAccepting(`ai-${index}`);
    await onAcceptGeneratedStory(story.title);
    setAiSuggestions((prev) => prev.filter((_, i) => i !== index));
    setAccepting(null);
  };

  const handleRejectAi = (index: number) => {
    setAiSuggestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateStory = async (storyId: string, title: string) => {
    setSaving(true);
    setSavedStoryId(storyId);

    try {
      await onUpdateUserStory(storyId, title);
      // Show saved indicator (matches useAutoSave pattern)
      setTimeout(() => {
        setSavedStoryId(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to update user story:", error);
      setSavedStoryId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">User Stories</Label>
          <AIButton<GeneratedStory>
            endpoint={`/api/features/${featureId}/generate`}
            params={{
              type: "userStories",
              existingStories: [...userStories.map((s) => s.title), ...aiSuggestions.map((s) => s.title)],
            }}
            onGenerated={handleAiGenerated}
            tooltip="Generate with AI"
            iconOnly
          />
        </div>
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
            onChange={(e) => onNewStoryTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingStory) {
                onAddUserStory();
              }
            }}
            disabled={creatingStory}
            className="flex-1"
          />
          <Button size="sm" onClick={onAddUserStory} disabled={creatingStory || !newStoryTitle.trim()}>
            {creatingStory ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </div>

        {(userStories.length > 0 || aiSuggestions.length > 0) && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={storyIds} strategy={verticalListSortingStrategy}>
              <div className="px-4 pb-4 flex flex-col gap-2">
                {userStories
                  .sort((a, b) => a.order - b.order)
                  .map((story) => (
                    <SortableUserStory
                      key={story.id}
                      story={story}
                      onDelete={onDeleteUserStory}
                      onUpdate={handleUpdateStory}
                      saving={saving && savedStoryId === story.id}
                      saved={!saving && savedStoryId === story.id}
                    />
                  ))}

                {aiSuggestions.map((story, index) => (
                  <div
                    key={`ai-${index}`}
                    className="flex items-center gap-3 px-4 py-3 rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300"
                  >
                    <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0" />
                    <span className="flex-1 text-sm">{story.title}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAcceptAi(story, index)}
                        disabled={accepting !== null}
                      >
                        <Check className="h-4 w-4 mr-2 text-green-600" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRejectAi(index)}
                        disabled={accepting !== null}
                      >
                        <X className="h-4 w-4 mr-2 text-red-600" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

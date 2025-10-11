"use client";

import { useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
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
import type { FeatureDetail } from "@/types/roadmap";

interface UserStoriesSectionProps {
  userStories: FeatureDetail["userStories"];
  newStoryTitle: string;
  creatingStory: boolean;
  onNewStoryTitleChange: (title: string) => void;
  onAddUserStory: () => void;
  onDeleteUserStory: (storyId: string) => void;
  onReorderUserStories: (stories: FeatureDetail["userStories"]) => void;
}

export function UserStoriesSection({
  userStories,
  newStoryTitle,
  creatingStory,
  onNewStoryTitleChange,
  onAddUserStory,
  onDeleteUserStory,
  onReorderUserStories,
}: UserStoriesSectionProps) {
  const storyInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Memoize story IDs for sortable context
  const storyIds = useMemo(
    () => userStories.map((story) => story.id),
    [userStories]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = userStories.findIndex((s) => s.id === active.id);
    const newIndex = userStories.findIndex((s) => s.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedStories = arrayMove(userStories, oldIndex, newIndex).map(
        (story, index) => ({
          ...story,
          order: index,
        })
      );

      onReorderUserStories(reorderedStories);
    }
  };

  return (
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
            onChange={(e) => onNewStoryTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingStory) {
                onAddUserStory();
              }
            }}
            disabled={creatingStory}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={onAddUserStory}
            disabled={creatingStory || !newStoryTitle.trim()}
          >
            {creatingStory ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Add"
            )}
          </Button>
        </div>

        {userStories.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={storyIds} strategy={verticalListSortingStrategy}>
              <div className="px-4 pb-4 flex flex-col gap-2">
                {userStories
                  .sort((a, b) => a.order - b.order)
                  .map((story) => (
                    <SortableUserStory
                      key={story.id}
                      story={story}
                      onDelete={onDeleteUserStory}
                    />
                  ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

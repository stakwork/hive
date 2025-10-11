"use client";

import { useMemo } from "react";
import {
  DndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@/hooks/useSortable";
import { Label } from "@/components/ui/label";
import { InlineCreateForm } from "@/components/shared/InlineCreateForm";
import { SortableUserStory } from "./SortableUserStory";
import type { FeatureDetail } from "@/types/roadmap";

interface UserStoriesSectionProps {
  userStories: FeatureDetail["userStories"];
  onAddUserStory: (title: string) => Promise<void>;
  onDeleteUserStory: (storyId: string) => void;
  onReorderUserStories: (stories: FeatureDetail["userStories"]) => void;
}

export function UserStoriesSection({
  userStories,
  onAddUserStory,
  onDeleteUserStory,
  onReorderUserStories,
}: UserStoriesSectionProps) {
  const { sensors, collisionDetection } = useSortable();

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
        <div className="p-4">
          <InlineCreateForm
            placeholder="As a user, I want to..."
            buttonText="Add"
            onSubmit={onAddUserStory}
            keepOpenAfterSubmit={true}
          />
        </div>

        {userStories.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
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

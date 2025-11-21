"use client";

import { useState, useEffect } from "react";
import { GripVertical, Trash2, Check } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Item, ItemContent, ItemActions } from "@/components/ui/item";
import type { FeatureDetail } from "@/types/roadmap";

interface SortableUserStoryProps {
  story: FeatureDetail["userStories"][number];
  onDelete: (id: string) => void;
  onUpdate: (storyId: string, title: string) => Promise<void>;
  saving: boolean;
  saved: boolean;
}

export function SortableUserStory({ story, onDelete, onUpdate, saving, saved }: SortableUserStoryProps) {
  const [title, setTitle] = useState(story.title);
  const [isFocused, setIsFocused] = useState(false);

  // Sync local state when story prop changes (e.g., after save)
  useEffect(() => {
    setTitle(story.title);
  }, [story.title]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = async () => {
    setIsFocused(false);
    if (title !== story.title && title.trim()) {
      await onUpdate(story.id, title.trim());
    }
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-50 z-50" : ""}>
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
          <div className="flex items-center gap-2 flex-1">
            <Textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              className={`border-none bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0 py-0 px-0 text-sm resize-none ${
                isFocused ? "max-h-40 overflow-y-auto" : "line-clamp-2 overflow-hidden"
              }`}
              placeholder="Enter user story..."
            />
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <Check className="h-3 w-3 text-green-600" />
                <span className="text-green-600">Saved</span>
              </span>
            )}
          </div>
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

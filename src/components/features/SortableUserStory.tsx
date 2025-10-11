"use client";

import { GripVertical, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import type { FeatureDetail } from "@/types/roadmap";

interface SortableUserStoryProps {
  story: FeatureDetail["userStories"][number];
  onDelete: (id: string) => void;
}

export function SortableUserStory({
  story,
  onDelete,
}: SortableUserStoryProps) {
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

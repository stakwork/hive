"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, GripVertical, User as UserIcon, Bot } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import { useReorderRoadmapTasks } from "@/hooks/useReorderRoadmapTasks";
import type { TicketListItem } from "@/types/roadmap";

interface RoadmapTaskListProps {
  phaseId: string;
  featureId: string;
  workspaceSlug: string;
  tasks: TicketListItem[];
  onTaskAdded: (task: TicketListItem) => void;
  onTasksReordered?: (tasks: TicketListItem[]) => void;
}

function SortableRoadmapTaskItem({
  task,
  workspaceSlug,
  onClick,
}: {
  task: TicketListItem;
  workspaceSlug: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group ${
        isDragging ? "opacity-50 z-50" : ""
      }`}
    >
      {/* Drag Handle - visible on hover */}
      <div
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Clickable task content */}
      <div onClick={onClick} className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
        {/* Title */}
        <span className="text-sm flex-1 truncate group-hover:text-primary">{task.title}</span>

        {/* Status badge */}
        <StatusBadge statusType="task" status={task.status} className="shrink-0" />

        {/* Assignee avatar - always shown */}
        <Avatar className="h-5 w-5 shrink-0">
          {task.assignee ? (
            <>
              <AvatarImage src={task.assignee.image || undefined} />
              <AvatarFallback className="text-[10px]">
                {task.assignee.icon === "bot" ? (
                  <Bot className="h-3 w-3" />
                ) : (
                  task.assignee.name?.[0]?.toUpperCase() || <UserIcon className="h-3 w-3" />
                )}
              </AvatarFallback>
            </>
          ) : (
            <AvatarFallback className="text-xs">
              <UserIcon className="h-3 w-3" />
            </AvatarFallback>
          )}
        </Avatar>
      </div>
    </div>
  );
}

export function RoadmapTaskList({
  phaseId,
  featureId,
  workspaceSlug,
  tasks,
  onTaskAdded,
  onTasksReordered,
}: RoadmapTaskListProps) {
  const router = useRouter();
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const { createTicket, loading: creatingTask } = useRoadmapTaskMutations();
  const { sensors, taskIds, handleDragEnd, collisionDetection } = useReorderRoadmapTasks({
    tasks,
    phaseId,
    onOptimisticUpdate: onTasksReordered,
  });

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    const task = await createTicket({
      featureId,
      phaseId,
      title: newTaskTitle,
    });

    if (task) {
      onTaskAdded(task);
      setNewTaskTitle("");
    }
  };

  const handleTaskClick = (taskId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${taskId}`);
  };

  return (
    <div className="space-y-2">
      {/* Add task input */}
      <div className="flex gap-2">
        <Input
          placeholder="Add a task..."
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creatingTask) {
              handleAddTask();
            }
          }}
          disabled={creatingTask}
          className="flex-1 h-8 text-sm"
        />
        <Button size="sm" onClick={handleAddTask} disabled={creatingTask || !newTaskTitle.trim()} className="h-8">
          {creatingTask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        </Button>
      </div>

      {/* Tasks list with drag and drop */}
      {tasks.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {tasks
                .sort((a, b) => a.order - b.order)
                .map((task) => (
                  <SortableRoadmapTaskItem
                    key={task.id}
                    task={task}
                    workspaceSlug={workspaceSlug}
                    onClick={() => handleTaskClick(task.id)}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="text-center py-4 text-xs text-muted-foreground">No tasks yet</div>
      )}
    </div>
  );
}

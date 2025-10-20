"use client";

import { useRouter } from "next/navigation";
import { GripVertical, Trash2 } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatusPopover } from "@/components/ui/status-popover";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { DependenciesCombobox } from "@/components/features/DependenciesCombobox";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import { useReorderRoadmapTasks } from "@/hooks/useReorderRoadmapTasks";
import type { TicketListItem } from "@/types/roadmap";
import type { TaskStatus, Priority } from "@prisma/client";

interface RoadmapTasksTableProps {
  phaseId: string;
  workspaceSlug: string;
  tasks: TicketListItem[];
  onTasksReordered?: (tasks: TicketListItem[]) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<TicketListItem>) => void;
}

function SortableTableRow({
  task,
  workspaceSlug,
  phaseId,
  allTasks,
  onClick,
  onStatusUpdate,
  onPriorityUpdate,
  onAssigneeUpdate,
  onDependenciesUpdate,
  onDelete,
}: {
  task: TicketListItem;
  workspaceSlug: string;
  phaseId: string;
  allTasks: TicketListItem[];
  onClick: () => void;
  onStatusUpdate: (status: TaskStatus) => Promise<void>;
  onPriorityUpdate: (priority: Priority) => Promise<void>;
  onAssigneeUpdate: (assigneeId: string | null) => Promise<void>;
  onDependenciesUpdate: (dependencyIds: string[]) => Promise<void>;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`cursor-pointer hover:bg-muted/50 group ${
        isDragging ? "opacity-50 z-50" : ""
      }`}
    >
      <TableCell className="w-[40px]">
        <div
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="w-[300px] font-medium truncate" onClick={onClick}>
        {task.title}
      </TableCell>
      <TableCell className="w-[120px]">
        <StatusPopover
          statusType="task"
          currentStatus={task.status}
          onUpdate={onStatusUpdate}
        />
      </TableCell>
      <TableCell className="w-[120px]">
        <PriorityPopover
          currentPriority={task.priority}
          onUpdate={onPriorityUpdate}
        />
      </TableCell>
      <TableCell className="w-[180px]">
        <AssigneeCombobox
          workspaceSlug={workspaceSlug}
          currentAssignee={task.assignee}
          onSelect={onAssigneeUpdate}
          showSpecialAssignees={true}
        />
      </TableCell>
      <TableCell className="w-[200px]">
        <DependenciesCombobox
          currentTicketId={task.id}
          phaseId={phaseId}
          allTickets={allTasks}
          selectedDependencyIds={task.dependsOnTaskIds}
          onUpdate={onDependenciesUpdate}
        />
      </TableCell>
      <TableCell className="w-[50px]">
        <ActionMenu
          actions={[
            {
              label: "Delete",
              icon: Trash2,
              variant: "destructive",
              confirmation: {
                title: "Delete Task",
                description: `Are you sure you want to delete "${task.title}"? This action cannot be undone.`,
                onConfirm: onDelete,
              },
            },
          ]}
        />
      </TableCell>
    </TableRow>
  );
}

export function RoadmapTasksTable({ phaseId, workspaceSlug, tasks, onTasksReordered, onTaskUpdate }: RoadmapTasksTableProps) {
  const router = useRouter();

  const { updateTicket } = useRoadmapTaskMutations();
  const { sensors, taskIds, handleDragEnd, collisionDetection } = useReorderRoadmapTasks({
    tasks,
    phaseId,
    onOptimisticUpdate: onTasksReordered,
  });

  const handleRowClick = (taskId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${taskId}`);
  };

  const handleUpdateTask = async (taskId: string, updates: { status?: TaskStatus; priority?: Priority; assigneeId?: string | null; dependsOnTaskIds?: string[] }) => {
    const updatedTask = await updateTicket({ taskId, updates });
    if (updatedTask && onTaskUpdate) {
      onTaskUpdate(taskId, updatedTask);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tickets/${taskId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete task");
      }

      // Remove from local state
      if (onTasksReordered) {
        onTasksReordered(tasks.filter((t) => t.id !== taskId));
      }
    } catch (error) {
      console.error("Failed to delete task:", error);
    }
  };

  if (tasks.length === 0) {
    return (
      <Empty className="h-[500px]">
        <EmptyHeader>
          <EmptyDescription>No tasks in this phase yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={handleDragEnd}
      >
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[300px]">Title</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px]">Priority</TableHead>
              <TableHead className="w-[180px]">Assignee</TableHead>
              <TableHead className="w-[200px]">Dependencies</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks
                .sort((a, b) => a.order - b.order)
                .map((task) => (
                  <SortableTableRow
                    key={task.id}
                    task={task}
                    workspaceSlug={workspaceSlug}
                    phaseId={phaseId}
                    allTasks={tasks}
                    onClick={() => handleRowClick(task.id)}
                    onStatusUpdate={async (status) => handleUpdateTask(task.id, { status })}
                    onPriorityUpdate={async (priority) => handleUpdateTask(task.id, { priority })}
                    onAssigneeUpdate={async (assigneeId) => handleUpdateTask(task.id, { assigneeId })}
                    onDependenciesUpdate={async (dependsOnTaskIds) => handleUpdateTask(task.id, { dependsOnTaskIds })}
                    onDelete={() => handleDeleteTask(task.id)}
                  />
                ))}
            </SortableContext>
          </TableBody>
        </Table>
      </DndContext>
    </div>
  );
}

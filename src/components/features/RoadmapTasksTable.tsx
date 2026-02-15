"use client";

import React, { useState } from "react";
import { AssigneeCombobox } from "@/components/features/AssigneeCombobox";
import { DependenciesCombobox } from "@/components/features/DependenciesCombobox";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { PriorityPopover } from "@/components/ui/priority-popover";
import { StatusPopover } from "@/components/ui/status-popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DeploymentStatusBadge } from "@/components/tasks/DeploymentStatusBadge";
import { useReorderRoadmapTasks } from "@/hooks/useReorderRoadmapTasks";
import { useRoadmapTaskMutations } from "@/hooks/useRoadmapTaskMutations";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { TicketListItem } from "@/types/roadmap";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Priority, TaskStatus } from "@prisma/client";
import { ExternalLink, GripVertical, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface WorkspaceRepo {
  id: string;
  name: string;
  repositoryUrl: string;
}

interface RoadmapTasksTableProps {
  phaseId: string;
  workspaceSlug: string;
  tasks: TicketListItem[];
  onTasksReordered?: (tasks: TicketListItem[]) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<TicketListItem>) => void;
}

// Maximum number of dependencies to show inline before using "+N more"
const maxVisibleDependencies = 2;

function SortableTableRow({
  task,
  workspaceSlug,
  phaseId,
  allTasks,
  workspaceRepos,
  onClick,
  onStatusUpdate,
  onPriorityUpdate,
  onAssigneeUpdate,
  onDependenciesUpdate,
  onAutoMergeUpdate,
  onRepoUpdate,
  onDelete,
  onStartTask,
}: {
  task: TicketListItem;
  workspaceSlug: string;
  phaseId: string;
  allTasks: TicketListItem[];
  workspaceRepos: WorkspaceRepo[];
  onClick: () => void;
  onStatusUpdate: (status: TaskStatus) => Promise<void>;
  onPriorityUpdate: (priority: Priority) => Promise<void>;
  onAssigneeUpdate: (assigneeId: string | null) => Promise<void>;
  onDependenciesUpdate: (dependencyIds: string[]) => Promise<void>;
  onAutoMergeUpdate: (autoMerge: boolean) => Promise<void>;
  onRepoUpdate: (repositoryId: string | null) => Promise<void>;
  onDelete: () => void;
  onStartTask: () => void;
}) {
  const router = useRouter();
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

  // Build action menu items
  const actionMenuItems: ActionMenuItem[] = [
    ...(task.status === "TODO"
      ? [
          {
            label: "Start Task",
            icon: Play,
            variant: "default" as const,
            onClick: onStartTask,
          },
        ]
      : []),
    ...(task.status !== "TODO"
      ? [
          {
            label: "View Task",
            icon: ExternalLink,
            variant: "default" as const,
            onClick: () => router.push(`/w/${workspaceSlug}/task/${task.id}`),
          },
        ]
      : []),
    ...(task.assignee?.id === "system:bounty-hunter" && task.bountyCode
      ? [
          {
            label: "View Bounty",
            icon: ExternalLink,
            variant: "default" as const,
            onClick: () => {
              const sphinxUrl = process.env.NEXT_PUBLIC_SPHINX_TRIBES_URL || "https://bounties.sphinx.chat";
              window.open(`${sphinxUrl}/bounty/${task.bountyCode}`, "_blank");
            },
          },
        ]
      : [
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive" as const,
            confirmation: {
              title: "Delete Task",
              description: `Are you sure you want to delete "${task.title}"? This action cannot be undone.`,
              onConfirm: onDelete,
            },
          },
        ]),
  ];

  const showRepoColumn = workspaceRepos.length > 1;

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`cursor-pointer hover:bg-muted/50 group ${isDragging ? "opacity-50 z-50" : ""
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
      <TableCell className="w-[300px] font-medium" onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="truncate">{task.title}</span>
          {task.deploymentStatus && (
            <DeploymentStatusBadge
              environment={task.deploymentStatus as "staging" | "production"}
              deployedAt={
                task.deploymentStatus === "production"
                  ? task.deployedToProductionAt
                    ? new Date(task.deployedToProductionAt)
                    : undefined
                  : task.deployedToStagingAt
                  ? new Date(task.deployedToStagingAt)
                  : undefined
              }
            />
          )}
        </div>
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
          ticketData={{
            id: task.id,
            title: task.title,
            description: task.description,
            bountyCode: task.bountyCode,
          }}
        />
      </TableCell>
      {showRepoColumn && (
        <TableCell className="w-[150px]">
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={task.repository?.id || workspaceRepos[0]?.id || ""}
              onValueChange={(value) => onRepoUpdate(value)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select repo" />
              </SelectTrigger>
              <SelectContent>
                {workspaceRepos.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </TableCell>
      )}
      <TableCell className="w-[200px]">
        <DependenciesCombobox
          currentTicketId={task.id}
          phaseId={phaseId}
          allTickets={allTasks}
          selectedDependencyIds={task.dependsOnTaskIds}
          onUpdate={onDependenciesUpdate}
          maxVisibleDependencies={maxVisibleDependencies}
        />
      </TableCell>
      <TableCell className="w-[100px]">
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center"
        >
          <Switch
            checked={task.autoMerge ?? false}
            onCheckedChange={onAutoMergeUpdate}
          />
        </div>
      </TableCell>
      <TableCell className="w-[50px]">
        <ActionMenu actions={actionMenuItems} />
      </TableCell>
    </TableRow>
  );
}

export function RoadmapTasksTable({ phaseId, workspaceSlug, tasks, onTasksReordered, onTaskUpdate }: RoadmapTasksTableProps) {
  const router = useRouter();
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const { workspace } = useWorkspace();

  const workspaceRepos: WorkspaceRepo[] = (workspace?.repositories || []).map((r) => ({
    id: r.id,
    name: r.name,
    repositoryUrl: r.repositoryUrl,
  }));
  const showRepoColumn = workspaceRepos.length > 1;

  const { updateTicket } = useRoadmapTaskMutations();
  const { sensors, taskIds, handleDragEnd, collisionDetection } = useReorderRoadmapTasks({
    tasks,
    phaseId,
    onOptimisticUpdate: onTasksReordered,
  });

  const handleRowClick = (taskId: string) => {
    router.push(`/w/${workspaceSlug}/tickets/${taskId}`);
  };

  const handleStartTask = async (task: TicketListItem) => {
    if (startingTaskId) return; // Prevent multiple simultaneous starts

    setStartingTaskId(task.id);

    try {
      // Start workflow for this task
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startWorkflow: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to start task");
      }

      // Navigate to task page with return path
      // Extract current URL path to use as return path
      const currentPath = window.location.pathname + window.location.search;
      console.log('currentPath', currentPath);
      router.push(`/w/${workspaceSlug}/task/${task.id}?from=${encodeURIComponent(currentPath)}`);
    } catch (error) {
      console.error("Failed to start task:", error);
      setStartingTaskId(null);
    }
  };

  const handleUpdateTask = async (taskId: string, updates: { status?: TaskStatus; priority?: Priority; assigneeId?: string | null; repositoryId?: string | null; dependsOnTaskIds?: string[]; autoMerge?: boolean }) => {
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
              {showRepoColumn && <TableHead className="w-[150px]">Repository</TableHead>}
              <TableHead className="w-[200px]">Dependencies</TableHead>
              <TableHead className="w-[100px]">Auto-Merge</TableHead>
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
                    workspaceRepos={workspaceRepos}
                    onClick={() => handleRowClick(task.id)}
                    onStatusUpdate={async (status) => handleUpdateTask(task.id, { status })}
                    onPriorityUpdate={async (priority) => handleUpdateTask(task.id, { priority })}
                    onAssigneeUpdate={async (assigneeId) => handleUpdateTask(task.id, { assigneeId })}
                    onDependenciesUpdate={async (dependsOnTaskIds) => handleUpdateTask(task.id, { dependsOnTaskIds })}
                    onAutoMergeUpdate={async (autoMerge) => handleUpdateTask(task.id, { autoMerge })}
                    onRepoUpdate={async (repositoryId) => handleUpdateTask(task.id, { repositoryId })}
                    onDelete={() => handleDeleteTask(task.id)}
                    onStartTask={() => handleStartTask(task)}
                  />
                ))}
            </SortableContext>
          </TableBody>
        </Table>
      </DndContext>
    </div>
  );
}

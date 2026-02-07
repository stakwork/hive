import type { Prisma, FeatureStatus, FeaturePriority, TaskStatus, Priority } from "@prisma/client";
import type {
  ApiSuccessResponse,
  PaginatedApiResponse,
} from "./common";
import React from "react";
import { Inbox, Calendar, Loader2, CheckCircle, XCircle, PlayCircle } from "lucide-react";
import type { KanbanColumn } from "@/components/ui/kanban-view";

// Re-export Prisma enums for convenience
export type { FeatureStatus, FeaturePriority, TaskStatus, Priority };

// Backwards compatibility alias
export type { TaskStatus as TicketStatus };

// Feature status labels
export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  BACKLOG: "Backlog",
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  BLOCKED: "Blocked",
  ERROR: "Error",
};

// Feature status colors for badges
export const FEATURE_STATUS_COLORS: Record<FeatureStatus, string> = {
  BACKLOG: "bg-gray-100 text-gray-700 border-gray-200",
  PLANNED: "bg-purple-50 text-purple-700 border-purple-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  BLOCKED: "bg-orange-50 text-orange-700 border-orange-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
};

// Kanban columns configuration for feature board
export const FEATURE_KANBAN_COLUMNS: KanbanColumn<FeatureStatus>[] = [
  {
    status: "BACKLOG",
    title: "Backlog",
    icon: <Inbox className="h-4 w-4" />,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50/30 dark:bg-gray-950/10",
  },
  {
    status: "PLANNED",
    title: "Planned",
    icon: <Calendar className="h-4 w-4" />,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50/30 dark:bg-purple-950/10",
  },
  {
    status: "IN_PROGRESS",
    title: "In Progress",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50/30 dark:bg-blue-950/10",
  },
  {
    status: "COMPLETED",
    title: "Completed",
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50/30 dark:bg-green-950/10",
  },
  {
    status: "CANCELLED",
    title: "Cancelled",
    icon: <XCircle className="h-4 w-4" />,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50/30 dark:bg-red-950/10",
  },
];

// Kanban columns configuration for task board
export const TASK_KANBAN_COLUMNS: KanbanColumn<TaskStatus>[] = [
  {
    status: "TODO",
    title: "To Do",
    icon: <Inbox className="h-4 w-4" />,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50/30 dark:bg-gray-950/10",
  },
  {
    status: "IN_PROGRESS",
    title: "In Progress",
    icon: <PlayCircle className="h-4 w-4" />,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50/30 dark:bg-amber-950/10",
  },
  {
    status: "DONE",
    title: "Done",
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50/30 dark:bg-green-950/10",
  },
];

// Task status labels (used for both standalone and roadmap tasks)
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
  BLOCKED: "Blocked",
};

// Task status colors for badges
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-gray-100 text-gray-700 border-gray-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  DONE: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  BLOCKED: "bg-orange-50 text-orange-700 border-orange-200",
};

// Backwards compatibility aliases
export const TICKET_STATUS_LABELS = TASK_STATUS_LABELS;
export const TICKET_STATUS_COLORS = TASK_STATUS_COLORS;

// Priority labels
export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

// Feature with relations (matches GET /api/features list query)
// Note: stakworkRuns count is added manually since Prisma types don't support conditional counts
export type FeatureWithDetails = Prisma.FeatureGetPayload<{
  select: {
    id: true;
    title: true;
    status: true;
    priority: true;
    createdAt: true;
    updatedAt: true;
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    _count: {
      select: {
        userStories: true;
        stakworkRuns: true;
      };
    };
  };
}>;

// Feature detail with full information (matches GET /api/features/[id] query)
export type FeatureDetail = Prisma.FeatureGetPayload<{
  select: {
    id: true;
    title: true;
    brief: true;
    requirements: true;
    architecture: true;
    personas: true;
    diagramUrl: true;
    diagramS3Key: true;
    status: true;
    priority: true;
    createdAt: true;
    updatedAt: true;
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    userStories: {
      select: {
        id: true;
        title: true;
        order: true;
        completed: true;
        createdAt: true;
        updatedAt: true;
      };
    };
    phases: {
      select: {
        id: true;
        name: true;
        description: true;
        status: true;
        order: true;
        featureId: true;
        createdAt: true;
        updatedAt: true;
        tasks: {
          select: {
            id: true;
            title: true;
            description: true;
            status: true;
            priority: true;
            order: true;
            featureId: true;
            phaseId: true;
            bountyCode: true;
            dependsOnTaskIds: true;
            createdAt: true;
            updatedAt: true;
            assignee: {
              select: {
                id: true;
                name: true;
                email: true;
                image: true;
              };
            };
            phase: {
              select: {
                id: true;
                name: true;
              };
            };
          };
        };
      };
    };
  };
}>;

// Feature with workspace (matches POST /api/features response)
export type FeatureWithWorkspace = Prisma.FeatureGetPayload<{
  include: {
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    workspace: {
      select: {
        id: true;
        name: true;
        slug: true;
      };
    };
    _count: {
      select: {
        userStories: true;
      };
    };
  };
}>;

// UserStory for list (matches GET user-stories query - no feature relation)
export type UserStoryListItem = Prisma.UserStoryGetPayload<{
  select: {
    id: true;
    title: true;
    order: true;
    completed: true;
    createdAt: true;
    updatedAt: true;
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    updatedBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
  };
}>;

// UserStory with feature relation (matches POST user-stories response)
export type UserStoryWithDetails = Prisma.UserStoryGetPayload<{
  include: {
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    updatedBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    feature: {
      select: {
        id: true;
        title: true;
        workspaceId: true;
      };
    };
  };
}>;

// Request types
export interface CreateFeatureRequest {
  title: string;
  brief?: string;
  requirements?: string;
  architecture?: string;
  personas?: string[];
  workspaceId: string;
  status?: FeatureStatus;
  priority?: FeaturePriority;
  assigneeId?: string;
}

export interface UpdateFeatureRequest {
  title?: string;
  brief?: string | null;
  requirements?: string | null;
  architecture?: string | null;
  personas?: string[];
  status?: FeatureStatus;
  priority?: FeaturePriority;
  assigneeId?: string | null;
}

export interface CreateUserStoryRequest {
  title: string;
}

export interface UpdateUserStoryRequest {
  title?: string;
  order?: number;
  completed?: boolean;
}

export interface ReorderUserStoriesRequest {
  userStoryIds: string[];
}

// Phase types
export type PhaseListItem = Prisma.PhaseGetPayload<{
  select: {
    id: true;
    name: true;
    description: true;
    status: true;
    order: true;
    featureId: true;
    createdAt: true;
    updatedAt: true;
    _count: {
      select: {
        tasks: true;
      };
    };
  };
}>;

export type PhaseWithDetails = Prisma.PhaseGetPayload<{
  include: {
    feature: {
      select: {
        id: true;
        title: true;
        workspaceId: true;
      };
    };
  };
}>;

// Phase with tasks for detail page
export type PhaseWithTasks = Prisma.PhaseGetPayload<{
  select: {
    id: true;
    name: true;
    description: true;
    status: true;
    order: true;
    featureId: true;
    createdAt: true;
    updatedAt: true;
    feature: {
      select: {
        id: true;
        title: true;
        workspaceId: true;
      };
    };
    tasks: {
      select: {
        id: true;
        title: true;
        description: true;
        status: true;
        priority: true;
        order: true;
        featureId: true;
        phaseId: true;
        bountyCode: true;
        dependsOnTaskIds: true;
        createdAt: true;
        updatedAt: true;
        assignee: {
          select: {
            id: true;
            name: true;
            email: true;
            image: true;
          };
        };
        phase: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
  };
}>;

// Backwards compatibility alias
export type PhaseWithTickets = PhaseWithTasks;

export interface CreatePhaseRequest {
  name: string;
  description?: string;
}

export interface UpdatePhaseRequest {
  name?: string;
  description?: string;
  status?: import("@prisma/client").PhaseStatus;
  order?: number;
}

export interface ReorderPhasesRequest {
  phases: { id: string; order: number }[];
}

// Helper type for assignee with optional icon field (for system assignees)
type AssigneeWithIcon = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  icon?: string | null;
};

// Roadmap Task types (tasks that are part of features/phases)
type RoadmapTaskListItemBase = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    status: true;
    priority: true;
    order: true;
    featureId: true;
    phaseId: true;
    bountyCode: true;
    dependsOnTaskIds: true;
    createdAt: true;
    updatedAt: true;
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    phase: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

export type RoadmapTaskListItem = Omit<RoadmapTaskListItemBase, 'assignee'> & {
  assignee: AssigneeWithIcon | null;
};

export type RoadmapTaskWithDetails = RoadmapTaskListItem;

// Roadmap task detail with full context for detail page
type RoadmapTaskDetailBase = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    status: true;
    priority: true;
    order: true;
    featureId: true;
    phaseId: true;
    bountyCode: true;
    dependsOnTaskIds: true;
    createdAt: true;
    updatedAt: true;
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    phase: {
      select: {
        id: true;
        name: true;
        status: true;
      };
    };
    feature: {
      select: {
        id: true;
        title: true;
        workspaceId: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
    updatedBy: {
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
      };
    };
  };
}>;

export type RoadmapTaskDetail = Omit<RoadmapTaskDetailBase, 'assignee'> & {
  assignee: AssigneeWithIcon | null;
};

// Backwards compatibility aliases (Ticket -> RoadmapTask)
export type TicketListItem = RoadmapTaskListItem;
export type TicketWithDetails = RoadmapTaskWithDetails;
export type TicketDetail = RoadmapTaskDetail;

export interface CreateRoadmapTaskRequest {
  title: string;
  description?: string;
  phaseId?: string | null;
  assigneeId?: string | null;
  status?: import("@prisma/client").TaskStatus;
  priority?: import("@prisma/client").Priority;
  runBuild?: boolean;
  runTestSuite?: boolean;
  autoMerge?: boolean;
  dependsOnTaskIds?: string[];
}

export interface UpdateRoadmapTaskRequest {
  title?: string;
  description?: string;
  status?: import("@prisma/client").TaskStatus;
  workflowStatus?: import("@prisma/client").WorkflowStatus;
  priority?: import("@prisma/client").Priority;
  order?: number;
  phaseId?: string | null;
  assigneeId?: string | null;
  dependsOnTaskIds?: string[];
  runBuild?: boolean;
  runTestSuite?: boolean;
  autoMerge?: boolean;
}

export interface ReorderRoadmapTasksRequest {
  tasks: { id: string; order: number; phaseId?: string | null }[];
}

// Backwards compatibility aliases
export type CreateTicketRequest = CreateRoadmapTaskRequest;
export type UpdateTicketRequest = UpdateRoadmapTaskRequest;
export type ReorderTicketsRequest = ReorderRoadmapTasksRequest;

// Response type aliases using generic types
export type FeatureListResponse = PaginatedApiResponse<FeatureWithDetails>;
export type FeatureResponse = ApiSuccessResponse<FeatureWithWorkspace>;
export type UserStoryListResponse = ApiSuccessResponse<UserStoryListItem[]>;
export type UserStoryResponse = ApiSuccessResponse<UserStoryWithDetails>;
export type PhaseListResponse = ApiSuccessResponse<PhaseListItem[]>;
export type PhaseResponse = ApiSuccessResponse<PhaseListItem>;
export type RoadmapTaskListResponse = ApiSuccessResponse<RoadmapTaskListItem[]>;
export type RoadmapTaskResponse = ApiSuccessResponse<RoadmapTaskWithDetails>;

// Backwards compatibility aliases
export type TicketListResponse = RoadmapTaskListResponse;
export type TicketResponse = RoadmapTaskResponse;

// AI Generation types for phases and tasks
export interface GeneratedTask {
  title: string;
  description?: string;
  priority: Priority;
  tempId: string; // Temporary ID for dependency mapping (e.g., "T1", "T2")
  dependsOn?: string[]; // Array of tempIds this task depends on
}

export interface GeneratedPhase {
  name: string;
  description?: string;
  tasks: GeneratedTask[];
}

export interface GeneratedPhasesAndTasks {
  phases: GeneratedPhase[];
}

// Request type for batch creating phases and tasks
export interface BatchCreatePhasesRequest {
  phases: GeneratedPhase[];
}

// Response type for batch creation
export interface BatchCreatedPhase {
  phase: PhaseListItem;
  tasks: RoadmapTaskListItem[];
}

export interface BatchCreatePhasesResponse {
  success: boolean;
  data: BatchCreatedPhase[];
}

// Backwards compatibility aliases
export type GeneratedTicket = GeneratedTask;
export type GeneratedPhasesAndTickets = GeneratedPhasesAndTasks;

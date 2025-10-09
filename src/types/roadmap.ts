import type { Prisma, FeatureStatus, FeaturePriority } from "@prisma/client";
import type {
  ApiSuccessResponse,
  PaginatedApiResponse,
} from "./common";

// Re-export Prisma enums for convenience
export type { FeatureStatus, FeaturePriority };

// Feature with relations (matches GET /api/features list query)
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

// Response type aliases using generic types
export type FeatureListResponse = PaginatedApiResponse<FeatureWithDetails>;
export type FeatureResponse = ApiSuccessResponse<FeatureWithWorkspace>;
export type UserStoryListResponse = ApiSuccessResponse<UserStoryListItem[]>;
export type UserStoryResponse = ApiSuccessResponse<UserStoryWithDetails>;

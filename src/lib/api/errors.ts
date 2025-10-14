import { NextResponse } from "next/server";
import type { ApiError } from "@/types/errors";
import { isApiError } from "@/types/errors";

export const API_ERRORS = {
  UNAUTHORIZED: {
    message: "Unauthorized",
    status: 401 as const,
  },
  INVALID_SESSION: {
    message: "Invalid user session",
    status: 401 as const,
  },
  GITHUB_TOKEN_EXPIRED: {
    message: "GitHub token expired or invalid",
    status: 401 as const,
  },
  ACCESS_DENIED: {
    message: "Access denied",
    status: 403 as const,
  },
  ADMIN_REQUIRED: {
    message: "Admin access required",
    status: 403 as const,
  },
  WORKSPACE_ACCESS_DENIED: {
    message: "Workspace not found or access denied",
    status: 403 as const,
  },
  INSUFFICIENT_PERMISSIONS: {
    message: "Insufficient permissions",
    status: 403 as const,
  },

  MISSING_REQUIRED_FIELDS: {
    message: "Missing required fields",
    status: 400 as const,
  },
  INVALID_INPUT: {
    message: "Invalid input",
    status: 400 as const,
  },
  INVALID_ROLE: {
    message: "Invalid role",
    status: 400 as const,
  },
  GITHUB_TOKEN_NOT_FOUND: {
    message: "GitHub access token not found",
    status: 400 as const,
  },
  INVALID_REQUEST: {
    message: "Invalid request data",
    status: 400 as const,
  },

  WORKSPACE_NOT_FOUND: {
    message: "Workspace not found",
    status: 404 as const,
  },
  SWARM_NOT_FOUND: {
    message: "Swarm not found for this workspace",
    status: 404 as const,
  },
  SWARM_URL_NOT_CONFIGURED: {
    message: "Swarm URL not configured",
    status: 404 as const,
  },
  TASK_NOT_FOUND: {
    message: "Task not found",
    status: 404 as const,
  },
  REPOSITORY_NOT_FOUND: {
    message: "Repository not found",
    status: 404 as const,
  },
  MEMBER_NOT_FOUND: {
    message: "Member not found",
    status: 404 as const,
  },
  RESOURCE_NOT_FOUND: {
    message: "Resource not found",
    status: 404 as const,
  },

  RESOURCE_CONFLICT: {
    message: "Resource conflict",
    status: 409 as const,
  },

  INTERNAL_ERROR: {
    message: "Internal server error",
    status: 500 as const,
  },
  SERVICE_UNAVAILABLE: {
    message: "Service temporarily unavailable",
    status: 503 as const,
  },
  FAILED_TO_PROCESS: {
    message: "Failed to process request",
    status: 500 as const,
  },
} as const;


export function handleApiError(error: unknown): NextResponse {
  if (isApiError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        details: error.details,
      },
      { status: error.status }
    );
  }

  if (error instanceof Error) {
    console.error("Unhandled error:", error.message, error.stack);
    
    const message = error.message.toLowerCase();
    
    if (message.includes("not found") || message.includes("access denied")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    
    if (
      message.includes("unauthorized") ||
      message.includes("not authenticated") ||
      message.includes("authentication required")
    ) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    
    if (
      message.includes("forbidden") ||
      message.includes("permission") ||
      message.includes("not allowed") ||
      message.includes("insufficient") ||
      message.includes("only workspace owners") ||
      message.includes("owners and admins")
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    
    if (message.includes("already exists") || message.includes("duplicate")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    
    if (message.includes("invalid") || message.includes("validation")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (
      message.includes("limit exceeded") || 
      message.includes("limit reached") || 
      message.includes("cannot create") ||
      message.includes("can only create up to")
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  console.error("Unknown error:", error);
  return NextResponse.json(
    {
      error: "An unexpected error occurred",
    },
    { status: 500 }
  );
}

export function createError(
  message: string,
  status: ApiError["status"],
  details?: unknown
): ApiError {
  return { message, status, details };
}

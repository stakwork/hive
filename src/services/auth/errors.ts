import type { AuthError, AuthErrorCode } from "@/types/auth";

/**
 * Create a standardized auth error
 */
export function createAuthError(
  code: AuthErrorCode,
  message: string,
  statusCode?: number
): AuthError {
  const error = new Error(message) as AuthError;
  error.code = code;
  
  // Set status code based on error type
  switch (code) {
    case "UNAUTHENTICATED":
      error.statusCode = 401;
      break;
    case "INSUFFICIENT_PERMISSIONS":
      error.statusCode = 403;
      break;
    case "WORKSPACE_NOT_FOUND":
      error.statusCode = 404;
      break;
    case "INVALID_TOKEN":
    case "SESSION_EXPIRED":
      error.statusCode = 401;
      break;
    default:
      error.statusCode = statusCode || 401;
  }
  
  return error;
}

/**
 * Check if an error is an auth error
 */
export function isAuthError(error: unknown): error is AuthError {
  return (
    error instanceof Error &&
    "code" in error &&
    "statusCode" in error &&
    typeof (error as any).code === "string" &&
    typeof (error as any).statusCode === "number"
  );
}

/**
 * Common auth error messages
 */
export const AUTH_ERROR_MESSAGES = {
  UNAUTHENTICATED: "Authentication required",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions",
  WORKSPACE_NOT_FOUND: "Workspace not found or access denied",
  INVALID_TOKEN: "Invalid authentication token",
  SESSION_EXPIRED: "Session has expired",
} as const;
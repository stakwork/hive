import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import type { AuthStatus, MiddlewareContext, MiddlewareUser } from "@/types/middleware";
import { unauthorizedError } from "@/types/errors";
import { NextResponse } from "next/server";

/**
 * Extracts middleware context from request headers
 * Use this in API routes to access authentication data set by middleware
 */
export function getMiddlewareContext(request: NextRequest): MiddlewareContext {
  const headers = request.headers;

  const requestId = headers.get(MIDDLEWARE_HEADERS.REQUEST_ID) ?? "";
  const authStatusHeader = headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS);

  // Validate auth status with type safety
  const authStatus: AuthStatus =
    authStatusHeader === "authenticated" || authStatusHeader === "public" || authStatusHeader === "webhook"
      ? authStatusHeader
      : "error";

  const userId = headers.get(MIDDLEWARE_HEADERS.USER_ID);
  const userEmail = headers.get(MIDDLEWARE_HEADERS.USER_EMAIL);
  const userName = headers.get(MIDDLEWARE_HEADERS.USER_NAME);

  const context: MiddlewareContext = {
    requestId,
    authStatus,
  };

  // Only add user if we have valid user data and authenticated status
  if (authStatus === "authenticated" && userId && userEmail && userName) {
    context.user = {
      id: userId,
      email: userEmail,
      name: userName,
    };
  }

  return context;
}

/**
 * Type guard for authenticated requests
 * Use this to narrow the type of context to include user
 */
export function requireAuth(context: MiddlewareContext): MiddlewareUser | NextResponse {
  if (context.authStatus === "authenticated" && context.user) {
    return context.user;
  }
  const error = unauthorizedError("Unauthorized");
  return NextResponse.json(
    { error: error.message, kind: error.kind, details: error.details },
    { status: error.statusCode },
  );
}

/**
 * Converts a route pattern with wildcards (*) to a regular expression
 * Used for matching dynamic route segments in middleware policies
 *
 * @param pattern - Route pattern with * as wildcards (e.g., "/api/tasks/*\/title")
 * @returns RegExp that matches the pattern (e.g., /^\/api\/tasks\/[^/]+\/title$/)
 *
 * @example
 * const regex = patternToRegex("/api/tasks/*\/title");
 * regex.test("/api/tasks/123/title"); // true
 * regex.test("/api/tasks/abc-def/title"); // true
 * regex.test("/api/tasks/123/status"); // false
 */
export function patternToRegex(pattern: string): RegExp {
  // Escape special regex characters except *
  const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
  return new RegExp(`^${regexPattern}$`);
}

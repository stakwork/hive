import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import type { AuthStatus, MiddlewareContext, MiddlewareUser } from "@/types/middleware";

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
    authStatusHeader === "authenticated" ||
    authStatusHeader === "public" ||
    authStatusHeader === "webhook"
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
 * Requires authentication in route handlers
 * Throws error if not authenticated - caller should wrap in try-catch
 *
 * @throws {Error} If user is not authenticated
 */
export function requireAuth(context: MiddlewareContext): MiddlewareUser {
  if (context.authStatus !== "authenticated" || !context.user) {
    throw new Error("Authentication required");
  }
  return context.user;
}

/**
 * Checks authentication and returns 401 response if not authenticated
 * Returns user if authenticated, or Response if not
 *
 * Use this for cleaner route handler code with early returns:
 * @example
 * const userOrResponse = requireAuthOrUnauthorized(context);
 * if (userOrResponse instanceof Response) return userOrResponse;
 * const userId = userOrResponse.id;
 */
export function requireAuthOrUnauthorized(
  context: MiddlewareContext
): MiddlewareUser | Response {
  if (context.authStatus !== "authenticated" || !context.user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  return context.user;
}

/**
 * Type guard for authenticated requests
 * Use this to narrow the type of context to include user
 */
export function isAuthenticated(context: MiddlewareContext): context is MiddlewareContext & { user: MiddlewareUser } {
  return context.authStatus === "authenticated" && !!context.user;
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
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]+');
  return new RegExp(`^${regexPattern}$`);
}

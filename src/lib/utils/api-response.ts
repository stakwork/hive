import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { isApiError, serverError, ApiError } from "@/types/errors";
import type { MiddlewareContext, MiddlewareUser } from "@/types/middleware";
import { logger } from "@/lib/logger";

/**
 * Type for route handlers that receive authenticated context and user
 */
export type AuthenticatedRouteHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context: MiddlewareContext,
  user: MiddlewareUser,
  params?: TParams
) => Promise<Response>;

/**
 * Type for the wrapped route handler signature expected by Next.js
 */
export type NextRouteHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  routeContext: { params: Promise<TParams> }
) => Promise<Response>;

/**
 * Higher-order function that wraps route handlers with authentication boilerplate.
 * 
 * Extracts middleware context, validates authentication, and passes authenticated
 * user to the handler. Returns 401 if authentication fails.
 * 
 * @example
 * ```typescript
 * export const GET = withAuth(async (request, context, user) => {
 *   // user.id is guaranteed to exist
 *   const data = await fetchUserData(user.id);
 *   return createApiResponse(data);
 * });
 * ```
 * 
 * @param handler - Authenticated route handler that receives context and user
 * @returns Next.js route handler with authentication wrapper
 */
export function withAuth<TParams = Record<string, string>>(
  handler: AuthenticatedRouteHandler<TParams>
): NextRouteHandler<TParams> {
  return async (
    request: NextRequest,
    routeContext: { params: Promise<TParams> }
  ): Promise<Response> => {
    // Extract middleware context from headers
    const context = getMiddlewareContext(request);

    // Validate authentication and get user
    const userOrResponse = requireAuth(context);

    // If authentication failed, return 401 response
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }

    const user = userOrResponse;

    // Await params (Next.js 15 always passes Promise)
    const params = await routeContext.params;

    // Call the handler with authenticated context
    return handler(request, context, user, params);
  };
}

/**
 * Centralized error handler that maps errors to consistent HTTP responses.
 * 
 * Handles ApiError types from src/types/errors.ts and generic errors.
 * Logs all errors with request ID for tracing. Sanitizes sensitive data
 * automatically via the logger.
 * 
 * @example
 * ```typescript
 * try {
 *   await updateResource(id);
 *   return createApiResponse({ success: true });
 * } catch (error) {
 *   return handleApiError(error, context.requestId);
 * }
 * ```
 * 
 * @param error - Error object (ApiError or generic Error)
 * @param requestId - Optional request ID from middleware context for tracing
 * @returns NextResponse with consistent error format
 */
export function handleApiError(
  error: unknown,
  requestId?: string
): NextResponse {
  // Handle known ApiError types
  if (isApiError(error)) {
    logger.error(
      "API error occurred",
      requestId,
      {
        kind: error.kind,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      }
    );

    return NextResponse.json(
      {
        error: error.message,
        kind: error.kind,
        details: error.details,
        statusCode: error.statusCode,
      },
      { status: error.statusCode }
    );
  }

  // Handle generic errors
  if (error instanceof Error) {
    logger.error(
      "Unexpected error occurred",
      requestId,
      {
        message: error.message,
        stack: error.stack,
      }
    );

    const serverErr = serverError(error.message);
    return NextResponse.json(
      {
        error: serverErr.message,
        kind: serverErr.kind,
        statusCode: serverErr.statusCode,
      },
      { status: serverErr.statusCode }
    );
  }

  // Handle unknown error types
  logger.error(
    "Unknown error type",
    requestId,
    {
      error: String(error),
    }
  );

  const unknownErr = serverError("An unexpected error occurred");
  return NextResponse.json(
    {
      error: unknownErr.message,
      kind: unknownErr.kind,
      statusCode: unknownErr.statusCode,
    },
    { status: unknownErr.statusCode }
  );
}

/**
 * Response type for successful API responses
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data?: T;
}

/**
 * Creates a standardized success response with consistent format.
 * 
 * Returns JSON response with {success: true, data: T} format or
 * just {success: true} if no data provided.
 * 
 * @example
 * ```typescript
 * // With data
 * return createApiResponse({ user: userData }, 200);
 * 
 * // Without data (just success flag)
 * return createApiResponse(undefined, 204);
 * 
 * // Default 200 status
 * return createApiResponse({ items: [] });
 * ```
 * 
 * @param data - Optional response data
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with standardized success format
 */
export function createApiResponse<T = unknown>(
  data?: T,
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  if (data === undefined) {
    return NextResponse.json({ success: true }, { status });
  }

  return NextResponse.json(
    { success: true, data },
    { status }
  );
}

/**
 * Re-export commonly used error factory functions for convenience
 */
export {
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  conflictError,
  unprocessableEntityError,
  serverError,
} from "@/types/errors";

export type { ApiError } from "@/types/errors";

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { requireAuth as middlewareRequireAuth } from "@/lib/middleware/utils";

/**
 * Authentication result type using discriminated union pattern.
 * Ensures type-safe handling of authentication success and failure cases.
 */
export type AuthResult =
  | { error: null; userId: string }
  | { error: NextResponse; userId: null };

/**
 * Validates user authentication and extracts user ID from middleware context.
 * 
 * This helper standardizes authentication logic across API routes,
 * eliminating duplicated session validation and user ID extraction code.
 * Uses the middleware-based authentication pattern for consistency.
 * 
 * @param request - The NextRequest object containing middleware headers
 * @returns Object with either authenticated userId or error response
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const { error, userId } = requireAuthFromRequest(request);
 *   if (error) return error;
 *   
 *   // Use userId for authenticated operations
 *   const data = await getData(userId);
 *   return NextResponse.json({ data });
 * }
 * ```
 */
export function requireAuthFromRequest(request: NextRequest): AuthResult {
  const context = getMiddlewareContext(request);
  const userOrResponse = middlewareRequireAuth(context);
  
  if (userOrResponse instanceof NextResponse) {
    return {
      error: userOrResponse,
      userId: null,
    };
  }
  
  return {
    error: null,
    userId: userOrResponse.id,
  };
}

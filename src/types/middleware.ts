import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// Middleware authentication status
export type AuthStatus = "authenticated" | "public" | "webhook" | "error";

// User context from middleware
export interface MiddlewareUser {
  id: string;
  email: string;
  name: string;
}

// Request context provided by middleware
export interface MiddlewareContext {
  requestId: string;
  authStatus: AuthStatus;
  user?: MiddlewareUser;
}

// Extended NextRequest with middleware context
export interface NextRequestWithContext extends NextRequest {
  middlewareContext: MiddlewareContext;
}

// Helper type for route handlers that use middleware context
export type RouteHandler<T = unknown> = (
  request: NextRequestWithContext,
  context?: T
) => Promise<Response>;

// Helper function to extract middleware context from request headers with improved type safety
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

// Helper function to require authentication in route handlers
// Throws error if not authenticated - caller should wrap in try-catch
export function requireAuth(context: MiddlewareContext): MiddlewareUser {
  if (context.authStatus !== "authenticated" || !context.user) {
    throw new Error("Authentication required");
  }
  return context.user;
}

// Helper to check auth and return 401 response if not authenticated
// Returns user if authenticated, or Response if not
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

// Type guard for authenticated requests
export function isAuthenticated(context: MiddlewareContext): context is MiddlewareContext & { user: MiddlewareUser } {
  return context.authStatus === "authenticated" && !!context.user;
}
import { NextRequest } from "next/server";

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
export type RouteHandler<T = unknown> = (request: NextRequestWithContext, context?: T) => Promise<Response>;

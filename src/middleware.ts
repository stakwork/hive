import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  MIDDLEWARE_HEADERS,
  resolveRouteAccess,
} from "@/config/middleware";

// Environment validation - fail fast if required secrets are missing
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET is required for middleware authentication');
}

// Generate a unique request ID for tracing using crypto API when available
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Type-safe token property extraction
function extractTokenProperty(token: Record<string, unknown> | null, property: string): string {
  const value = token?.[property];
  return typeof value === "string" ? value : "";
}

function sanitizeMiddlewareHeaders(headers: Headers) {
  Object.values(MIDDLEWARE_HEADERS).forEach((header) => {
    headers.delete(header);
  });
}

function continueRequest(headers: Headers, authStatus: string) {
  headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);
  const response = NextResponse.next({
    request: {
      headers,
    },
  });

  const requestId = headers.get(MIDDLEWARE_HEADERS.REQUEST_ID);
  if (requestId) {
    response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  }

  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);

  return response;
}

function respondWithJson(
  body: Record<string, unknown>,
  {
    status,
    requestId,
    authStatus,
  }: { status: number; requestId: string; authStatus: string }
) {
  const response = NextResponse.json(body, { status });
  response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);
  return response;
}

function redirectTo(
  destination: string,
  request: NextRequest,
  {
    requestId,
    authStatus,
  }: { requestId: string; authStatus: string }
) {
  const url = new URL(destination, request.url);
  const response = NextResponse.redirect(url);
  response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);
  return response;
}

export async function middleware(request: NextRequest) {
  const requestId = generateRequestId();
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api");
  const routeAccess = resolveRouteAccess(pathname);

  // Clone the request headers
  const requestHeaders = new Headers(request.headers);

  sanitizeMiddlewareHeaders(requestHeaders);
  
  // Add request ID to all requests
  requestHeaders.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);

  if (routeAccess === "public" || routeAccess === "webhook") {
    return continueRequest(
      requestHeaders,
      routeAccess
    );
  }

  try {
    // Get the session token
    const token = await getToken({ 
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      if (isApiRoute) {
        return respondWithJson(
          { error: "Unauthorized" },
          {
            status: 401,
            requestId,
            authStatus: "unauthorized",
          }
        );
      }

      return redirectTo(
        "/",
        request,
        {
          requestId,
          authStatus: "unauthenticated",
        }
      );
    } else {
      // Valid session - attach user information to headers using type-safe extraction
      requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, extractTokenProperty(token, "id"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, extractTokenProperty(token, "email"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, extractTokenProperty(token, "name"));

      // If using database sessions, the token might have additional data
      // This will be expanded in later phases
    }

    // Pass the modified request to the route handler
    return continueRequest(requestHeaders, "authenticated");
  } catch (error) {
    console.error(`[Middleware] Error processing request ${requestId}:`, error);
    
    // On error, allow the request to proceed but mark it
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_ID);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_EMAIL);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_NAME);
    return continueRequest(requestHeaders, "error");
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Apply to all routes except Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

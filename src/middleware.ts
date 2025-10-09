import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  MIDDLEWARE_HEADERS,
  resolveRouteAccess,
} from "@/config/middleware";
import {
  verifyCookie,
  isLandingPageEnabled,
  LANDING_COOKIE_NAME,
} from "@/lib/auth/landing-cookie";

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

  try {
    // Webhook routes - allow these to bypass all auth checks (they use their own auth like x-api-token)
    if (routeAccess === "webhook") {
      return continueRequest(
        requestHeaders,
        routeAccess
      );
    }

    // Landing page protection check - applies to both public and protected routes
    if (isLandingPageEnabled()) {
      // Get session token to check if user is authenticated
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
      });

      // Check for landing verification cookie
      const landingCookie = request.cookies.get(LANDING_COOKIE_NAME);
      const hasValidCookie = landingCookie && await verifyCookie(landingCookie.value);

      // No cookie AND no session - must verify at landing page first
      if (!hasValidCookie && !token) {
        // Allow root path to render landing page
        if (pathname === "/") {
          return continueRequest(requestHeaders, "landing_required");
        }

        // Allow landing verification API to work
        if (pathname === "/api/auth/verify-landing") {
          return continueRequest(requestHeaders, "landing_required");
        }

        // Redirect everything else to landing page
        return redirectTo(
          "/",
          request,
          {
            requestId,
            authStatus: "landing_required",
          }
        );
      }
    }

    // Public routes - after landing page check
    if (routeAccess === "public") {
      return continueRequest(
        requestHeaders,
        routeAccess
      );
    }

    // Get the session token (or reuse if already fetched above)
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
          },
        );
      }
      return redirectTo("/", request, {
        requestId,
        authStatus: "unauthenticated",
      });
    }

    // Valid session - attach user information to headers using type-safe extraction
    const userId = extractTokenProperty(token, "id");
    const userEmail = extractTokenProperty(token, "email");
    const userName = extractTokenProperty(token, "name");

    requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, userId);
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, userEmail);
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, userName);

    if (pathname.startsWith("/api/w/") || pathname.startsWith("/api/workspaces/")) {
      const match = pathname.match(/\/api\/(?:w|workspaces)\/([^\/]+)/);
      const slug = match ? match[1] : null;
      if (slug) {
        const { validateWorkspaceAccess } = await import("@/services/workspace");
        const access = await validateWorkspaceAccess(slug, userId);
        if (!access.hasAccess) {
          return respondWithJson(
            { error: "Workspace not found or access denied" },
            {
              status: 403,
              requestId,
              authStatus: "forbidden",
            },
          );
        }
        requestHeaders.set("x-middleware-workspace-id", access.workspace?.id || "");
        requestHeaders.set("x-middleware-workspace-role", access.userRole || "");
      }
    }

    // Pass the modified request to the route handler
    return continueRequest(requestHeaders, "authenticated");
  } catch (error) {
    console.error(`[Middleware] Error processing request ${requestId}:`, error);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_ID);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_EMAIL);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_NAME);
    return continueRequest(requestHeaders, "error");
  }
};

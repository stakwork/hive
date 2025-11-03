import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { MIDDLEWARE_HEADERS, resolveRouteAccess } from "@/config/middleware";
import { verifyCookie, isLandingPageEnabled, LANDING_COOKIE_NAME } from "@/lib/auth/landing-cookie";
import { getCorsHeaders, shouldApplyCors } from "@/lib/cors";
import type { ApiError } from "@/types/errors";
// Environment validation - fail fast if required secrets are missing
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET is required for middleware authentication");
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

function continueRequestWithCors(headers: Headers, authStatus: string, origin: string | null, pathname: string) {
  const response = continueRequest(headers, authStatus);
  
  // Add CORS headers if origin is trusted and route is eligible
  if (shouldApplyCors(pathname)) {
    const corsHeaders = getCorsHeaders(origin);
    if (corsHeaders) {
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    }
  }
  
  return response;
}

function respondWithJson(
  body: Record<string, unknown>,
  { status, requestId, authStatus }: { status: number; requestId: string; authStatus: string },
) {
  const response = NextResponse.json(body, { status });
  response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);
  return response;
}
function redirectTo(
  destination: string,
  request: NextRequest,
  { requestId, authStatus }: { requestId: string; authStatus: string },
) {
  const url = new URL(destination, request.url);
  const response = NextResponse.redirect(url);
  response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);
  return response;
}

function respondWithApiError(error: ApiError, requestId: string, authStatus: string) {
  return respondWithJson(
    { error: error.message, kind: error.kind, details: error.details },
    { status: error.statusCode, requestId, authStatus },
  );
}

export async function middleware(request: NextRequest) {
  const requestId = generateRequestId();
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api");
  const routeAccess = resolveRouteAccess(pathname);

  const requestHeaders = new Headers(request.headers);
  sanitizeMiddlewareHeaders(requestHeaders);
  requestHeaders.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);

  try {
    // Handle CORS preflight OPTIONS requests before authentication
    // This must occur before any auth checks to allow browsers to validate CORS
    if (request.method === "OPTIONS" && shouldApplyCors(pathname)) {
      const origin = request.headers.get("origin");
      const corsHeaders = getCorsHeaders(origin);
      
      if (corsHeaders) {
        const response = new NextResponse(null, { status: 204 });
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
        response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
        return response;
      }
    }

    // System and webhook routes bypass all authentication checks
    // Note: Webhook routes do NOT get CORS headers (server-to-server communication)
    if (routeAccess === "webhook" || routeAccess === "system") {
      return continueRequest(requestHeaders, routeAccess);
    }

    const origin = request.headers.get("origin");

    // Landing page protection (when enabled) for all non-system/webhook routes
    if (isLandingPageEnabled()) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      const landingCookie = request.cookies.get(LANDING_COOKIE_NAME);
      const hasValidCookie = landingCookie && (await verifyCookie(landingCookie.value));
      if (!hasValidCookie && !token) {
        if (pathname === "/") {
          return continueRequestWithCors(requestHeaders, "landing_required", origin, pathname);
        }
        if (pathname === "/api/auth/verify-landing") {
          return continueRequestWithCors(requestHeaders, "landing_required", origin, pathname);
        }
        return redirectTo("/", request, { requestId, authStatus: "landing_required" });
      }
    }

    // Public routes (auth pages, onboarding) - accessible after landing page check
    if (routeAccess === "public") {
      return continueRequestWithCors(requestHeaders, routeAccess, origin, pathname);
    }

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      if (isApiRoute) {
        return respondWithJson({ error: "Unauthorized" }, { status: 401, requestId, authStatus: "unauthorized" });
      }
      return redirectTo("/", request, { requestId, authStatus: "unauthenticated" });
    } else {
      requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, extractTokenProperty(token, "id"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, extractTokenProperty(token, "email"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, extractTokenProperty(token, "name"));
    }

    return continueRequestWithCors(requestHeaders, "authenticated", origin, pathname);
  } catch (error) {
    const origin = request.headers.get("origin");
    if (isApiRoute && typeof error === "object" && error && "kind" in error && "statusCode" in error) {
      return respondWithApiError(error as ApiError, requestId, "error");
    }
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_ID);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_EMAIL);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_NAME);
    return continueRequestWithCors(requestHeaders, "error", origin, pathname);
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and public static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};

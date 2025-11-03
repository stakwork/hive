import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { MIDDLEWARE_HEADERS, resolveRouteAccess } from "@/config/middleware";
import { verifyCookie, isLandingPageEnabled, LANDING_COOKIE_NAME } from "@/lib/auth/landing-cookie";
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

// Add security headers to response (HSTS, X-Content-Type-Options, etc.)
function addSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const host = request.headers.get("host") || "";
  const isLocalhost = host.includes("localhost");

  // Only add HSTS in production environments (not localhost)
  if (!isLocalhost) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // Add other security headers for all environments
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
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

function continueRequest(headers: Headers, authStatus: string, request: NextRequest) {
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

  // Inject security headers
  addSecurityHeaders(response, request);

  return response;
}

function respondWithJson(
  body: Record<string, unknown>,
  {
    status,
    requestId,
    authStatus,
    request,
  }: { status: number; requestId: string; authStatus: string; request: NextRequest },
) {
  const response = NextResponse.json(body, { status });
  response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
  response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, authStatus);

  // Inject security headers
  addSecurityHeaders(response, request);

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

  // Inject security headers
  addSecurityHeaders(response, request);

  return response;
}

function respondWithApiError(error: ApiError, requestId: string, authStatus: string, request: NextRequest) {
  return respondWithJson(
    { error: error.message, kind: error.kind, details: error.details },
    { status: error.statusCode, requestId, authStatus, request },
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

  // HTTPS Enforcement: Redirect HTTP to HTTPS (except localhost)
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "";
  const isLocalhost = host.includes("localhost");

  if (!isLocalhost && protocol === "http") {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    const response = NextResponse.redirect(httpsUrl, 301);
    response.headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);
    response.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "https_redirect");
    addSecurityHeaders(response, request);
    return response;
  }

  try {
    // System and webhook routes bypass all authentication checks
    if (routeAccess === "webhook" || routeAccess === "system") {
      return continueRequest(requestHeaders, routeAccess, request);
    }

    // Landing page protection (when enabled) for all non-system/webhook routes
    if (isLandingPageEnabled()) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
      const landingCookie = request.cookies.get(LANDING_COOKIE_NAME);
      const hasValidCookie = landingCookie && (await verifyCookie(landingCookie.value));
      if (!hasValidCookie && !token) {
        if (pathname === "/") {
          return continueRequest(requestHeaders, "landing_required", request);
        }
        if (pathname === "/api/auth/verify-landing") {
          return continueRequest(requestHeaders, "landing_required", request);
        }
        return redirectTo("/", request, { requestId, authStatus: "landing_required" });
      }
    }

    // Public routes (auth pages, onboarding) - accessible after landing page check
    if (routeAccess === "public") {
      return continueRequest(requestHeaders, routeAccess, request);
    }

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      if (isApiRoute) {
        return respondWithJson(
          { error: "Unauthorized" },
          { status: 401, requestId, authStatus: "unauthorized", request },
        );
      }
      return redirectTo("/", request, { requestId, authStatus: "unauthenticated" });
    } else {
      requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, extractTokenProperty(token, "id"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, extractTokenProperty(token, "email"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, extractTokenProperty(token, "name"));
    }

    return continueRequest(requestHeaders, "authenticated", request);
  } catch (error) {
    if (isApiRoute && typeof error === "object" && error && "kind" in error && "statusCode" in error) {
      return respondWithApiError(error as ApiError, requestId, "error", request);
    }
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_ID);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_EMAIL);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_NAME);
    return continueRequest(requestHeaders, "error", request);
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and public static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};

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

// Determine if we should use secure cookies based on request URL and headers
// NextAuth uses secure cookies (__Secure- prefix) only for HTTPS
// Always use regular cookies for localhost, regardless of protocol (unless proxied)
function shouldUseSecureCookie(request: NextRequest): boolean {
  const url = request.nextUrl;

  // Check if request is behind a proxy (code-server, reverse proxy, etc.)
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");

  // console.log("shouldUseSecureCookie:", {
  //   hostname: url.hostname,
  //   protocol: url.protocol,
  //   forwardedProto,
  //   forwardedHost,
  // });

  // If behind a proxy, use the forwarded protocol to determine security
  // This handles cases like code-server where hostname is localhost but traffic is actually HTTPS
  if (forwardedProto || forwardedHost) {
    const useSecure = forwardedProto === "https";
    // console.log(`Behind proxy: using ${useSecure ? "secure" : "non-secure"} cookies`);
    return useSecure;
  }

  // For direct connections (true local development), exclude localhost
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const isHttps = url.protocol === "https:";
  const useSecure = isHttps && !isLocalhost;
  // console.log(`Direct connection: using ${useSecure ? 'secure' : 'non-secure'} cookies`);
  return useSecure;
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
    // Block mock endpoints in production
    if (pathname.startsWith("/api/mock") && process.env.NODE_ENV === "production") {
      return respondWithJson({ error: "Not found" }, { status: 404, requestId, authStatus: "blocked" });
    }

    // System and webhook routes bypass all authentication checks
    if (routeAccess === "webhook" || routeAccess === "system") {
      return continueRequest(requestHeaders, routeAccess);
    }

    // Landing page protection (when enabled) for all non-system/webhook routes
    if (isLandingPageEnabled()) {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        secureCookie: shouldUseSecureCookie(request),
      });
      const landingCookie = request.cookies.get(LANDING_COOKIE_NAME);
      const hasValidCookie = landingCookie && (await verifyCookie(landingCookie.value));
      if (!hasValidCookie && !token) {
        if (pathname === "/") {
          return continueRequest(requestHeaders, "landing_required");
        }
        if (pathname === "/api/auth/verify-landing") {
          return continueRequest(requestHeaders, "landing_required");
        }
        return redirectTo("/", request, { requestId, authStatus: "landing_required" });
      }
    }

    // Public routes (auth pages, onboarding) - accessible after landing page check
    if (routeAccess === "public") {
      return continueRequest(requestHeaders, routeAccess);
    }

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: shouldUseSecureCookie(request),
    });
    if (!token) {
      // Allow API token auth to pass through to route handlers
      if (isApiRoute && request.headers.get("x-api-token")) {
        return continueRequest(requestHeaders, "webhook");
      }
      if (isApiRoute) {
        return respondWithJson({ error: "Unauthorized" }, { status: 401, requestId, authStatus: "unauthorized" });
      }
      return redirectTo("/", request, { requestId, authStatus: "unauthenticated" });
    } else {
      requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, extractTokenProperty(token, "id"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, extractTokenProperty(token, "email"));
      requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, extractTokenProperty(token, "name"));
      
      // Store role in header if present (for superadmin checks)
      const role = extractTokenProperty(token, "role");
      if (role) {
        requestHeaders.set(MIDDLEWARE_HEADERS.USER_ROLE, role);
      }
    }

    // Superadmin routes require SUPER_ADMIN role
    if (routeAccess === "superadmin") {
      const role = extractTokenProperty(token, "role");
      const userId = extractTokenProperty(token, "id");
      // Temporary: allow dev-user for testing
      if (role !== "SUPER_ADMIN" && userId !== "cmm59kkms0000wujlxpjdg437") {
        if (isApiRoute) {
          return respondWithJson({ error: "Forbidden" }, { status: 403, requestId, authStatus: "forbidden" });
        }
        return redirectTo("/", request, { requestId, authStatus: "forbidden" });
      }
    }

    return continueRequest(requestHeaders, "authenticated");
  } catch (error) {
    if (isApiRoute && typeof error === "object" && error && "kind" in error && "statusCode" in error) {
      return respondWithApiError(error as ApiError, requestId, "error");
    }
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_ID);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_EMAIL);
    requestHeaders.delete(MIDDLEWARE_HEADERS.USER_NAME);
    return continueRequest(requestHeaders, "error");
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and public static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};

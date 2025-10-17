import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { MIDDLEWARE_HEADERS, resolveRouteAccess } from "@/config/middleware";
import { verifyCookie, isLandingPageEnabled, LANDING_COOKIE_NAME } from "@/lib/auth/landing-cookie";
// Environment validation - fail fast if required secrets are missing

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

export async function middleware(request: NextRequest) {
  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET is required for middleware authentication");
  }
  const requestId = generateRequestId();
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api");
  const routeAccess = resolveRouteAccess(pathname);

  const requestHeaders = new Headers(request.headers);
  sanitizeMiddlewareHeaders(requestHeaders);
  requestHeaders.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);

  try {
    // System and webhook routes bypass all authentication checks
    if (routeAccess === "webhook" || routeAccess === "system") {
      return continueRequest(requestHeaders, routeAccess);
    }

    // Landing page protection (when enabled) for all non-system/webhook routes
    if (isLandingPageEnabled()) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
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

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    const id = extractTokenProperty(token, "id");
    const email = extractTokenProperty(token, "email");
    const name = extractTokenProperty(token, "name");
    if (!token || !id || !email || !name) {
      if (isApiRoute) {
        return respondWithJson(
          { kind: "unauthorized", statusCode: 401, message: "Unauthorized" },
          { status: 401, requestId, authStatus: "unauthorized" },
        );
      }
      return redirectTo("/", request, { requestId, authStatus: "unauthenticated" });
    }
    requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_ID, id);
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_EMAIL, email);
    requestHeaders.set(MIDDLEWARE_HEADERS.USER_NAME, name);
    return continueRequest(requestHeaders, "authenticated");
  } catch (error) {
    console.error("Error in middleware:", error);
    if (isApiRoute) {
      return respondWithJson(
        { kind: "server_error", statusCode: 500, message: "Internal Server Error" },
        { status: 500, requestId, authStatus: "error" },
      );
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

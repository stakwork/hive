import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { 
  MIDDLEWARE_HEADERS, 
  PUBLIC_ROUTES, 
  WEBHOOK_ROUTE_PATTERN 
} from "@/config/middleware";

// Generate a unique request ID for tracing using crypto API when available
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Check if the path is a public route that doesn't require authentication
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

// Check if the path is a webhook route
function isWebhookRoute(pathname: string): boolean {
  return pathname.includes(WEBHOOK_ROUTE_PATTERN);
}

// Type-safe token property extraction
function extractTokenProperty(token: any, property: string): string {
  const value = token?.[property];
  return typeof value === "string" ? value : "";
}

export async function middleware(request: NextRequest) {
  const requestId = generateRequestId();
  const { pathname } = request.nextUrl;

  // Clone the request headers
  const requestHeaders = new Headers(request.headers);
  
  // Add request ID to all requests
  requestHeaders.set(MIDDLEWARE_HEADERS.REQUEST_ID, requestId);

  // Skip authentication for public routes
  if (isPublicRoute(pathname)) {
    requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "public");
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  try {
    // Get the session token
    const token = await getToken({ 
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      // No valid session - return 401 for protected routes
      if (!isWebhookRoute(pathname)) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
      // Webhooks don't require auth but we mark them as such
      requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "webhook");
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
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error(`[Middleware] Error processing request ${requestId}:`, error);
    
    // On error, allow the request to proceed but mark it
    requestHeaders.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "error");
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Match all API routes
    "/api/:path*",
    // Exclude Next.js internal routes
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
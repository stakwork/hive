import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import {
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS,
} from "@/lib/constants";

// Edge-safe slug validation (no DB calls)
function validateWorkspaceSlugFormat(slug: string): boolean {
  // Check length
  if (
    slug.length < WORKSPACE_SLUG_PATTERNS.MIN_LENGTH ||
    slug.length > WORKSPACE_SLUG_PATTERNS.MAX_LENGTH
  ) {
    return false;
  }

  // Check format (lowercase alphanumeric with hyphens, start/end with alphanumeric)
  if (!WORKSPACE_SLUG_PATTERNS.VALID.test(slug)) {
    return false;
  }

  // Check against reserved slugs
  if (
    RESERVED_WORKSPACE_SLUGS.includes(
      slug as (typeof RESERVED_WORKSPACE_SLUGS)[number],
    )
  ) {
    return false;
  }

  return true;
}

// Extract workspace slug from different URL patterns
function extractWorkspaceSlug(pathname: string): string | null {
  // Match /w/[workspace-slug]/... pattern
  const workspaceMatch = pathname.match(/^\/w\/([^\/]+)/);
  if (workspaceMatch) {
    return workspaceMatch[1];
  }

  // For future root-level workspace patterns, we would handle them here
  // For now, we only support /w/[slug] pattern to avoid conflicts

  return null;
}

export default withAuth(
  async function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    console.log("Middleware running for:", pathname);
    console.log("Token exists:", !!token);

    // Extract first path segment to check against reserved slugs
    const firstSegment = pathname.split("/")[1];

    // Skip middleware for reserved system routes
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/_next/") ||
      pathname.startsWith("/favicon.ico") ||
      (firstSegment &&
        RESERVED_WORKSPACE_SLUGS.includes(
          firstSegment as (typeof RESERVED_WORKSPACE_SLUGS)[number],
        ))
    ) {
      return NextResponse.next();
    }

    // Handle authenticated routes
    if (token?.sub) {
      // Extract workspace slug from URL
      const workspaceSlug = extractWorkspaceSlug(pathname);

      if (workspaceSlug) {
        console.log("Workspace slug detected:", workspaceSlug);

        // Validate slug format (edge-safe)
        if (!validateWorkspaceSlugFormat(workspaceSlug)) {
          console.log("Invalid workspace slug format:", workspaceSlug);
          // Redirect to workspace onboarding for invalid slugs
          return NextResponse.redirect(
            new URL("/onboarding/workspace", req.url),
          );
        }

        // For workspace-scoped routes, allow through (access validation happens at page level)
        return NextResponse.next();
      }

      // Handle legacy routes that should be workspace-scoped but don't have a slug
      if (
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/roadmap") ||
        pathname.startsWith("/tasks") ||
        pathname.startsWith("/settings") ||
        pathname.startsWith("/code-graph") ||
        pathname.startsWith("/stakgraph")
      ) {
        console.log(
          "Legacy route detected, redirecting to workspace onboarding...",
        );

        // Redirect to onboarding page which can handle workspace checking server-side
        return NextResponse.redirect(new URL("/onboarding/workspace", req.url));
      }

      // Handle root route - let the root page handle redirection logic
      if (pathname === "/") {
        return NextResponse.next();
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        console.log("Auth callback - path:", pathname, "token:", !!token);

        // Extract first path segment
        const firstSegment = pathname.split("/")[1];

        // Allow access to reserved system routes
        if (
          firstSegment &&
          RESERVED_WORKSPACE_SLUGS.includes(
            firstSegment as (typeof RESERVED_WORKSPACE_SLUGS)[number],
          )
        ) {
          // Onboarding routes require authentication
          if (pathname.startsWith("/onboarding/")) {
            return !!token;
          }
          // Other system routes (auth, api, etc.) are handled by their own logic
          return true;
        }

        // Require auth for workspace routes
        if (pathname.startsWith("/w/")) {
          return !!token;
        }

        // Require auth for legacy routes (will be redirected to workspace-scoped versions)
        if (
          pathname.startsWith("/dashboard") ||
          pathname.startsWith("/roadmap") ||
          pathname.startsWith("/tasks") ||
          pathname.startsWith("/settings") ||
          pathname.startsWith("/code-graph") ||
          pathname.startsWith("/stakgraph")
        ) {
          return !!token;
        }

        // Allow public routes
        return true;
      },
    },
    pages: {
      signIn: "/auth/signin",
    },
  },
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};

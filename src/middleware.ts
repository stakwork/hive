import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    
    // Handle refresh token errors
    if (token?.error === "RefreshAccessTokenError") {
      // Redirect to sign in page for token refresh errors
      const signInUrl = new URL("/auth/signin", req.url);
      signInUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signInUrl);
    }

    // Allow the request to continue
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow access to public routes
        if (
          req.nextUrl.pathname.startsWith("/auth") ||
          req.nextUrl.pathname.startsWith("/onboarding") ||
          req.nextUrl.pathname === "/"
        ) {
          return true;
        }

        // For protected routes, require valid token without errors
        return !!token && !token.error;
      },
    },
  }
);

export const config = {
  matcher: [
    // Match all paths except static files and API routes that don't need auth
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/health).*)",
  ],
};
// Middleware configuration constants

// Custom headers for passing data from middleware to API routes
export const MIDDLEWARE_HEADERS = {
  USER_ID: "x-middleware-user-id",
  USER_EMAIL: "x-middleware-user-email", 
  USER_NAME: "x-middleware-user-name",
  REQUEST_ID: "x-middleware-request-id",
  AUTH_STATUS: "x-middleware-auth-status",
} as const;

// Public routes that don't require authentication
export const PUBLIC_ROUTES = [
  "/api/auth",
  "/api/github/webhook",
  "/api/stakwork/webhook", 
  "/api/janitors/webhook",
  "/api/swarm/stakgraph/webhook",
  "/api/mock",
  "/api/tests/coverage",
] as const;

// Routes that are considered webhooks (for special handling)
export const WEBHOOK_ROUTE_PATTERN = "/webhook";

// Next.js routes to exclude from middleware processing
export const EXCLUDED_PATTERNS = [
  "/_next/static",
  "/_next/image", 
  "/favicon.ico",
] as const;
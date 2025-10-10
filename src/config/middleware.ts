// Middleware configuration constants and route policy helpers

export const MIDDLEWARE_HEADERS = {
  USER_ID: "x-middleware-user-id",
  USER_EMAIL: "x-middleware-user-email",
  USER_NAME: "x-middleware-user-name",
  REQUEST_ID: "x-middleware-request-id",
  AUTH_STATUS: "x-middleware-auth-status",
} as const;

export type RouteAccess = "public" | "webhook" | "protected";
export type RouteMatchStrategy = "exact" | "prefix";

export interface RoutePolicy {
  path: string;
  strategy: RouteMatchStrategy;
  access: Exclude<RouteAccess, "protected">;
}

export const ROUTE_POLICIES: ReadonlyArray<RoutePolicy> = [
  { path: "/", strategy: "exact", access: "public" },
  { path: "/auth", strategy: "prefix", access: "public" },
  { path: "/onboarding", strategy: "prefix", access: "public" },
  { path: "/api/auth", strategy: "prefix", access: "public" },
  { path: "/api/cron", strategy: "prefix", access: "public" },
  { path: "/api/mock", strategy: "prefix", access: "public" },
  { path: "/api/github/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/stakwork/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/janitors/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/swarm/stakgraph/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/chat/response", strategy: "prefix", access: "webhook" },
] as const;

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  // Remove trailing slash for consistent comparisons (except for root)
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function matchesPolicy(pathname: string, policy: RoutePolicy): boolean {
  if (policy.strategy === "exact") {
    return pathname === policy.path;
  }

  return pathname === policy.path || pathname.startsWith(`${policy.path}/`);
}

export function resolveRouteAccess(pathname: string): RouteAccess {
  const normalized = normalizePath(pathname);

  for (const policy of ROUTE_POLICIES) {
    if (matchesPolicy(normalized, policy)) {
      return policy.access;
    }
  }

  return "protected";
}

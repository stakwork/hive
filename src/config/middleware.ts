// Middleware configuration constants and route policy helpers
import { patternToRegex } from "@/lib/middleware/utils";

export const MIDDLEWARE_HEADERS = {
  USER_ID: "x-middleware-user-id",
  USER_EMAIL: "x-middleware-user-email",
  USER_NAME: "x-middleware-user-name",
  REQUEST_ID: "x-middleware-request-id",
  AUTH_STATUS: "x-middleware-auth-status",
} as const;

export type RouteAccess = "public" | "webhook" | "system" | "protected";
export type RouteMatchStrategy = "exact" | "prefix" | "pattern";

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
  { path: "/api/cron", strategy: "prefix", access: "system" },
  { path: "/api/mock", strategy: "prefix", access: "public" },
  { path: "/api/screenshots", strategy: "prefix", access: "public" },
  { path: "/api/github/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/github/app/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/stakwork/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/webhook/stakwork", strategy: "prefix", access: "webhook" },
  { path: "/api/graph/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/janitors/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/swarm/stakgraph/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/chat/response", strategy: "prefix", access: "webhook" },
  { path: "/api/bounty/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/tasks/*/title", strategy: "pattern", access: "webhook" },
  { path: "/api/tasks/*/recording", strategy: "pattern", access: "webhook" },
  { path: "/api/tasks/*/webhook", strategy: "pattern", access: "webhook" },
  { path: "/api/pool-manager/drop-pod", strategy: "prefix", access: "webhook" },
  { path: "/api/webhook/pool-manager", strategy: "prefix", access: "webhook" },
  { path: "/api/workspaces/*/stakgraph", strategy: "pattern", access: "webhook" },
  { path: "/api/agent/webhook", strategy: "prefix", access: "webhook" }, // has its own auth check
  { path: "/api/vercel/log-drain", strategy: "prefix", access: "webhook" },
  { path: "/api/members", strategy: "prefix", access: "webhook" },
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

  if (policy.strategy === "pattern") {
    const regex = patternToRegex(policy.path);
    return regex.test(pathname);
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

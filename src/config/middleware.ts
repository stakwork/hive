// Middleware configuration constants and route policy helpers
import { patternToRegex } from "@/lib/middleware/utils";

export const MIDDLEWARE_HEADERS = {
  USER_ID: "x-middleware-user-id",
  USER_EMAIL: "x-middleware-user-email",
  USER_NAME: "x-middleware-user-name",
  USER_ROLE: "x-middleware-user-role",
  REQUEST_ID: "x-middleware-request-id",
  AUTH_STATUS: "x-middleware-auth-status",
} as const;

export type RouteAccess = "public" | "webhook" | "system" | "superadmin" | "protected";
export type RouteMatchStrategy = "exact" | "prefix" | "pattern";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RoutePolicy {
  path: string;
  strategy: RouteMatchStrategy;
  access: Exclude<RouteAccess, "protected">;
  /**
   * Restrict the policy to specific HTTP methods. When omitted, the policy
   * applies to every method. Use this to expose read endpoints publicly
   * while keeping writes auth-only:
   *
   *   { path: "/api/workspaces/*", strategy: "pattern", access: "public",
   *     methods: ["GET"] }
   *
   * Method matching is case-insensitive.
   */
  methods?: readonly HttpMethod[];
}

export const ROUTE_POLICIES: ReadonlyArray<RoutePolicy> = [
  { path: "/", strategy: "exact", access: "public" },
  { path: "/auth", strategy: "prefix", access: "public" },
  { path: "/prototype", strategy: "prefix", access: "public" },
  { path: "/onboarding", strategy: "prefix", access: "public" },
  { path: "/w/**", strategy: "pattern", access: "public" },
  { path: "/admin", strategy: "prefix", access: "superadmin" },
  { path: "/verify", strategy: "prefix", access: "webhook" }, // Sphinx app auth callback (bypasses landing page)
  { path: "/person", strategy: "exact", access: "webhook" }, // Sphinx app post-link profile sync
  { path: "/api/auth/sphinx/token", strategy: "exact", access: "webhook" }, // Sphinx app token exchange (has own auth, bypasses landing page)
  { path: "/api/auth", strategy: "prefix", access: "public" },
  { path: "/api/cron", strategy: "prefix", access: "system" },
  { path: "/api/admin", strategy: "prefix", access: "superadmin" },
  { path: "/api/mock", strategy: "prefix", access: "public" },
  { path: "/api/workspaces/slug-availability", strategy: "exact", access: "public" },
  { path: "/api/graphmindset/slug-availability", strategy: "exact", access: "public" },

  // --- Public workspace view: allowlist of GET endpoints ------------------
  //
  // Unauthenticated visitors may GET these routes; each handler then calls
  // `resolveWorkspaceAccess` which returns the workspace only if it is
  // flagged `isPublicViewable`. Any non-GET request on the same path falls
  // through to the protected default and requires authentication.
  //
  // DO NOT replace these with broader wildcards like `/api/workspaces/*` —
  // the workspace subtree contains settings, api-keys, git-leaks, and other
  // routes that must never be reachable without a session. Adding a new
  // endpoint is a conscious act; keep this list explicit.
  //
  // When adding a new endpoint here, confirm the route handler uses
  // `resolveWorkspaceAccess` + `requireReadAccess` (NOT `requireAuth`) and
  // applies redaction helpers from `@/lib/auth/public-redact`.
  { path: "/api/workspaces/*", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/workspaces/*/image", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/workspaces/*/search", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/workspaces/*/graph/nodes", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/workspaces/*/graph/gitree", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/workspaces/*/nodes", strategy: "pattern", access: "public", methods: ["GET"] },
  // Members GET is `public` so middleware populates auth headers for
  // signed-in callers (letting the handler's resolveWorkspaceAccess
  // distinguish a workspace member from an anonymous public viewer) while
  // still allowing anonymous reads of public workspaces (redacted via
  // toPublicMember). Non-GET methods fall through to the `webhook` entry
  // below, which bypasses middleware auth so the handlers can validate
  // Bearer tokens OR sessions themselves. IMPORTANT: this `public, GET`
  // entry MUST come before the `webhook` entry for the same path —
  // policies are first-wins.
  { path: "/api/workspaces/*/members", strategy: "pattern", access: "public", methods: ["GET"] },

  { path: "/api/tasks", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/tasks/stats", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/tasks/*/messages", strategy: "pattern", access: "public", methods: ["GET"] },

  { path: "/api/features", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/features/board", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/features/*", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/features/*/chat", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/features/*/attachments", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/features/*/attachments/count", strategy: "pattern", access: "public", methods: ["GET"] },

  { path: "/api/phases/*", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/tickets/*", strategy: "pattern", access: "public", methods: ["GET"] },

  { path: "/api/whiteboards", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/whiteboards/*", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/whiteboards/*/images", strategy: "pattern", access: "public", methods: ["GET"] },
  { path: "/api/whiteboards/*/versions", strategy: "pattern", access: "public", methods: ["GET"] },

  { path: "/api/swarm/jarvis/schema", strategy: "exact", access: "public", methods: ["GET"] },
  { path: "/api/swarm/jarvis/nodes", strategy: "exact", access: "public", methods: ["GET"] },
  // ------------------------------------------------------------------------
  { path: "/api/mock-agent-log", strategy: "prefix", access: "public" },
  { path: "/api/screenshots", strategy: "prefix", access: "public" },
  { path: "/api/github/fork/config", strategy: "exact", access: "public" },
  { path: "/api/github/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/github/app/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/stakwork/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/webhook/stakwork", strategy: "prefix", access: "webhook" },
  { path: "/api/graph/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/janitors/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/swarm/stakgraph/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/chat/response", strategy: "prefix", access: "webhook" },
  { path: "/api/bounty/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/ec2/alerts", strategy: "prefix", access: "webhook" },
  { path: "/api/tasks/*/title", strategy: "pattern", access: "webhook" },
  { path: "/api/tasks/*/recording", strategy: "pattern", access: "webhook" },
  { path: "/api/tasks/*/webhook", strategy: "pattern", access: "webhook" },
  { path: "/api/webhook/pool-manager", strategy: "prefix", access: "webhook" },
  { path: "/api/w/*/pool/workspaces", strategy: "pattern", access: "webhook" },
  { path: "/api/workspaces/*/stakgraph", strategy: "pattern", access: "webhook" },
  { path: "/api/workspaces/*/members", strategy: "pattern", access: "webhook" },
  { path: "/api/workspaces/*/members/*", strategy: "pattern", access: "webhook" },
  { path: "/api/agent/webhook", strategy: "prefix", access: "webhook" }, // has its own auth check
  { path: "/api/webhook/agent-logs", strategy: "prefix", access: "webhook" },
  { path: "/api/agent-logs/*/content", strategy: "pattern", access: "webhook" }, // has its own auth (signed URL or session)
  { path: "/api/agent-logs/*/stats", strategy: "pattern", access: "webhook" }, // has its own auth (signed URL or session)
  { path: "/api/config/price", strategy: "exact", access: "public" },
  { path: "/api/stripe/checkout", strategy: "exact", access: "public" },
  { path: "/api/lightning/invoice/preauth", strategy: "exact", access: "public" },
  { path: "/api/lightning/invoice/status", strategy: "exact", access: "public" },
  { path: "/api/stripe/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/lightning/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/vercel/log-drain", strategy: "prefix", access: "webhook" },
  { path: "/api/members", strategy: "prefix", access: "webhook" },
  { path: "/api/workspaces", strategy: "exact", access: "webhook" },
  { path: "/api/features/*/title", strategy: "pattern", access: "webhook" },
  { path: "/api/pool-manager/claim-pod/*", strategy: "pattern", access: "webhook" },
  { path: "/mcp", strategy: "prefix", access: "webhook" },
] as const;

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  // Remove trailing slash for consistent comparisons (except for root)
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function matchesPath(pathname: string, policy: RoutePolicy): boolean {
  if (policy.strategy === "exact") {
    return pathname === policy.path;
  }

  if (policy.strategy === "pattern") {
    // Pattern wildcard semantics:
    //   `/*`  — matches exactly one path segment (no slashes).
    //   `/**` — matches one segment AND any nested sub-path. Use this for
    //           entire sections of the site (e.g. `/w/**`).
    //
    // We need `/**` because `/*` alone only matches `/w/foo` and would
    // miss `/w/foo/tasks`. But we also need the strict `/*` form because
    // policies like `/api/workspaces/*` (= the exact slug endpoint)
    // should NOT match nested subroutes like `.../settings/sphinx`.
    if (policy.path.endsWith("/**")) {
      const basePath = policy.path.slice(0, -3); // strip `/**`
      const prefixRegex = patternToRegex(basePath + "/*");
      if (prefixRegex.test(pathname)) return true;
      const nestedRegex = new RegExp(
        prefixRegex.source.replace(/\$$/, "\\/.+$"),
      );
      return nestedRegex.test(pathname);
    }
    const regex = patternToRegex(policy.path);
    return regex.test(pathname);
  }

  return pathname === policy.path || pathname.startsWith(`${policy.path}/`);
}

function matchesMethod(method: string | undefined, policy: RoutePolicy): boolean {
  // Policies without a `methods` restriction apply to every method.
  if (!policy.methods || policy.methods.length === 0) return true;
  // Policies WITH a `methods` restriction are skipped when the caller did
  // not supply a method — we refuse to guess whether the unknown method
  // is in the allowlist. Callers who want method-aware resolution must
  // pass the method explicitly.
  if (!method) return false;
  return policy.methods.includes(method.toUpperCase() as HttpMethod);
}

function matchesPolicy(
  pathname: string,
  method: string | undefined,
  policy: RoutePolicy,
): boolean {
  return matchesPath(pathname, policy) && matchesMethod(method, policy);
}

export function resolveRouteAccess(
  pathname: string,
  method?: string,
): RouteAccess {
  const normalized = normalizePath(pathname);

  for (const policy of ROUTE_POLICIES) {
    if (matchesPolicy(normalized, method, policy)) {
      return policy.access;
    }
  }

  return "protected";
}

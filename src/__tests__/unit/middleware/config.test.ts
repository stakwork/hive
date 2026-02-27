import { describe, it, expect } from "vitest";
import {
  resolveRouteAccess,
  ROUTE_POLICIES,
  type RouteAccess,
} from "@/config/middleware";

describe("resolveRouteAccess", () => {
  describe("Exact Route Matching", () => {
    it("matches root path exactly", () => {
      const access = resolveRouteAccess("/");

      expect(access).toBe("public");
    });

    it("treats root with trailing slash the same as root", () => {
      const accessWithSlash = resolveRouteAccess("/");
      const accessWithoutSlash = resolveRouteAccess("/");

      expect(accessWithSlash).toBe(accessWithoutSlash);
    });
  });

  describe("Prefix Route Matching", () => {
    it("matches /auth prefix for public routes", () => {
      expect(resolveRouteAccess("/auth")).toBe("public");
      expect(resolveRouteAccess("/auth/signin")).toBe("public");
      expect(resolveRouteAccess("/auth/callback/github")).toBe("public");
    });

    it("matches /onboarding prefix for public routes", () => {
      expect(resolveRouteAccess("/onboarding")).toBe("public");
      expect(resolveRouteAccess("/onboarding/workspace")).toBe("public");
      expect(resolveRouteAccess("/onboarding/complete")).toBe("public");
    });

    it("matches /api/auth prefix for public routes", () => {
      expect(resolveRouteAccess("/api/auth")).toBe("public");
      expect(resolveRouteAccess("/api/auth/signin")).toBe("public");
      expect(resolveRouteAccess("/api/auth/session")).toBe("public");
    });

    it("matches /api/cron prefix for system routes", () => {
      expect(resolveRouteAccess("/api/cron")).toBe("system");
      expect(resolveRouteAccess("/api/cron/janitors")).toBe("system");
      expect(resolveRouteAccess("/api/cron/task-coordinator")).toBe("system");
    });

    it("matches /api/mock prefix for public routes", () => {
      expect(resolveRouteAccess("/api/mock")).toBe("public");
      expect(resolveRouteAccess("/api/mock/auth")).toBe("public");
    });

    it("does not match partial prefix", () => {
      expect(resolveRouteAccess("/authentication")).not.toBe("public");
      expect(resolveRouteAccess("/api/authorize")).not.toBe("public");
    });
  });

  describe("Webhook Route Matching", () => {
    it("matches GitHub webhook route", () => {
      expect(resolveRouteAccess("/api/github/webhook")).toBe("webhook");
      expect(resolveRouteAccess("/api/github/webhook/events")).toBe("webhook");
    });

    it("matches Stakwork webhook route", () => {
      expect(resolveRouteAccess("/api/stakwork/webhook")).toBe("webhook");
      expect(resolveRouteAccess("/api/stakwork/webhook/process")).toBe("webhook");
    });

    it("matches janitors webhook route", () => {
      expect(resolveRouteAccess("/api/janitors/webhook")).toBe("webhook");
    });

    it("matches swarm stakgraph webhook route", () => {
      expect(resolveRouteAccess("/api/swarm/stakgraph/webhook")).toBe("webhook");
    });

    it("matches chat response webhook route", () => {
      expect(resolveRouteAccess("/api/chat/response")).toBe("webhook");
    });
  });

  describe("Pattern Route Matching", () => {
    it("matches task title webhook pattern", () => {
      expect(resolveRouteAccess("/api/tasks/task-123/title")).toBe("webhook");
      expect(resolveRouteAccess("/api/tasks/abc-def-456/title")).toBe("webhook");
      expect(resolveRouteAccess("/api/tasks/123/title")).toBe("webhook");
    });

    it("does not match task pattern with different endpoint", () => {
      expect(resolveRouteAccess("/api/tasks/123/status")).not.toBe("webhook");
      expect(resolveRouteAccess("/api/tasks/123/description")).not.toBe("webhook");
    });

    it("does not match task pattern with nested paths", () => {
      expect(resolveRouteAccess("/api/tasks/123/nested/title")).not.toBe("webhook");
    });

    it("does not match task pattern without ID segment", () => {
      expect(resolveRouteAccess("/api/tasks/title")).not.toBe("webhook");
    });
  });

  describe("Protected Routes (Default)", () => {
    it("protects workspace routes by default", () => {
      expect(resolveRouteAccess("/w/my-workspace")).toBe("protected");
      expect(resolveRouteAccess("/w/my-workspace/tasks")).toBe("protected");
      expect(resolveRouteAccess("/w/my-workspace/recommendations")).toBe("protected");
    });

    it("protects dashboard routes by default", () => {
      expect(resolveRouteAccess("/dashboard")).toBe("protected");
      expect(resolveRouteAccess("/dashboard/settings")).toBe("protected");
    });

    it("protects API routes by default", () => {
      expect(resolveRouteAccess("/api/tasks")).toBe("protected");
      expect(resolveRouteAccess("/api/users/me")).toBe("protected");
    });

    it("protects settings routes by default", () => {
      expect(resolveRouteAccess("/settings")).toBe("protected");
      expect(resolveRouteAccess("/settings/profile")).toBe("protected");
    });
  });

  describe("Trailing Slash Handling", () => {
    it("handles trailing slashes consistently for prefix routes", () => {
      expect(resolveRouteAccess("/auth/")).toBe("public");
      expect(resolveRouteAccess("/api/cron/")).toBe("system");
      expect(resolveRouteAccess("/api/github/webhook/")).toBe("webhook");
    });

    it("handles trailing slashes for protected routes", () => {
      expect(resolveRouteAccess("/dashboard/")).toBe("protected");
      expect(resolveRouteAccess("/w/my-workspace/")).toBe("protected");
    });
  });

  describe("Case Sensitivity", () => {
    it("is case-sensitive for route matching", () => {
      expect(resolveRouteAccess("/Auth")).not.toBe("public");
      expect(resolveRouteAccess("/API/AUTH")).not.toBe("public");
      expect(resolveRouteAccess("/ONBOARDING")).not.toBe("public");
    });
  });

  describe("Policy Priority", () => {
    it("matches first applicable policy", () => {
      // /api/auth should match public before protected
      expect(resolveRouteAccess("/api/auth/session")).toBe("public");
      
      // /api/github/webhook should match webhook
      expect(resolveRouteAccess("/api/github/webhook")).toBe("webhook");
    });

    it("applies more specific patterns over general ones", () => {
      // /api/tasks/*/title is webhook pattern
      expect(resolveRouteAccess("/api/tasks/123/title")).toBe("webhook");
      
      // /api/tasks without pattern is protected
      expect(resolveRouteAccess("/api/tasks")).toBe("protected");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty path segments", () => {
      expect(resolveRouteAccess("/api//tasks")).toBe("protected");
    });

    it("handles paths with special characters", () => {
      expect(resolveRouteAccess("/api/tasks?query=test")).toBe("protected");
      expect(resolveRouteAccess("/api/tasks#section")).toBe("protected");
    });

    it("handles very long paths", () => {
      const longPath = "/api/" + "segment/".repeat(50) + "endpoint";
      expect(resolveRouteAccess(longPath)).toBe("protected");
    });

    it("handles paths with encoded characters", () => {
      expect(resolveRouteAccess("/api/tasks/%20space")).toBe("protected");
      expect(resolveRouteAccess("/api/tasks/test%2Fslash")).toBe("protected");
    });
  });

  describe("ROUTE_POLICIES Validation", () => {
    it("has valid route policies defined", () => {
      expect(ROUTE_POLICIES).toBeDefined();
      expect(ROUTE_POLICIES.length).toBeGreaterThan(0);
    });

    it("all policies have required fields", () => {
      for (const policy of ROUTE_POLICIES) {
        expect(policy).toHaveProperty("path");
        expect(policy).toHaveProperty("strategy");
        expect(policy).toHaveProperty("access");
        
        expect(typeof policy.path).toBe("string");
        expect(["exact", "prefix", "pattern"]).toContain(policy.strategy);
        expect(["public", "webhook", "system", "superadmin"]).toContain(policy.access);
      }
    });

    it("has no duplicate paths with same strategy", () => {
      const seen = new Set<string>();
      
      for (const policy of ROUTE_POLICIES) {
        const key = `${policy.path}:${policy.strategy}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe("Real-World Route Examples", () => {
    it("correctly classifies authentication flows", () => {
      expect(resolveRouteAccess("/auth/signin")).toBe("public");
      expect(resolveRouteAccess("/api/auth/callback/github")).toBe("public");
      expect(resolveRouteAccess("/api/auth/session")).toBe("public");
      expect(resolveRouteAccess("/api/auth/verify-landing")).toBe("public");
    });

    it("correctly classifies workspace routes", () => {
      expect(resolveRouteAccess("/w/stakwork/tasks")).toBe("protected");
      expect(resolveRouteAccess("/w/stakwork/recommendations")).toBe("protected");
      expect(resolveRouteAccess("/w/stakwork/settings")).toBe("protected");
    });

    it("correctly classifies webhook endpoints", () => {
      expect(resolveRouteAccess("/api/github/webhook")).toBe("webhook");
      expect(resolveRouteAccess("/api/stakwork/webhook")).toBe("webhook");
      expect(resolveRouteAccess("/api/janitors/webhook")).toBe("webhook");
      expect(resolveRouteAccess("/api/tasks/task-123/title")).toBe("webhook");
    });

    it("correctly classifies system cron jobs", () => {
      expect(resolveRouteAccess("/api/cron/janitors")).toBe("system");
      expect(resolveRouteAccess("/api/cron/task-coordinator")).toBe("system");
    });

    it("correctly classifies protected API routes", () => {
      expect(resolveRouteAccess("/api/tasks")).toBe("protected");
      expect(resolveRouteAccess("/api/users/me")).toBe("protected");
      expect(resolveRouteAccess("/api/github/repos")).toBe("protected");
    });
  });
});

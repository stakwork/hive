import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// Mock NextAuth JWT
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

// Mock environment with CORS enabled
vi.mock("@/lib/env", () => ({
  optionalEnvVars: {
    ENABLE_CORS: true,
    TRUSTED_DOMAINS: "https://app.example.com,https://dashboard.example.com",
  },
}));

// Mock landing cookie utilities
vi.mock("@/lib/auth/landing-cookie", () => ({
  verifyCookie: vi.fn(),
  isLandingPageEnabled: vi.fn(() => false),
  LANDING_COOKIE_NAME: "landing-verified",
}));

describe("Middleware CORS Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("OPTIONS Preflight Requests", () => {
    it("should handle OPTIONS preflight for trusted origin", async () => {
      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
        },
      });

      const response = await middleware(request);

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com"
      );
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
        "Content-Type"
      );
      expect(response.headers.get("x-middleware-request-id")).toBeTruthy();
    });

    it("should reject OPTIONS preflight for untrusted origin", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue(null);

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.com",
        },
      });

      const response = await middleware(request);

      // Should not return 204, should fall through to auth checks
      expect(response.status).not.toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should not apply CORS to webhook OPTIONS requests", async () => {
      const request = new NextRequest(
        "https://api.example.com/api/github/webhook",
        {
          method: "OPTIONS",
          headers: {
            origin: "https://app.example.com",
          },
        }
      );

      const response = await middleware(request);

      // Webhook routes bypass CORS, should not get 204 preflight response
      expect(response.status).not.toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("Actual Request CORS Headers", () => {
    it("should add CORS headers to authenticated API requests", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "GET",
        headers: {
          origin: "https://app.example.com",
          cookie: "next-auth.session-token=valid-token",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com"
      );
      expect(response.headers.get("x-middleware-auth-status")).toBe("authenticated");
    });

    it("should not add CORS headers for untrusted origins", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "GET",
        headers: {
          origin: "https://evil.com",
          cookie: "next-auth.session-token=valid-token",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("x-middleware-auth-status")).toBe("authenticated");
    });

    it("should not add CORS headers to webhook routes", async () => {
      const request = new NextRequest(
        "https://api.example.com/api/github/webhook",
        {
          method: "POST",
          headers: {
            origin: "https://app.example.com",
            "x-hub-signature-256": "sha256=test",
          },
        }
      );

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("x-middleware-auth-status")).toBe("webhook");
    });

    it("should add CORS headers to public routes for trusted origins", async () => {
      const request = new NextRequest("https://api.example.com/onboarding", {
        method: "GET",
        headers: {
          origin: "https://app.example.com",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com"
      );
      expect(response.headers.get("x-middleware-auth-status")).toBe("public");
    });

    it("should handle missing origin header gracefully", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "GET",
        headers: {
          cookie: "next-auth.session-token=valid-token",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("x-middleware-auth-status")).toBe("authenticated");
    });
  });

  describe("CORS with Multiple Trusted Domains", () => {
    it("should allow first trusted domain", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "GET",
        headers: {
          origin: "https://app.example.com",
          cookie: "next-auth.session-token=valid-token",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com"
      );
    });

    it("should allow second trusted domain", async () => {
      const { getToken } = await import("next-auth/jwt");
      vi.mocked(getToken).mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });

      const request = new NextRequest("https://api.example.com/api/workspaces", {
        method: "GET",
        headers: {
          origin: "https://dashboard.example.com",
          cookie: "next-auth.session-token=valid-token",
        },
      });

      const response = await middleware(request);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://dashboard.example.com"
      );
    });
  });

  // Note: CORS disabled behavior is thoroughly tested in unit tests (cors-utils.test.ts)
  // Integration tests focus on the actual middleware flow with CORS enabled
});
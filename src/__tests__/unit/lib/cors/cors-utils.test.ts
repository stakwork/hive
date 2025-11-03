import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getTrustedDomains,
  isCorsEnabled,
  isOriginTrusted,
  generateCorsHeaders,
  getCorsHeaders,
  shouldApplyCors,
  getDefaultCorsConfig,
} from "@/lib/cors";

// Mock environment variables
vi.mock("@/lib/env", () => ({
  optionalEnvVars: {
    TRUSTED_DOMAINS: "",
    ENABLE_CORS: false,
  },
}));

describe("CORS Utilities", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetModules();
  });

  describe("getTrustedDomains", () => {
    it("should return empty array when TRUSTED_DOMAINS is not set", () => {
      const domains = getTrustedDomains();
      expect(domains).toEqual([]);
    });

    it("should return empty array when TRUSTED_DOMAINS is empty string", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS = "";
      
      const domains = getTrustedDomains();
      expect(domains).toEqual([]);
    });

    it("should parse comma-separated trusted domains", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://app.example.com,https://dashboard.example.com";

      const domains = getTrustedDomains();
      expect(domains).toEqual([
        "https://app.example.com",
        "https://dashboard.example.com",
      ]);
    });

    it("should trim whitespace from domains", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        " https://app.example.com , https://dashboard.example.com ";

      const domains = getTrustedDomains();
      expect(domains).toEqual([
        "https://app.example.com",
        "https://dashboard.example.com",
      ]);
    });

    it("should filter out invalid domain formats", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://valid.com,invalid-domain,https://also-valid.com";

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const domains = getTrustedDomains();
      expect(domains).toEqual(["https://valid.com", "https://also-valid.com"]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[CORS] Invalid trusted domain format: invalid-domain"
      );

      consoleWarnSpy.mockRestore();
    });

    it("should handle domains with ports", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://localhost:3000,http://localhost:8080";

      const domains = getTrustedDomains();
      expect(domains).toEqual([
        "https://localhost:3000",
        "http://localhost:8080",
      ]);
    });
  });

  describe("isCorsEnabled", () => {
    it("should return false when ENABLE_CORS is not set", () => {
      expect(isCorsEnabled()).toBe(false);
    });

    it("should return false when ENABLE_CORS is false", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = false;

      expect(isCorsEnabled()).toBe(false);
    });

    it("should return true when ENABLE_CORS is true", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = true;

      expect(isCorsEnabled()).toBe(true);
    });
  });

  describe("isOriginTrusted", () => {
    const trustedDomains = [
      "https://app.example.com",
      "https://dashboard.example.com",
    ];

    it("should return false for null origin", () => {
      expect(isOriginTrusted(null, trustedDomains)).toBe(false);
    });

    it("should return true for exact match", () => {
      expect(isOriginTrusted("https://app.example.com", trustedDomains)).toBe(
        true
      );
    });

    it("should return false for non-matching origin", () => {
      expect(isOriginTrusted("https://evil.com", trustedDomains)).toBe(false);
    });

    it("should normalize trailing slashes", () => {
      expect(isOriginTrusted("https://app.example.com/", trustedDomains)).toBe(
        true
      );
    });

    it("should be case-sensitive", () => {
      expect(isOriginTrusted("https://APP.example.com", trustedDomains)).toBe(
        false
      );
    });

    it("should not match subdomains", () => {
      expect(
        isOriginTrusted("https://sub.app.example.com", trustedDomains)
      ).toBe(false);
    });

    it("should not match path variations", () => {
      expect(
        isOriginTrusted("https://app.example.com/admin", trustedDomains)
      ).toBe(false);
    });
  });

  describe("generateCorsHeaders", () => {
    it("should generate standard CORS headers", () => {
      const headers = generateCorsHeaders("https://app.example.com");

      expect(headers).toEqual({
        "Access-Control-Allow-Origin": "https://app.example.com",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
        "Access-Control-Allow-Credentials": "true",
      });
    });

    it("should use custom config when provided", () => {
      const customConfig = {
        allowedOrigins: [],
        allowedMethods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"],
        maxAge: 3600,
        credentials: false,
      };

      const headers = generateCorsHeaders(
        "https://app.example.com",
        customConfig
      );

      expect(headers).toEqual({
        "Access-Control-Allow-Origin": "https://app.example.com",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
      });
    });

    it("should include credentials header when enabled", () => {
      const config = {
        allowedOrigins: [],
        allowedMethods: ["GET"],
        allowedHeaders: ["Content-Type"],
        maxAge: 3600,
        credentials: true,
      };

      const headers = generateCorsHeaders("https://app.example.com", config);

      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });
  });

  describe("getCorsHeaders", () => {
    it("should return null when CORS is disabled", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = false;

      const headers = getCorsHeaders("https://app.example.com");
      expect(headers).toBeNull();
    });

    it("should return null when TRUSTED_DOMAINS is not configured", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = true;
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS = "";

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const headers = getCorsHeaders("https://app.example.com");
      expect(headers).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[CORS] ENABLE_CORS is true but TRUSTED_DOMAINS is not configured"
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return null for untrusted origin", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = true;
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://app.example.com";

      const headers = getCorsHeaders("https://evil.com");
      expect(headers).toBeNull();
    });

    it("should return null for null origin", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = true;
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://app.example.com";

      const headers = getCorsHeaders(null);
      expect(headers).toBeNull();
    });

    it("should return headers for trusted origin", async () => {
      const { optionalEnvVars } = await import("@/lib/env");
      (optionalEnvVars as { ENABLE_CORS: boolean }).ENABLE_CORS = true;
      (optionalEnvVars as { TRUSTED_DOMAINS: string }).TRUSTED_DOMAINS =
        "https://app.example.com,https://dashboard.example.com";

      const headers = getCorsHeaders("https://app.example.com");
      expect(headers).not.toBeNull();
      expect(headers!["Access-Control-Allow-Origin"]).toBe(
        "https://app.example.com"
      );
    });
  });

  describe("shouldApplyCors", () => {
    it("should return true for standard API routes", () => {
      expect(shouldApplyCors("/api/workspaces")).toBe(true);
      expect(shouldApplyCors("/api/tasks/123")).toBe(true);
      expect(shouldApplyCors("/api/users/profile")).toBe(true);
    });

    it("should return false for GitHub webhook route", () => {
      expect(shouldApplyCors("/api/github/webhook")).toBe(false);
      expect(shouldApplyCors("/api/github/webhook/events")).toBe(false);
    });

    it("should return false for Stakwork webhook route", () => {
      expect(shouldApplyCors("/api/stakwork/webhook")).toBe(false);
      expect(shouldApplyCors("/api/stakwork/webhook/callback")).toBe(false);
    });

    it("should return false for all webhook routes", () => {
      expect(shouldApplyCors("/api/webhook/stakwork/response")).toBe(false);
      expect(shouldApplyCors("/api/janitors/webhook")).toBe(false);
      expect(shouldApplyCors("/api/swarm/stakgraph/webhook")).toBe(false);
      expect(shouldApplyCors("/api/chat/response")).toBe(false);
    });

    it("should return true for non-webhook routes starting with webhook prefix", () => {
      // This route doesn't match any webhook prefix exactly
      expect(shouldApplyCors("/api/webhooks/list")).toBe(true);
    });

    it("should return true for page routes", () => {
      expect(shouldApplyCors("/")).toBe(true);
      expect(shouldApplyCors("/dashboard")).toBe(true);
      expect(shouldApplyCors("/w/workspace-slug/tasks")).toBe(true);
    });
  });

  describe("getDefaultCorsConfig", () => {
    it("should return default CORS configuration", () => {
      const config = getDefaultCorsConfig();

      expect(config).toEqual({
        allowedOrigins: [],
        allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        maxAge: 86400,
        credentials: true,
      });
    });

    it("should return a new object (not reference to original)", () => {
      const config1 = getDefaultCorsConfig();
      const config2 = getDefaultCorsConfig();

      expect(config1).not.toBe(config2);
      config1.maxAge = 9999;
      expect(config2.maxAge).toBe(86400);
    });
  });
});
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPublicBaseUrl, getGithubWebhookCallbackUrl, getStakgraphWebhookCallbackUrl } from "@/lib/url";

describe("URL Utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables to clean state
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    delete process.env.GITHUB_WEBHOOK_URL;
    delete process.env.STAKGRAPH_WEBHOOK_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getPublicBaseUrl", () => {
    test("should return NEXT_PUBLIC_APP_URL when set, removing trailing slash", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com/";

      const result = getPublicBaseUrl();

      expect(result).toBe("https://example.com");
    });

    test("should return NEXT_PUBLIC_APP_URL when set without trailing slash", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

      const result = getPublicBaseUrl();

      expect(result).toBe("https://example.com");
    });

    test("should fallback to VERCEL_URL when NEXT_PUBLIC_APP_URL not set", () => {
      process.env.VERCEL_URL = "example.vercel.app";

      const result = getPublicBaseUrl();

      expect(result).toBe("https://example.vercel.app");
    });

    test("should remove trailing slash from VERCEL_URL", () => {
      process.env.VERCEL_URL = "example.vercel.app/";

      const result = getPublicBaseUrl();

      expect(result).toBe("https://example.vercel.app");
    });

    test("should construct URL from request headers when no env vars set", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://api.example.com");
    });

    test("should use x-forwarded-host header when present", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "proxy.example.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://proxy.example.com");
    });

    test("should use x-forwarded-proto header for protocol", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://api.example.com");
    });

    test("should default to http for localhost when no x-forwarded-proto", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "localhost:3000",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("http://localhost:3000");
    });

    test("should default to https for non-localhost when no x-forwarded-proto", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://api.example.com");
    });

    test("should fallback to localhost:3000 when no request and no env vars", () => {
      const result = getPublicBaseUrl();

      expect(result).toBe("http://localhost:3000");
    });

    test("should handle request with no headers", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test");

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("http://localhost:3000");
    });

    test("should handle request with empty headers", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {},
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("http://localhost:3000");
    });

    test("should handle localhost variants correctly", () => {
      const testCases = [
        { host: "localhost", expected: "http://localhost" },
        { host: "localhost:3000", expected: "http://localhost:3000" },
        { host: "localhost:8080", expected: "http://localhost:8080" },
        { host: "127.0.0.1:3000", expected: "https://127.0.0.1:3000" },
      ];

      testCases.forEach(({ host, expected }) => {
        const mockRequest = new NextRequest("http://localhost:3000/test", {
          headers: { host: host },
        });

        const result = getPublicBaseUrl(mockRequest);

        expect(result).toBe(expected);
      });
    });

    test("should remove trailing slash from constructed URL", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com/",
          "x-forwarded-proto": "https",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://api.example.com");
    });

    test("should prioritize NEXT_PUBLIC_APP_URL over VERCEL_URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://explicit.com";
      process.env.VERCEL_URL = "vercel-fallback.app";

      const result = getPublicBaseUrl();

      expect(result).toBe("https://explicit.com");
    });

    test("should prioritize env vars over request when both present", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://env.com";

      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "request.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://env.com");
    });
  });

  describe("getGithubWebhookCallbackUrl", () => {
    test("should return GITHUB_WEBHOOK_URL when set", () => {
      process.env.GITHUB_WEBHOOK_URL = "https://custom-webhook.example.com/github";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("https://custom-webhook.example.com/github");
    });

    test("should construct from getPublicBaseUrl when GITHUB_WEBHOOK_URL not set", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://myapp.com";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("https://myapp.com/api/github/webhook");
    });

    test("should pass request to getPublicBaseUrl when constructing URL", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getGithubWebhookCallbackUrl(mockRequest);

      expect(result).toBe("https://api.example.com/api/github/webhook");
    });

    test("should prioritize GITHUB_WEBHOOK_URL over constructed URL", () => {
      process.env.GITHUB_WEBHOOK_URL = "https://webhook.custom.com/gh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("https://webhook.custom.com/gh");
    });

    test("should handle VERCEL_URL fallback when constructing", () => {
      process.env.VERCEL_URL = "my-app.vercel.app";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("https://my-app.vercel.app/api/github/webhook");
    });

    test("should handle localhost fallback when constructing", () => {
      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("http://localhost:3000/api/github/webhook");
    });

    test("should handle empty GITHUB_WEBHOOK_URL", () => {
      process.env.GITHUB_WEBHOOK_URL = "";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("https://app.com/api/github/webhook");
    });

    test("should handle whitespace-only GITHUB_WEBHOOK_URL", () => {
      process.env.GITHUB_WEBHOOK_URL = "   ";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getGithubWebhookCallbackUrl();

      expect(result).toBe("   ");
    });
  });

  describe("getStakgraphWebhookCallbackUrl", () => {
    test("should return STAKGRAPH_WEBHOOK_URL when set", () => {
      process.env.STAKGRAPH_WEBHOOK_URL = "https://custom-webhook.example.com/stakgraph";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("https://custom-webhook.example.com/stakgraph");
    });

    test("should construct from getPublicBaseUrl when STAKGRAPH_WEBHOOK_URL not set", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://myapp.com";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("https://myapp.com/api/swarm/stakgraph/webhook");
    });

    test("should pass request to getPublicBaseUrl when constructing URL", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.example.com",
          "x-forwarded-proto": "https",
        },
      });

      const result = getStakgraphWebhookCallbackUrl(mockRequest);

      expect(result).toBe("https://api.example.com/api/swarm/stakgraph/webhook");
    });

    test("should prioritize STAKGRAPH_WEBHOOK_URL over constructed URL", () => {
      process.env.STAKGRAPH_WEBHOOK_URL = "https://webhook.custom.com/stakgraph";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("https://webhook.custom.com/stakgraph");
    });

    test("should handle VERCEL_URL fallback when constructing", () => {
      process.env.VERCEL_URL = "my-app.vercel.app";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("https://my-app.vercel.app/api/swarm/stakgraph/webhook");
    });

    test("should handle localhost fallback when constructing", () => {
      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("http://localhost:3000/api/swarm/stakgraph/webhook");
    });

    test("should handle empty STAKGRAPH_WEBHOOK_URL", () => {
      process.env.STAKGRAPH_WEBHOOK_URL = "";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("https://app.com/api/swarm/stakgraph/webhook");
    });

    test("should handle whitespace-only STAKGRAPH_WEBHOOK_URL", () => {
      process.env.STAKGRAPH_WEBHOOK_URL = "   ";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.com";

      const result = getStakgraphWebhookCallbackUrl();

      expect(result).toBe("   ");
    });
  });

  describe("Edge cases and integration", () => {
    test("all functions should work without any environment variables", () => {
      expect(getPublicBaseUrl()).toBe("http://localhost:3000");
      expect(getGithubWebhookCallbackUrl()).toBe("http://localhost:3000/api/github/webhook");
      expect(getStakgraphWebhookCallbackUrl()).toBe("http://localhost:3000/api/swarm/stakgraph/webhook");
    });

    test("all functions should work with complete environment setup", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://production.app.com";
      process.env.GITHUB_WEBHOOK_URL = "https://github.webhook.com/callback";
      process.env.STAKGRAPH_WEBHOOK_URL = "https://stakgraph.webhook.com/callback";

      expect(getPublicBaseUrl()).toBe("https://production.app.com");
      expect(getGithubWebhookCallbackUrl()).toBe("https://github.webhook.com/callback");
      expect(getStakgraphWebhookCallbackUrl()).toBe("https://stakgraph.webhook.com/callback");
    });

    test("webhook functions should use same base URL when no specific webhook URLs set", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://shared-base.com/";

      const baseUrl = getPublicBaseUrl();
      const githubUrl = getGithubWebhookCallbackUrl();
      const stakgraphUrl = getStakgraphWebhookCallbackUrl();

      expect(baseUrl).toBe("https://shared-base.com");
      expect(githubUrl).toBe("https://shared-base.com/api/github/webhook");
      expect(stakgraphUrl).toBe("https://shared-base.com/api/swarm/stakgraph/webhook");
    });

    test("should handle complex real-world request headers", () => {
      const mockRequest = new NextRequest("http://localhost:3000/test", {
        headers: {
          host: "api.production.com:443",
          "x-forwarded-host": "load-balancer.internal:8080",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.1, 198.51.100.1",
          "user-agent": "GitHub-Hookshot/abc123",
        },
      });

      const result = getPublicBaseUrl(mockRequest);

      expect(result).toBe("https://load-balancer.internal:8080");
    });

    test("should handle URL construction with ports", () => {
      const testCases = [
        {
          env: { NEXT_PUBLIC_APP_URL: "https://app.com:8443" },
          expected: {
            base: "https://app.com:8443",
            github: "https://app.com:8443/api/github/webhook",
            stakgraph: "https://app.com:8443/api/swarm/stakgraph/webhook",
          },
        },
        {
          env: { VERCEL_URL: "preview-branch.vercel.app" },
          expected: {
            base: "https://preview-branch.vercel.app",
            github: "https://preview-branch.vercel.app/api/github/webhook",
            stakgraph: "https://preview-branch.vercel.app/api/swarm/stakgraph/webhook",
          },
        },
      ];

      testCases.forEach(({ env, expected }, index) => {
        // Reset environment
        process.env = { ...originalEnv };
        Object.keys(env).forEach((key) => {
          process.env[key] = env[key];
        });

        expect(getPublicBaseUrl(), `Test case ${index + 1} base URL`).toBe(expected.base);
        expect(getGithubWebhookCallbackUrl(), `Test case ${index + 1} GitHub URL`).toBe(expected.github);
        expect(getStakgraphWebhookCallbackUrl(), `Test case ${index + 1} Stakgraph URL`).toBe(expected.stakgraph);
      });
    });
  });
});

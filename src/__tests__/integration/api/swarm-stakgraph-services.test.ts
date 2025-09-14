import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/swarm/stakgraph/services/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
  authOptions: {},
}));

describe("GET /api/swarm/stakgraph/services", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_abc";
  let workspaceId: string;
  let swarmId: string;
  let userId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Don't manually clean - let the global cleanup handle it
    // Use transaction to atomically create test data
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "User 1",
        },
      });
      
      const workspace = await tx.workspace.create({
        data: {
          name: "w1",
          slug: `w1-${Date.now()}-${Math.random()}`,
          ownerId: user.id,
        },
      });
      
      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "s1-name",
          swarmId: `s1-${Date.now()}`,
          status: "ACTIVE",
          swarmUrl: "https://s1-name.sphinx.chat/api",
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
          ),
          services: [],
        },
      });
      
      return { user, workspace, swarm };
    });
    
    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.swarmId!;
    userId = testData.user.id;
    
    (
      getServerSession as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({
      user: { id: userId },
    });

    // Mock GitHub profile by default
    (getGithubUsernameAndPAT as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({
        username: "testuser",
        pat: "ghp_test_token_123",
      });
  });

  describe("Authentication and Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue(null);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(401);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Unauthorized");
    });

    it("returns 401 when session exists but user ID is missing", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: {} });

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(401);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Unauthorized");
    });

    it("proxies with decrypted header and keeps DB encrypted", async () => {
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      const responseBody = await res.json();
      console.log("Swarm API Response status:", res.status);
      console.log("Swarm API Response body:", JSON.stringify(responseBody, null, 2));

      expect(res.status).toBe(200);
      // Verify header used decrypted token
      const firstCall = fetchSpy.mock.calls[0] as [
        string,
        { headers?: Record<string, string> },
      ];
      const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
      expect(Object.values(headers).join(" ")).toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify DB is still encrypted (no plaintext present)
      const swarm = await db.swarm.findFirst({ where: { swarmId } });
      const stored = swarm?.swarmApiKey || "";
      expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
    });

    it("includes GitHub credentials in authentication proxy when available", async () => {
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      
      // Verify GitHub credentials were included in the API call
      const firstCall = fetchSpy.mock.calls[0] as [string, unknown];
      const apiUrl = firstCall[0];
      expect(apiUrl).toContain("username=testuser");
      expect(apiUrl).toContain("pat=ghp_test_token_123");
    });
  });

  describe("Parameter Validation", () => {
    it("returns 400 when workspaceId is missing", async () => {
      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(400);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Missing required fields: workspaceId or swarmId");
    });

    it("returns 400 when swarmId is missing", async () => {
      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(400);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Missing required fields: workspaceId or swarmId");
    });

    it("returns 404 when swarm is not found", async () => {
      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=nonexistent-swarm`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(404);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm not found");
    });

    it("returns 400 when swarm URL is not set", async () => {
      // Create swarm without swarmUrl
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: `user-${Date.now()}-${Math.random()}`,
            email: `user-${Date.now()}@example.com`,
            name: "User 2",
          },
        });
        
        const workspace = await tx.workspace.create({
          data: {
            name: "w2",
            slug: `w2-${Date.now()}-${Math.random()}`,
            ownerId: user.id,
          },
        });
        
        const swarm = await tx.swarm.create({
          data: {
            workspaceId: workspace.id,
            name: "s2-name",
            swarmId: `s2-${Date.now()}`,
            status: "PENDING",
            swarmUrl: null,
            swarmApiKey: null,
            services: [],
          },
        });
        
        return { user, workspace, swarm };
      });

      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testData.user.id } });

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${testData.workspace.id}&swarmId=${testData.swarm.swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(400);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm URL or API key not set");
    });
  });

  describe("Service Fetching and Data Persistence", () => {
    it("successfully fetches services and persists data to workspace", async () => {
      const mockServices = [
        {
          name: "web-service",
          port: 3000,
          env: { NODE_ENV: "production" },
          scripts: { start: "npm start" },
        },
        {
          name: "api-service", 
          port: 8080,
          env: { API_ENV: "prod" },
          scripts: { start: "yarn start", build: "yarn build" },
        },
      ];

      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      const responseBody = await res.json();
      
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
      
      // Verify data was persisted to database
      const updatedSwarm = await db.swarm.findFirst({ where: { swarmId } });
      expect(updatedSwarm?.services).toEqual(mockServices);
      expect(updatedSwarm?.updatedAt).toBeDefined();
    });

    it("handles array response format and transforms to object format", async () => {
      const mockServicesArray = [
        { name: "service1", port: 3000, env: {}, scripts: { start: "start" } },
        { name: "service2", port: 4000, env: {}, scripts: { start: "start" } },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockServicesArray,
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      const responseBody = await res.json();
      
      // Verify array was wrapped in services object
      expect(responseBody.data.services).toEqual(mockServicesArray);
      expect(Array.isArray(responseBody.data.services)).toBe(true);
    });

    it("passes through clone and repo_url parameters to Stakgraph API", async () => {
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}&clone=true&repo_url=https://github.com/test/repo`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      
      // Verify parameters were passed through
      const firstCall = fetchSpy.mock.calls[0] as [string, unknown];
      const apiUrl = firstCall[0];
      expect(apiUrl).toContain("clone=true");
      expect(apiUrl).toContain("repo_url=https%3A%2F%2Fgithub.com%2Ftest%2Frepo");
    });

    it("works without GitHub credentials when not available", async () => {
      (getGithubUsernameAndPAT as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue(null);

      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      
      // Verify no GitHub credentials in URL
      const firstCall = fetchSpy.mock.calls[0] as [string, unknown];
      const apiUrl = firstCall[0];
      expect(apiUrl).not.toContain("username=");
      expect(apiUrl).not.toContain("pat=");
    });
  });

  describe("Error Handling from Stakgraph API", () => {
    it("handles 404 error from Stakgraph API", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ error: "Repository not found" }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(404);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.status).toBe(404);
    });

    it("handles 500 error from Stakgraph API", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal server error" }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(500);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.status).toBe(500);
    });

    it("handles network errors and fetch failures", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockRejectedValue(new Error("Network error"));

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      // Network errors in swarmApiRequest result in ok: false and status: 500 (from catch block)
      // This causes the route to return status 500 with success: false
      expect(res.status).toBe(500);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.status).toBe(500);
    });

    it("handles malformed JSON response from Stakgraph API", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => { throw new Error("Invalid JSON"); },
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      // With JSON parse error, the system logs it but continues with undefined data
      // The route handler will transform undefined to empty array
      expect(res.status).toBe(200);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual([]);
    });

    it("handles database errors during save operation", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [{ name: "test", port: 3000, env: {}, scripts: { start: "start" } }] }),
        } as unknown as Response);

      // Mock database error during save
      const originalUpdate = db.swarm.update;
      vi.spyOn(db.swarm, "update").mockRejectedValue(new Error("Database connection failed"));

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(500);
      const responseBody = await res.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Failed to ingest code");

      // Restore original method
      db.swarm.update = originalUpdate;
    });
  });

  describe("Swarm URL Construction", () => {
    it("constructs correct swarm API URL with vanity address", async () => {
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const search = new URL(
        `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
      );
      const res = await GET(new NextRequest(search.toString()));
      
      expect(res.status).toBe(200);
      
      // Verify correct URL was called (vanity address with port 3355)
      const firstCall = fetchSpy.mock.calls[0] as [string, unknown];
      const apiUrl = firstCall[0];
      expect(apiUrl).toContain("https://s1-name.sphinx.chat:3355/services");
    });
  });
});

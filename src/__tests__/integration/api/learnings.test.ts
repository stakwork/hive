import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "@/app/api/learnings/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  createPostRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";



describe("GET /api/learnings - Authorization", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Learnings Owner" },
        members: [
          { role: "VIEWER" },
          { role: "DEVELOPER" },
          { role: "ADMIN" },
        ],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];
      memberAdmin = scenario.members[2];

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-swarm-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });


  it("should return 401 for unauthenticated requests", async () => {
    const request = createGetRequest(`/api/learnings?workspace=${workspace.slug}`);
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 when workspace parameter is missing", async () => {
    const request = createAuthenticatedGetRequest("/api/learnings", owner);
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameter: workspace");
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      nonMember
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");
  });

  it("should return 403 for deleted workspace access", async () => {
    await db.workspace.update({
      where: { id: workspace.id },
      data: { deleted: true, deletedAt: new Date() },
    });

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");
  });

  it("should allow VIEWER role to access learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      memberViewer
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://test-swarm.sphinx.chat:3355/learnings"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-token": "test-swarm-api-key",
        }),
      })
    );

    fetchSpy.mockRestore();
  });

  it("should allow DEVELOPER role to access learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      memberDeveloper
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it("should allow ADMIN role to access learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      memberAdmin
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it("should allow OWNER role to access learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });
});

describe("POST /api/learnings - Seed Stories Endpoint", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "POST Learnings Owner" },
        members: [
          { role: "VIEWER" },
          { role: "DEVELOPER" },
          { role: "ADMIN" },
        ],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];
      memberAdmin = scenario.members[2];

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-post-learnings-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-post-learnings-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-post-learnings.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-post-learnings-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 for unauthenticated request", async () => {
      const request = createPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}
      );

      const response = await POST(request);

      expectUnauthorized(response);
    });

    it("should return 200 for authenticated request with valid data", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");

      fetchSpy.mockRestore();
    });
  });

  describe("Authorization", () => {
    it("should return 403 for non-member access", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, nonMember
      );

      const response = await POST(request);

      expectForbidden(response);
    });

    it("should return 403 for deleted workspace access", async () => {
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);

      expectForbidden(response);
    });

    it("should allow VIEWER role to seed stories", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, memberViewer
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");

      fetchSpy.mockRestore();
    });

    it("should allow DEVELOPER role to seed stories", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, memberDeveloper
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);

      fetchSpy.mockRestore();
    });

    it("should allow ADMIN role to seed stories", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, memberAdmin
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);

      fetchSpy.mockRestore();
    });

    it("should allow OWNER role to seed stories", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);

      fetchSpy.mockRestore();
    });
  });

  describe("Input Validation", () => {
    it("should return 400 for missing workspace parameter", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?budget=100`,
        {}, owner
      );

      const response = await POST(request);
      await expectError(response, "Missing required parameter: workspace", 400);
    });

    it("should return 400 for missing budget parameter", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}`,
        {}, owner
      );

      const response = await POST(request);
      await expectError(response, "Missing required parameter: budget", 400);
    });

    it("should return 400 for both missing parameters", async () => {
      const request = createAuthenticatedPostRequest(
        `/api/learnings`,
        {}, owner
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/Missing required parameter/);
    });

    it("should accept valid budget values", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const budgets = ["100", "500", "1000", "50"];

      for (const budget of budgets) {
        const request = createAuthenticatedPostRequest(
          `/api/learnings?workspace=${workspace.slug}&budget=${budget}`,
          {}, owner
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      }

      fetchSpy.mockRestore();
    });

    it("should encode budget value in URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const budget = "100";
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=${budget}`,
        {}, owner
      );

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://test-post-learnings.sphinx.chat:3355/seed_stories?budget=${encodeURIComponent(budget)}`,
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });
  });

  describe("Swarm Configuration", () => {
    it("should return 404 when workspace has no swarm", async () => {
      const newScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${newScenario.workspace.slug}&budget=100`,
        {},
        newScenario.owner
      );

      const response = await POST(request);

      expectNotFound(response);
    });

    it("should return 404 when swarm has no URL configured", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: null },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);

      expectNotFound(response);
    });

    it("should decrypt API key before making external request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      await POST(request);

      // Verify decrypted API key is used in headers
      const fetchCall = fetchSpy.mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["x-api-token"]).toBe("test-post-learnings-api-key");
      expect(headers["x-api-token"]).not.toContain("data");
      expect(headers["x-api-token"]).not.toContain("iv");

      fetchSpy.mockRestore();
    });
  });

  describe("Fire-and-Forget Behavior", () => {
    it("should return immediate 200 response without waiting for external completion", async () => {
      // Mock delayed external response
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ success: true }), { status: 200 })
            );
          }, 5000)
        )
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const startTime = Date.now();
      const response = await POST(request);
      const endTime = Date.now();
      const elapsed = endTime - startTime;

      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");
      // Should return immediately, not wait 5 seconds
      expect(elapsed).toBeLessThan(1000);

      fetchSpy.mockRestore();
    });

    it("should construct correct external URL with budget parameter", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const budget = "250";
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=${budget}`,
        {}, owner
      );

      await POST(request);

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://test-post-learnings.sphinx.chat:3355/seed_stories?budget=${budget}`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-token": "test-post-learnings-api-key",
          }),
        })
      );

      fetchSpy.mockRestore();
    });

    it("should include Content-Type and x-api-token headers in external request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      await POST(request);

      const fetchCall = fetchSpy.mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;

      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["x-api-token"]).toBe("test-post-learnings-api-key");

      fetchSpy.mockRestore();
    });

    it("should return 200 when external API fails (fire-and-forget)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
        })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Should still return success even though external API failed
      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");

      fetchSpy.mockRestore();
    });

    it("should return 200 when external API throws network error (fire-and-forget)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network error: Connection timeout"));

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Should still return success even with network error
      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");

      fetchSpy.mockRestore();
    });

    it("should use port 3355 in external swarm URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      await POST(request);

      const fetchUrl = fetchSpy.mock.calls[0][0] as string;
      expect(fetchUrl).toMatch(/^https:\/\/test-post-learnings\.sphinx\.chat:3355\/seed_stories\?budget=100$/);

      fetchSpy.mockRestore();
    });

    it("should handle localhost swarm URL correctly", async () => {
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmUrl: "http://localhost:3000" },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      await POST(request);

      const fetchUrl = fetchSpy.mock.calls[0][0] as string;
      expect(fetchUrl).toMatch(/^http:\/\/localhost:3355\/seed_stories\?budget=100$/);

      fetchSpy.mockRestore();
    });
  });

  describe("Error Handling", () => {
    it("should return 403 for invalid workspace slug", async () => {
      // Force an error by using invalid workspace slug that causes access denied
      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=invalid-slug-that-does-not-exist&budget=100`,
        {}, owner
      );

      const response = await POST(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return 403 for deleted workspace", async () => {
      const deletedWorkspace = await createTestWorkspaceScenario({
        owner: { name: "Deleted Workspace Owner" },
      });

      await db.workspace.delete({ where: { id: deletedWorkspace.workspace.id } });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${deletedWorkspace.workspace.slug}&budget=100`,
        {}, deletedWorkspace.owner
      );

      const response = await POST(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return 200 even with invalid encrypted API key (fire-and-forget)", async () => {
      // Set invalid encrypted API key - decryption will return the raw string
      // The endpoint still returns 200 immediately because it's fire-and-forget
      await db.swarm.update({
        where: { id: swarm.id },
        data: { swarmApiKey: "invalid-encrypted-data" },
      });

      const request = createAuthenticatedPostRequest(
        `/api/learnings?workspace=${workspace.slug}&budget=100`,
        {}, owner
      );

      const response = await POST(request);

      // Fire-and-forget behavior: returns 200 even if decryption/external call fails
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Seed knowledge request initiated");
    });
  });
});

describe("GET /api/learnings - Data Integrity", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Data Integrity Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key-integrity"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `integrity-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://integrity-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });

    // No NextAuth mock needed; use authenticated request
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 404 when swarm is not configured", async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm Owner" },
    });

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${newScenario.workspace.slug}`,
      newScenario.owner
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm not found for this workspace");
  });

  it("should return 404 when swarmUrl is not configured", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmUrl: null },
    });

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm URL not configured");
  });

  it("should decrypt API key before making external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(200);

    // Verify decrypted API key is used in headers (not encrypted)
    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers["x-api-token"]).toBe("test-api-key-integrity");
    expect(headers["x-api-token"]).not.toContain("data");
    expect(headers["x-api-token"]).not.toContain("iv");

    fetchSpy.mockRestore();
  });

  it("should forward question parameter to external API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const testQuestion = "How do I implement authentication?";
    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}&question=${encodeURIComponent(testQuestion)}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(200);

    // Verify question parameter is forwarded
    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;
    expect(fetchUrl).toContain(
      `question=${encodeURIComponent(testQuestion)}`
    );

    fetchSpy.mockRestore();
  });

  it("should return valid Learnings response structure", async () => {
    const mockLearnings = {
      prompts: [
        "Prompt 1: Test authentication flow",
        "Prompt 2: Implement user roles",
      ],
      hints: [
        "Hint 1: Use NextAuth.js for authentication",
        "Hint 2: Implement role-based access control",
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockLearnings), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    // Verify response matches Learnings interface
    expect(data).toHaveProperty("prompts");
    expect(data).toHaveProperty("hints");
    expect(Array.isArray(data.prompts)).toBe(true);
    expect(Array.isArray(data.hints)).toBe(true);
    expect(data.prompts).toEqual(mockLearnings.prompts);
    expect(data.hints).toEqual(mockLearnings.hints);
  });

  it("should return 500 when external swarm server fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch learnings data");
  });

  it("should handle external API network errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error: Connection timeout")
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch learnings data");
  });

  it("should construct correct swarm URL with port 3355", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    await GET(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify URL format: https://{hostname}:3355/learnings
    expect(fetchUrl).toMatch(
      /^https:\/\/integrity-swarm\.sphinx\.chat:3355\/learnings/
    );

    fetchSpy.mockRestore();
  });

  it("should handle localhost swarm URL correctly", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmUrl: "http://localhost:3000" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ prompts: [], hints: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      owner
    );
    await GET(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify localhost uses http:// instead of https://
    expect(fetchUrl).toMatch(/^http:\/\/localhost:3355\/learnings/);

    fetchSpy.mockRestore();
  });
});

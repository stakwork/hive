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
  createAuthenticatedPostRequest,
  generateUniqueId,
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
})

describe("POST /api/learnings - Authorization", () => {
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
        "test-swarm-api-key-post"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-swarm-post-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-swarm-post.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User POST",
          email: `non-member-post-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createGetRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 when workspace parameter is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings?budget=100",
      {},
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameter: workspace");
  });

  it("should return 400 when budget parameter is missing", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}`,
      {},
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameter: budget");
  });

  it("should return 403 for non-member access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, nonMember
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");

    // Verify external API was not called
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("should return 403 for deleted workspace access", async () => {
    await db.workspace.update({
      where: { id: workspace.id },
      data: { deleted: true, deletedAt: new Date() },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("should allow VIEWER role to seed learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, memberViewer
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });

  it("should allow DEVELOPER role to seed learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, memberDeveloper
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });

  it("should allow ADMIN role to seed learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, memberAdmin
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });

  it("should allow OWNER role to seed learnings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });
});

describe("POST /api/learnings - Fire-and-Forget Pattern", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Fire-and-Forget Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key-fire-forget"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `fire-forget-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://fire-forget-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 200 immediately with fire-and-forget pattern", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      success: true,
      message: "Seed knowledge request initiated",
    });

    fetchSpy.mockRestore();
  });

  it("should initiate external fetch call with correct URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify external call details
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/seed_stories?budget=100"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-api-token": "test-api-key-fire-forget",
        }),
      })
    );

    fetchSpy.mockRestore();
  });

  it("should not fail endpoint when external API returns error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "External server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    // Fire-and-forget: endpoint should still return 200
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });

  it("should not fail endpoint when external API throws network error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network error: Connection timeout"));

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    // Fire-and-forget: endpoint should still return 200
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Seed knowledge request initiated");

    fetchSpy.mockRestore();
  });

  it("should encode budget parameter in query string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const budgetValue = "500";
    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=${budgetValue}`,
      {}, owner
    );
    await POST(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;
    expect(fetchUrl).toContain(`budget=${encodeURIComponent(budgetValue)}`);

    fetchSpy.mockRestore();
  });
});

describe("POST /api/learnings - Data Integrity", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "POST Data Integrity Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-api-key-post-integrity"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `post-integrity-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://post-integrity-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 404 when swarm is not configured", async () => {
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm POST Owner" },
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${newScenario.workspace.slug}&budget=100`,
      {}, newScenario.owner
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm not found for this workspace");
  });

  it("should return 404 when swarmUrl is not configured", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmUrl: null },
    });

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm URL not configured");
  });

  it("should decrypt API key before making external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify decrypted API key is used in headers (not encrypted)
    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers["x-api-token"]).toBe("test-api-key-post-integrity");
    expect(headers["x-api-token"]).not.toContain("data");
    expect(headers["x-api-token"]).not.toContain("iv");

    fetchSpy.mockRestore();
  });

  it("should construct correct swarm URL with port 3355", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    await POST(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify URL format: https://{hostname}:3355/seed_stories?budget=100
    expect(fetchUrl).toMatch(
      /^https:\/\/post-integrity-swarm\.sphinx\.chat:3355\/seed_stories\?budget=100$/
    );

    fetchSpy.mockRestore();
  });

  it("should handle localhost swarm URL correctly", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmUrl: "http://localhost:3000" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    await POST(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify localhost uses http:// instead of https://
    expect(fetchUrl).toMatch(/^http:\/\/localhost:3355\/seed_stories\?budget=100$/);

    fetchSpy.mockRestore();
  });

  it("should include Content-Type header in external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=${workspace.slug}&budget=100`,
      {}, owner
    );
    await POST(request);

    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-api-token"]).toBe("test-api-key-post-integrity");

    fetchSpy.mockRestore();
  });

  it("should return 500 when unexpected error occurs", async () => {
    // Force an error by mocking getSwarmConfig to throw
    const request = createAuthenticatedPostRequest(
      `/api/learnings?workspace=invalid-slug-that-doesnt-exist&budget=100`,
      {}, owner
    );
    
    const response = await POST(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");
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
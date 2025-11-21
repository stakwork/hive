import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/learnings/features/[id]/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { createTestWorkspaceScenario, createTestSwarm } from "@/__tests__/support/fixtures";
import { createGetRequest, createAuthenticatedGetRequest, generateUniqueId } from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

describe("GET /api/learnings/features/[id] - Authorization", () => {
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
        owner: { name: "Feature Learning Owner" },
        members: [{ role: "VIEWER" }, { role: "DEVELOPER" }, { role: "ADMIN" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];
      memberDeveloper = scenario.members[1];
      memberAdmin = scenario.members[2];

      // Create swarm with encrypted API key
      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField("swarmApiKey", "test-feature-swarm-api-key");

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-feature-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-feature-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // Create non-member user
      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-feature-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createGetRequest(`/api/learnings/features/feature-123?workspace=${workspace.slug}`);
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 when workspace parameter is missing", async () => {
    const request = createAuthenticatedGetRequest("/api/learnings/features/feature-123", owner);
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameter: workspace");
  });

  it("should return 400 when id parameter is missing", async () => {
    const request = createAuthenticatedGetRequest(`/api/learnings/features/?workspace=${workspace.slug}`, owner);
    // Simulate missing id by passing empty string
    const response = await GET(request, { params: Promise.resolve({ id: "" }) });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameter: id");
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      nonMember,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

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
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");
  });

  it("should allow VIEWER role to access feature data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      memberViewer,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://test-feature-swarm.sphinx.chat:3355/gitree/features/feature-123"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-token": "test-feature-swarm-api-key",
        }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it("should allow DEVELOPER role to access feature data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      memberDeveloper,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it("should allow ADMIN role to access feature data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      memberAdmin,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it("should allow OWNER role to access feature data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);
    fetchSpy.mockRestore();
  });
});

describe("GET /api/learnings/features/[id] - Data Integrity", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Feature Data Integrity Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField("swarmApiKey", "test-api-key-feature-integrity");

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `feature-integrity-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://feature-integrity-swarm.sphinx.chat",
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
      owner: { name: "No Swarm Feature Owner" },
    });

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${newScenario.workspace.slug}`,
      newScenario.owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

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
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Swarm URL not configured");
  });

  it("should decrypt API key before making external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);

    // Verify decrypted API key is used in headers (not encrypted)
    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers["x-api-token"]).toBe("test-api-key-feature-integrity");
    expect(headers["x-api-token"]).not.toContain("data");
    expect(headers["x-api-token"]).not.toContain("iv");

    fetchSpy.mockRestore();
  });

  it("should construct correct external URL with encoded id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const featureId = "feature-with-special-chars/123";
    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/${encodeURIComponent(featureId)}?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: featureId }) });

    expect(response.status).toBe(200);

    // Verify URL encoding
    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;
    expect(fetchUrl).toContain(`gitree/features/${encodeURIComponent(featureId)}`);

    fetchSpy.mockRestore();
  });

  it("should return valid feature response structure", async () => {
    const mockFeature = {
      id: "feature-123",
      name: "Authentication Feature",
      description: "User authentication and authorization",
      files: ["src/auth/login.ts", "src/auth/middleware.ts"],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockFeature), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();

    // Verify response structure
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("name");
    expect(data.id).toBe("feature-123");
    expect(data.name).toBe("Authentication Feature");
  });

  it("should return 500 when external swarm server fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch feature data");
  });

  it("should handle external API network errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error: Connection timeout"));

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    const response = await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch feature data");
  });

  it("should construct correct swarm URL with port 3355", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify URL format: https://{hostname}:3355/gitree/features/{id}
    expect(fetchUrl).toMatch(/^https:\/\/feature-integrity-swarm\.sphinx\.chat:3355\/gitree\/features\/feature-123$/);

    fetchSpy.mockRestore();
  });

  it("should handle localhost swarm URL correctly", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { swarmUrl: "http://localhost:3000" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    const fetchCall = fetchSpy.mock.calls[0];
    const fetchUrl = fetchCall[0] as string;

    // Verify localhost uses http:// instead of https://
    expect(fetchUrl).toMatch(/^http:\/\/localhost:3355\/gitree\/features\/feature-123$/);

    fetchSpy.mockRestore();
  });

  it("should include Content-Type header in external request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "feature-123", name: "Test Feature" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = createAuthenticatedGetRequest(
      `/api/learnings/features/feature-123?workspace=${workspace.slug}`,
      owner,
    );
    await GET(request, { params: Promise.resolve({ id: "feature-123" }) });

    const fetchCall = fetchSpy.mock.calls[0];
    const headers = fetchCall[1]?.headers as Record<string, string>;

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-api-token"]).toBe("test-api-key-feature-integrity");

    fetchSpy.mockRestore();
  });
});

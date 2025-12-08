import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tests/mocks/route";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { resetDatabase } from "@/__tests__/support/fixtures/database";

// Mock swarmApiRequest at module level
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

import { swarmApiRequest } from "@/services/swarm/api/swarm";

vi.mock("next-auth");

describe("GET /api/tests/mocks", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    
    // Initialize test user and workspace for tests that need them
    testUser = await createTestUser({ name: "Test User" });
    testWorkspace = await createTestWorkspace({
      name: "Test Workspace",
      ownerId: testUser.id,
    });
    
    // Create workspace membership for the test user
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
    
    // Mock authenticated session by default
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });
  });

  it("should return unauthorized when user is not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}`
      )
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Unauthorized");
  });

  it("should return 400 when workspaceId is missing", async () => {
    const request = new NextRequest(
      new URL("http://localhost:3000/api/tests/mocks")
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Workspace ID is required");
  });

  it("should return 403 when workspace does not exist or user lacks access", async () => {
    const request = new NextRequest(
      new URL(
        "http://localhost:3000/api/tests/mocks?workspaceId=non-existent-id"
      )
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Workspace not found or access denied");
  });

  it("should return 404 when workspace has no swarm configured", async () => {
    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}`
      )
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Swarm not found");
  });

  it("should fetch mock inventory from stakgraph successfully", async () => {
    const swarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    const mockInventoryResponse = {
      items: [
        {
          name: "github",
          ref_id: "github-123",
          description: "GitHub API integration",
          linked_files: ["file1.ts", "file2.ts"],
          file_count: 2,
          mocked: true,
        },
        {
          name: "stakwork",
          ref_id: "stakwork-456",
          description: "Stakwork API integration",
          linked_files: ["file3.ts"],
          file_count: 1,
          mocked: false,
        },
      ],
      total_count: 2,
      total_returned: 2,
    };

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: mockInventoryResponse,
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&limit=20&offset=0`
      )
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockInventoryResponse);
    expect(data.message).toBe("Mock inventory retrieved successfully");

    expect(swarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmUrl: "https://test-swarm.sphinx.chat:3355",
        endpoint: expect.stringContaining("/mocks/inventory"),
        method: "GET",
        apiKey: expect.any(String),
      })
    );
  });

  it("should support pagination with limit and offset", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: {
        items: [],
        total_count: 50,
        total_returned: 10,
      },
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&limit=10&offset=20`
      )
    );

    await GET(request);

    expect(swarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: expect.stringContaining("limit=10&offset=20"),
      })
    );
  });

  it("should support search filtering", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: {
        items: [],
        total_count: 0,
        total_returned: 0,
      },
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&search=github`
      )
    );

    await GET(request);

    expect(swarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: expect.stringContaining("search=github"),
      })
    );
  });

  it("should support mocked filter with 'mocked' value", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: {
        items: [],
        total_count: 0,
        total_returned: 0,
      },
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&mocked=mocked`
      )
    );

    await GET(request);

    expect(swarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: expect.stringContaining("mocked=true"),
      })
    );
  });

  it("should support mocked filter with 'unmocked' value", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: {
        items: [],
        total_count: 0,
        total_returned: 0,
      },
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&mocked=unmocked`
      )
    );

    await GET(request);

    expect(swarmApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: expect.stringContaining("mocked=false"),
      })
    );
  });

  it("should not add mocked filter when value is 'all'", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: true,
      data: {
        items: [],
        total_count: 0,
        total_returned: 0,
      },
      status: 200,
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}&mocked=all`
      )
    );

    await GET(request);

    const callArgs = vi.mocked(swarmApiRequest).mock.calls[0][0];
    expect(callArgs.endpoint).not.toContain("mocked=");
  });

  it("should handle errors from stakgraph service", async () => {
    await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmApiKey: JSON.stringify({
          data: "encrypted-key",
          iv: "iv",
          tag: "tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
        workspaceId: testWorkspace.id,
      },
    });

    vi.mocked(swarmApiRequest).mockResolvedValue({
      ok: false,
      status: 503,
      data: { error: "Service unavailable" },
    });

    const request = new NextRequest(
      new URL(
        `http://localhost:3000/api/tests/mocks?workspaceId=${testWorkspace.id}`
      )
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Failed to fetch mock inventory from stakgraph");
  });
});

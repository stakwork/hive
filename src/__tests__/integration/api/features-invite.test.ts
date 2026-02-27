import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/invite/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createSphinxEnabledWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { getServerSession } from "next-auth/next";
import { NextRequest } from "next/server";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock nextauth lib
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    SPHINX_API_URL: "http://localhost:3000/api/mock/sphinx/action",
  },
}));

// Mock fetch for Sphinx API calls
global.fetch = vi.fn();
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

// Helper to create authenticated POST request with session mock
const createAuthenticatedRequest = (
  url: string,
  user: { id: string; email: string; name: string | null },
  body: object
) => {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: user.id, email: user.email, name: user.name! },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
  
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("POST /api/features/[featureId]/invite Integration Tests", () => {
  EncryptionService.getInstance();

  beforeEach(() => {
    // Only clear fetch mock, not session mock
    mockFetch.mockClear();
    
    // Default: successful Sphinx API response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, messageId: "mock-msg-id" }),
      text: async () => JSON.stringify({ success: true, messageId: "mock-msg-id" }),
    } as Response);
  });

  afterEach(async () => {
    // Clean up test data
    await db.chatMessage.deleteMany({});
    await db.feature.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  test("returns 401 when unauthenticated", async () => {
    // Mock no session
    vi.mocked(getServerSession).mockResolvedValue(null);
    
    const featureId = generateUniqueId("feature");
    const request = new NextRequest("http://localhost:3000/api/features/test/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeUserId: "user-123" }),
    });

    const response = await POST(request, { params: Promise.resolve({ featureId }) });
    expect(response.status).toBe(401);
  });

  test("returns 400 when workspace Sphinx config is incomplete", async () => {
    // Create user and workspace without Sphinx config
    const user = await createTestUser({
      email: `test-${generateUniqueId()}@example.com`,
      name: "Test User",
    });

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: user.id, email: user.email, name: user.name! },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any);

    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: generateUniqueId("test-ws"),
        ownerId: user.id,
        sphinxEnabled: false, // Not enabled
      },
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const request = new NextRequest(`http://localhost:3000/api/features/${feature.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeUserId: user.id }),
    });

    const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("Sphinx integration is not fully configured");
  });

  test("returns 400 when invitee has no sphinxAlias", async () => {
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
    });

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name! },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any);

    const workspace = await createSphinxEnabledWorkspace({
      ownerId: owner.id,
      slug: generateUniqueId("sphinx-ws"),
    });

    const invitee = await createTestUser({
      email: `invitee-${generateUniqueId()}@example.com`,
      name: "Invitee User",
      // No sphinxAlias set
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const request = new NextRequest(`http://localhost:3000/api/features/${feature.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeUserId: invitee.id }),
    });

    const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toContain("does not have a Sphinx alias");
  });

  test("successfully sends invite when all conditions are met", async () => {
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
    });

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name! },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any);

    const workspace = await createSphinxEnabledWorkspace({
      ownerId: owner.id,
      slug: `sphinx-ws-${generateUniqueId()}`,
    });

    const invitee = await createTestUser({
      email: `invitee-${generateUniqueId()}@example.com`,
      name: "Invitee User",
      sphinxAlias: "invitee_sphinx",
      lightningPubkey: "test-pubkey-123",
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const request = new NextRequest(`http://localhost:3000/api/features/${feature.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeUserId: invitee.id }),
    });

    const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
    
    if (response.status !== 200) {
      const errorData = await response.json();
      console.error("Error response:", errorData);
    }
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify Sphinx API was called with correct message
    console.log("Mock fetch calls:", mockFetch.mock.calls.length);
    console.log("First call:", mockFetch.mock.calls[0]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/mock/sphinx/action");
    
    const body = JSON.parse(options?.body as string);
    expect(body.content).toContain("@invitee_sphinx");
    expect(body.content).toContain("Workspace Owner");
    expect(body.content).toContain("Test Feature");
    expect(body.content).toContain(`/w/${workspace.slug}/plan/${feature.id}`);
  });

  test("returns 500 when Sphinx API fails", async () => {
    // Clear and mock failed Sphinx API response
    mockFetch.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Sphinx API error",
    } as Response);

    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
    });

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name! },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any);

    const workspace = await createSphinxEnabledWorkspace({
      ownerId: owner.id,
      slug: `sphinx-ws-${generateUniqueId()}`,
    });

    const invitee = await createTestUser({
      email: `invitee-${generateUniqueId()}@example.com`,
      name: "Invitee User",
      sphinxAlias: "invitee_sphinx",
      lightningPubkey: "test-pubkey-123",
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const request = new NextRequest(`http://localhost:3000/api/features/${feature.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeUserId: invitee.id }),
    });

    const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });
    expect(response.status).toBe(500);
    
    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});

/**
 * Unit tests for PATCH /api/workspaces/[slug]/lingo/nodes/[ref_id]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn(() => "https://jarvis.example.com"),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
}));

vi.mock("@/app/api/mock/lingo/neighbors", () => ({
  getNeighborData: vi.fn(),
}));

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { updateNode } from "@/services/swarm/api/nodes";
import { PATCH } from "@/app/api/workspaces/[slug]/lingo/nodes/[ref_id]/route";

const mockedRequireAuth = vi.mocked(requireAuth);
const mockedGetWorkspaceSwarmAccess = vi.mocked(getWorkspaceSwarmAccess);
const mockedUpdateNode = vi.mocked(updateNode);

const WORKSPACE_ID = "ws-test-123";
const SWARM_NAME = "test-swarm";
const API_KEY = "test-api-key";

function makeRequest(body: object): NextRequest {
  return new NextRequest(
    "http://localhost/api/workspaces/test-slug/lingo/nodes/ref-123",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const mockParams = Promise.resolve({ slug: "test-slug", ref_id: "ref-123" });

describe("PATCH /api/workspaces/[slug]/lingo/nodes/[ref_id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Disable mock fallback so the real Jarvis path is exercised
    vi.stubEnv("USE_MOCKS", "false");

    // Default: valid authenticated user
    vi.mocked(getMiddlewareContext).mockReturnValue({} as never);
    mockedRequireAuth.mockReturnValue({ id: "user-1", email: "u@test.com", name: "User" } as never);

    // Default: successful swarm access
    mockedGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: {
        workspaceId: WORKSPACE_ID,
        swarmName: SWARM_NAME,
        swarmApiKey: API_KEY,
      },
    } as never);

    mockedUpdateNode.mockResolvedValue({ success: true });
  });

  describe("Authentication", () => {
    it("returns 401 when not authenticated", async () => {
      const { NextResponse } = await import("next/server");
      mockedRequireAuth.mockReturnValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
      );

      const response = await PATCH(makeRequest({ icon_url: null }), {
        params: mockParams,
      });
      expect(response.status).toBe(401);
    });
  });

  describe("Workspace access", () => {
    it("returns 403 when access is denied", async () => {
      mockedGetWorkspaceSwarmAccess.mockResolvedValue({
        success: false,
        error: { type: "ACCESS_DENIED" },
      } as never);

      const response = await PATCH(makeRequest({ icon_url: null }), {
        params: mockParams,
      });
      expect(response.status).toBe(403);
    });

    it("returns 404 when workspace not found", async () => {
      mockedGetWorkspaceSwarmAccess.mockResolvedValue({
        success: false,
        error: { type: "WORKSPACE_NOT_FOUND" },
      } as never);

      const response = await PATCH(makeRequest({ icon_url: null }), {
        params: mockParams,
      });
      expect(response.status).toBe(404);
    });

    it("returns 503 when swarm not configured", async () => {
      mockedGetWorkspaceSwarmAccess.mockResolvedValue({
        success: false,
        error: { type: "SWARM_NOT_CONFIGURED" },
      } as never);

      const response = await PATCH(makeRequest({ icon_url: null }), {
        params: mockParams,
      });
      expect(response.status).toBe(503);
    });
  });

  describe("icon_url validation", () => {
    it("returns 400 for a cross-workspace icon_url", async () => {
      const crossWorkspaceKey = `uploads/other-workspace/lingo-icons/123_abc_logo.png`;

      const response = await PATCH(makeRequest({ icon_url: crossWorkspaceKey }), {
        params: mockParams,
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/cross-workspace/i);
      expect(mockedUpdateNode).not.toHaveBeenCalled();
    });

    it("returns 400 for an arbitrary S3 key", async () => {
      const response = await PATCH(
        makeRequest({ icon_url: "workspace-logos/ws-test-123/logo.png" }),
        { params: mockParams },
      );
      expect(response.status).toBe(400);
      expect(mockedUpdateNode).not.toHaveBeenCalled();
    });
  });

  describe("Happy path", () => {
    it("calls updateNode with icon_url and returns success", async () => {
      const icon_url = `uploads/${WORKSPACE_ID}/lingo-icons/1234_abc_logo.png`;

      const response = await PATCH(makeRequest({ icon_url }), {
        params: mockParams,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      expect(mockedUpdateNode).toHaveBeenCalledWith(
        { jarvisUrl: "https://jarvis.example.com", apiKey: API_KEY },
        { ref_id: "ref-123", node_type: "Lingo", node_data: { icon_url } },
      );
    });

    it("accepts null icon_url without validation error", async () => {
      const response = await PATCH(makeRequest({ icon_url: null }), {
        params: mockParams,
      });
      expect(response.status).toBe(200);
      expect(mockedUpdateNode).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ node_data: { icon_url: null } }),
      );
    });
  });

  describe("updateNode failure", () => {
    it("returns 500 when updateNode fails", async () => {
      const icon_url = `uploads/${WORKSPACE_ID}/lingo-icons/1234_abc_logo.png`;
      mockedUpdateNode.mockResolvedValue({
        success: false,
        error: "Jarvis unavailable",
      });

      const response = await PATCH(makeRequest({ icon_url }), {
        params: mockParams,
      });
      expect(response.status).toBe(500);
    });
  });
});

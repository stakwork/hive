import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    swarm: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(() => "decrypted-api-key"),
    })),
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

import { GET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/versions/route";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";

describe("GET /api/workspaces/[slug]/workflows/[workflowId]/versions", () => {
  const mockUser = { id: "user-123", email: "test@example.com" };

  const mockWorkspace = {
    id: "ws-123",
    slug: "test-workspace",
    name: "Test Workspace",
    ownerId: mockUser.id,
    owner: { id: mockUser.id },
    members: [{ role: "OWNER" }],
    swarm: null,
    repositories: [],
  };

  const mockSwarm = {
    id: "swarm-1",
    workspaceId: "ws-123",
    swarmUrl: "http://swarm.example.com",
    swarmApiKey: JSON.stringify({ data: "enc", iv: "iv", tag: "tag" }),
  };

  const mockVersionNode = {
    ref_id: "ref-1",
    date_added_to_graph: "2024-01-01T00:00:00Z",
    properties: {
      workflow_version_id: 1,
      workflow_id: 10,
      workflow_json: '{"steps":[]}',
      workflow_name: "My Workflow",
      date_added_to_graph: "2024-01-01T00:00:00Z",
      published_at: null,
    },
  };

  function makeRequest() {
    return new NextRequest(
      "http://localhost/api/workspaces/test-workspace/workflows/10/versions",
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [mockVersionNode] }),
    } as any);
  });

  describe("Authentication", () => {
    it("should return 401 when both session and token are null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should authenticate via session cookie", async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(getToken)).not.toHaveBeenCalled();
    });

    it("should authenticate via Bearer token when session is null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ id: mockUser.id } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(200);
    });

    it("should return 401 when token has no id field", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ sub: "other" } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("Business logic", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
    });

    it("should return 404 when workspace is not found", async () => {
      vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "unknown", workflowId: "10" }),
      });

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid workflowId", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "notanumber" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 404 when swarm is not found", async () => {
      vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(404);
    });

    it("should return versions on success", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ slug: "test-workspace", workflowId: "10" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(1);
      expect(data.data.versions[0].workflow_version_id).toBe(1);
    });
  });
});

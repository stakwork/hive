import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com",
    STAKWORK_API_KEY: "test-api-key",
  },
}));

import { GET } from "@/app/api/stakwork/projects/[projectId]/route";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";

describe("GET /api/stakwork/projects/[projectId]", () => {
  const mockUser = { id: "user-123", email: "test@example.com" };

  const mockProjectResponse = {
    success: true,
    data: {
      project: { id: 42, name: "Test Project" },
      current_transition_completion: 75,
    },
  };

  function makeRequest() {
    return new NextRequest("http://localhost/api/stakwork/projects/42");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockProjectResponse,
    } as any);
  });

  describe("Authentication", () => {
    it("should return 401 when both session and token are null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should authenticate via session cookie", async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(200);
      expect(vi.mocked(getToken)).not.toHaveBeenCalled();
    });

    it("should authenticate via Bearer token when session is null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ id: mockUser.id } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(200);
    });

    it("should return 401 when token has no id field", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ sub: "other" } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("Stakwork API integration", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
    });

    it("should return project data on success", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.project).toEqual({ id: 42, name: "Test Project" });
      expect(data.data.current_transition_completion).toBe(75);
    });

    it("should return 404 when Stakwork returns 404", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "99999" }),
      });

      expect(res.status).toBe(404);
    });

    it("should return 404 when project data is invalid", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      } as any);

      const res = await GET(makeRequest(), {
        params: Promise.resolve({ projectId: "42" }),
      });

      expect(res.status).toBe(404);
    });
  });
});

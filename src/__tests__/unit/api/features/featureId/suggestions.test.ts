// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Auth mocks ──────────────────────────────────────────────────────────────
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/middleware/utils", () => ({
  checkIsSuperAdmin: vi.fn().mockResolvedValue(false),
}));

// ── DB mock ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
  },
}));

// ── AI mock (prevent real network calls) ────────────────────────────────────
vi.mock("ai", () => ({
  generateObject: vi.fn().mockResolvedValue({
    object: { suggestions: ["Looks good", "Go ahead"] },
  }),
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn().mockReturnValue("mock-model"),
  getApiKeyForProvider: vi.fn().mockReturnValue("mock-key"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { POST } from "@/app/api/features/[featureId]/suggestions/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(body = { messages: [{ role: "assistant", message: "Hello!" }] }) {
  return new NextRequest("http://localhost/api/features/feat-1/suggestions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function mockFeature(overrides: { ownerId?: string; isPublicViewable?: boolean } = {}) {
  vi.mocked(db.feature.findUnique).mockResolvedValue({
    workspaceId: "ws-1",
    workspace: {
      ownerId: overrides.ownerId ?? "owner-1",
      isPublicViewable: overrides.isPublicViewable ?? false,
    },
  } as never);
}

const params = Promise.resolve({ featureId: "feat-1" });

// ── Tests ────────────────────────────────────────────────────────────────────
describe("POST /api/features/[featureId]/suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkIsSuperAdmin).mockResolvedValue(false);
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
  });

  describe("Session cookie auth", () => {
    it("allows a workspace owner authenticated via session", async () => {
      mockFeature({ ownerId: "user-session" });
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "user-session" },
      } as never);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.suggestions)).toBe(true);
      expect(json.suggestions.length).toBeGreaterThan(0);
    });

    it("allows a workspace member authenticated via session", async () => {
      mockFeature({ ownerId: "owner-1" });
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "member-user" },
      } as never);
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ id: "mem-1" } as never);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.suggestions)).toBe(true);
    });
  });

  describe("Bearer token auth", () => {
    it("allows a workspace member authenticated via Bearer token (Sphinx app)", async () => {
      mockFeature({ ownerId: "owner-1" });
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ id: "bearer-user" } as never);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ id: "mem-2" } as never);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.suggestions)).toBe(true);
      expect(json.suggestions.length).toBeGreaterThan(0);
    });

    it("allows a super-admin authenticated via Bearer token", async () => {
      mockFeature({ ownerId: "owner-1" });
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ id: "super-user" } as never);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
      vi.mocked(checkIsSuperAdmin).mockResolvedValue(true);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.suggestions)).toBe(true);
    });
  });

  describe("Unauthenticated requests", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue(null);
    });

    it("allows access to a public workspace", async () => {
      mockFeature({ isPublicViewable: true });

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.suggestions)).toBe(true);
      expect(json.suggestions.length).toBeGreaterThan(0);
    });

    it("denies access to a private workspace and returns empty suggestions", async () => {
      mockFeature({ isPublicViewable: false });

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ suggestions: [] });
    });
  });

  describe("Authenticated non-member of private workspace", () => {
    it("returns empty suggestions when user has no membership row", async () => {
      mockFeature({ ownerId: "owner-1", isPublicViewable: false });
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "outsider-user" },
      } as never);
      vi.mocked(getToken).mockResolvedValue(null);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
      vi.mocked(checkIsSuperAdmin).mockResolvedValue(false);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ suggestions: [] });
    });
  });

  describe("Edge cases", () => {
    it("returns empty suggestions when feature is not found", async () => {
      vi.mocked(db.feature.findUnique).mockResolvedValue(null);
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as never);

      const res = await POST(makeRequest(), { params });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ suggestions: [] });
    });
  });
});

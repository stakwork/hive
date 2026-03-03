import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/workflow/recent/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

import { isDevelopmentMode } from "@/lib/runtime";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

global.fetch = vi.fn();
const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

describe("GET /api/workflow/recent Integration Tests", () => {
  let testUser: User;
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: User;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      name: "Stakwork",
      slug: "stakwork",
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: stakworkWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const response = await GET();
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const response = await GET();
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const response = await GET();
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const response = await GET();
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows stakwork workspace owner to fetch recent workflows", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            workflows: [
              { id: 100, name: "Owner Workflow" },
            ],
          },
        }),
      } as Response);

      const response = await GET();
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows workspace member (DEVELOPER role) to fetch recent workflows", async () => {
      const memberUser = await createTestUser({ name: "Developer User" });

      await db.workspaceMember.create({
        data: {
          workspaceId: stakworkWorkspace.id,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: memberUser.id, email: memberUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflows: [{ id: 200, name: "Member Workflow" }] },
        }),
      } as Response);

      const response = await GET();
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("returns mock workflows in dev mode without calling Stakwork API", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const response = await GET();
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.workflows)).toBe(true);
      expect(data.data.workflows.length).toBeGreaterThanOrEqual(3);
      expect(data.data.workflows[0]).toHaveProperty("id");
      expect(data.data.workflows[0]).toHaveProperty("name");

      // Should NOT have called the real Stakwork API
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("dev mode mock workflows have id and name fields", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const response = await GET();
      const data = await expectSuccess(response, 200);

      for (const workflow of data.data.workflows) {
        expect(typeof workflow.id).toBe("number");
        expect(typeof workflow.name).toBe("string");
      }
    });
  });

  describe("Stakwork API Proxy Tests", () => {
    test("fetches recent workflows from Stakwork API in prod mode", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const stakworkWorkflows = [
        { id: 501, name: "Prod Workflow 1" },
        { id: 502, name: "Prod Workflow 2" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflows: stakworkWorkflows },
        }),
      } as Response);

      const response = await GET();
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflows).toEqual(stakworkWorkflows);
    });

    test("calls Stakwork API with correct URL and Authorization header", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflows: [] },
        }),
      } as Response);

      await GET();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/workflow/recent",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
          }),
        })
      );
    });

    test("forwards upstream error status when Stakwork API fails", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      } as Response);

      const response = await GET();
      await expectError(response, "Failed to fetch recent workflows", 503);
    });

    test("returns 400 when Stakwork API returns success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: false }),
      } as Response);

      const response = await GET();
      await expectError(response, "Failed to fetch recent workflows from Stakwork", 400);
    });

    test("returns 500 on network error", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const response = await GET();
      await expectError(response, "Failed to fetch recent workflows", 500);
    });

    test("forwards 403 status from Stakwork API", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as Response);

      const response = await GET();
      await expectError(response, "Failed to fetch recent workflows", 403);
    });
  });
});

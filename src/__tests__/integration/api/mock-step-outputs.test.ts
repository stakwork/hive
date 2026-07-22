/**
 * Integration tests for Mock Step Outputs proxy routes.
 *
 * Tests cover:
 * - Auth/session gate (401 when unauthenticated)
 * - Membership gate (200 for stakwork member, 200 for hive-only member, 403 for non-member)
 * - Dev-mode dynamic-import branch
 * - workflow_id required on list (400 when missing)
 * - mock_step_output body nesting forwarded to Stakwork
 * - output values 0 / false / "" / null accepted (not rejected)
 * - 422 / 404 forwarding from Stakwork
 * - Upsert-on-create behaviour via dev-mode mock store
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/mock-step-outputs/route";
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from "@/app/api/workflow/mock-step-outputs/[mockStepOutputId]/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";
import type { User, Workspace } from "@prisma/client";

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function stakworkOk(data: unknown = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data }),
  } as Response);
}

function stakworkError(status: number, error: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ success: false, error }),
  } as Response);
}

// ─── Test state ───────────────────────────────────────────────────────────────

describe("Mock Step Outputs Proxy Routes", () => {
  let testUser: User;
  let otherUser: User;
  let stakworkWorkspace: Workspace;
  let hiveWorkspace: Workspace;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();
    otherUser = await createTestUser();

    // stakwork workspace — testUser is owner/member
    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "stakwork",
    });
    await db.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: stakworkWorkspace.id, userId: testUser.id },
      },
      create: { workspaceId: stakworkWorkspace.id, userId: testUser.id, role: "OWNER" },
      update: {},
    });

    // hive workspace — testUser is also a member
    hiveWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      slug: "hive",
    });
    await db.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: hiveWorkspace.id, userId: testUser.id },
      },
      create: { workspaceId: hiveWorkspace.id, userId: testUser.id, role: "DEVELOPER" },
      update: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/workflow/mock-step-outputs
  // ──────────────────────────────────────────────────────────────────────────

  describe("GET /api/workflow/mock-step-outputs (list)", () => {
    describe("Authentication", () => {
      test("returns 401 when session is null", async () => {
        mockGetServerSession.mockResolvedValueOnce(null);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        await expectUnauthorized(res);
      });

      test("returns 401 when session has no user", async () => {
        mockGetServerSession.mockResolvedValueOnce({ user: null } as any);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        await expectUnauthorized(res);
      });

      test("returns 401 when session user has no id", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { email: "x@x.com" },
        } as any);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        await expectError(res, "Invalid user session", 401);
      });
    });

    describe("Authorization", () => {
      test("returns 403 for non-member of any toolkit workspace", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: otherUser.id, email: otherUser.email },
        } as any);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        await expectForbidden(res);
      });

      test("allows stakwork workspace member", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkOk([]);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        const data = await expectSuccess(res);
        expect(data.success).toBe(true);
      });

      test("allows hive-only workspace member (gating fix)", async () => {
        // hiveOnlyUser is a member of the existing hive workspace (slug is unique per DB)
        const hiveOnlyUser = await createTestUser();
        await db.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: hiveWorkspace.id,
              userId: hiveOnlyUser.id,
            },
          },
          create: {
            workspaceId: hiveWorkspace.id,
            userId: hiveOnlyUser.id,
            role: "DEVELOPER",
          },
          update: {},
        });

        mockGetServerSession.mockResolvedValueOnce({
          user: { id: hiveOnlyUser.id, email: hiveOnlyUser.email },
        } as any);
        stakworkOk([]);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        expect(res.status).toBe(200);
      });
    });

    describe("Validation", () => {
      test("returns 400 when workflow_id is missing", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "GET");
        const res = await GET(req);
        await expectError(res, "workflow_id", 400);
      });
    });

    describe("Stakwork forwarding", () => {
      test("passes workflow_id and workflow_version_id to Stakwork", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkOk([{ id: "mso-1", workflow_id: "wf-1", step_id: "s-1", output: {} }]);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1&workflow_version_id=v-2",
          "GET"
        );
        const res = await GET(req);
        const data = await expectSuccess(res);
        expect(data.success).toBe(true);
        expect(data.data).toHaveLength(1);

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain("workflow_id=wf-1");
        expect(url).toContain("workflow_version_id=v-2");
        expect(opts.headers.Authorization).toBe("Token token=test-stakwork-key-123");
      });

      test("forwards 422 from Stakwork", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkError(422, "output cannot be blank. Use DELETE to remove a mock.");
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=wf-1",
          "GET"
        );
        const res = await GET(req);
        expect(res.status).toBe(422);
      });
    });

    describe("Dev mode", () => {
      test("routes to mock in dev mode (no session required)", async () => {
        mockIsDevelopmentMode.mockReturnValue(true);
        const req = makeReq(
          "http://localhost/api/workflow/mock-step-outputs?workflow_id=workflow-123",
          "GET"
        );
        const res = await GET(req);
        // mock store has entries for workflow-123
        const data = await expectSuccess(res);
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
        // Stakwork should NOT have been called
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("returns 400 in dev mode when workflow_id missing", async () => {
        mockIsDevelopmentMode.mockReturnValue(true);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "GET");
        const res = await GET(req);
        expect(res.status).toBe(400);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/workflow/mock-step-outputs
  // ──────────────────────────────────────────────────────────────────────────

  describe("POST /api/workflow/mock-step-outputs (create/upsert)", () => {
    describe("Authentication", () => {
      test("returns 401 when unauthenticated", async () => {
        mockGetServerSession.mockResolvedValueOnce(null);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
          output: { foo: "bar" },
        });
        const res = await POST(req);
        await expectUnauthorized(res);
      });
    });

    describe("Body validation", () => {
      test("returns 400 when workflow_id is missing", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          step_id: "step-1",
          output: {},
        });
        const res = await POST(req);
        await expectError(res, "workflow_id", 400);
      });

      test("returns 400 when step_id is missing", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          output: {},
        });
        const res = await POST(req);
        await expectError(res, "step_id", 400);
      });

      test("returns 400 when output key is entirely absent", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
        });
        const res = await POST(req);
        await expectError(res, "output", 400);
      });

      test.each([
        ["0 (number zero)", 0],
        ["false (boolean)", false],
        ['"" (empty string)', ""],
        ["null", null],
      ])("accepts output value of %s", async (_label, outputValue) => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkOk({ id: "mso-new", output: outputValue });
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
          output: outputValue,
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
      });
    });

    describe("Stakwork body nesting", () => {
      test("wraps body under mock_step_output when calling Stakwork", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkOk({ id: "mso-1", output: { result: 42 } });

        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-fetch",
          workflow_version_id: "v-2",
          output: { result: 42 },
        });
        await POST(req);

        const [_url, opts] = mockFetch.mock.calls[0];
        const sentBody = JSON.parse(opts.body);
        expect(sentBody).toHaveProperty("mock_step_output");
        expect(sentBody.mock_step_output.workflow_id).toBe("wf-1");
        expect(sentBody.mock_step_output.step_id).toBe("step-fetch");
        expect(sentBody.mock_step_output.workflow_version_id).toBe("v-2");
        expect(sentBody.mock_step_output.output).toEqual({ result: 42 });
      });

      test("sets workflow_version_id to null when omitted", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkOk({ id: "mso-1", output: {} });

        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
          output: {},
        });
        await POST(req);

        const [_url, opts] = mockFetch.mock.calls[0];
        const sentBody = JSON.parse(opts.body);
        expect(sentBody.mock_step_output.workflow_version_id).toBeNull();
      });
    });

    describe("Error forwarding", () => {
      test("forwards 422 from Stakwork with error message", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkError(422, "output cannot be blank. Use DELETE to remove a mock.");

        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
          output: {},
        });
        const res = await POST(req);
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toContain("output cannot be blank");
      });

      test("forwards 404 from Stakwork", async () => {
        mockGetServerSession.mockResolvedValueOnce({
          user: { id: testUser.id, email: testUser.email },
        } as any);
        stakworkError(404, "Resource not found");

        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-1",
          step_id: "step-1",
          output: {},
        });
        const res = await POST(req);
        expect(res.status).toBe(404);
      });
    });

    describe("Dev mode — upsert behaviour", () => {
      test("creates a new entry in dev mode", async () => {
        mockIsDevelopmentMode.mockReturnValue(true);
        const req = makeReq("http://localhost/api/workflow/mock-step-outputs", "POST", {
          workflow_id: "wf-upsert-new",
          step_id: "step-new",
          output: { x: 1 },
        });
        const res = await POST(req);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.workflow_id).toBe("wf-upsert-new");
        expect(data.data.step_id).toBe("step-new");
        expect(data.data.output).toEqual({ x: 1 });
        expect(data.data.id).toBeDefined();
      });

      test("upserts (updates) existing entry with same (workflow_id, step_id, version) key", async () => {
        mockIsDevelopmentMode.mockReturnValue(true);

        // First create
        const createReq = makeReq(
          "http://localhost/api/workflow/mock-step-outputs",
          "POST",
          { workflow_id: "wf-upsert", step_id: "step-upsert", workflow_version_id: "v-1", output: { val: "first" } }
        );
        const createRes = await POST(createReq);
        const created = await createRes.json();
        const firstId = created.data.id;

        // Upsert with same key
        const upsertReq = makeReq(
          "http://localhost/api/workflow/mock-step-outputs",
          "POST",
          { workflow_id: "wf-upsert", step_id: "step-upsert", workflow_version_id: "v-1", output: { val: "updated" } }
        );
        const upsertRes = await POST(upsertReq);
        const upserted = await upsertRes.json();

        // Same id (updated in place) and new output
        expect(upserted.data.id).toBe(firstId);
        expect(upserted.data.output).toEqual({ val: "updated" });
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/workflow/mock-step-outputs/[mockStepOutputId]
  // ──────────────────────────────────────────────────────────────────────────

  describe("GET /api/workflow/mock-step-outputs/[id]", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "GET");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectUnauthorized(res);
    });

    test("returns 403 for non-member", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "GET");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectForbidden(res);
    });

    test("fetches entry from Stakwork", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      const entry = { id: "mso-1", workflow_id: "wf-1", step_id: "s-1", output: { k: "v" } };
      stakworkOk(entry);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "GET");
      const res = await GET_BY_ID(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      const data = await expectSuccess(res);
      expect(data.data).toMatchObject(entry);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/mock_step_outputs/mso-1");
      expect(opts.headers.Authorization).toBe("Token token=test-stakwork-key-123");
    });

    test("forwards 404 from Stakwork", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      stakworkError(404, "Resource not found");
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-999", "GET");
      const res = await GET_BY_ID(req, {
        params: Promise.resolve({ mockStepOutputId: "mso-999" }),
      });
      expect(res.status).toBe(404);
    });

    test("uses dev-mode mock when isDevelopmentMode is true", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);
      const req = makeReq(
        "http://localhost/api/workflow/mock-step-outputs/mock-mso-1",
        "GET"
      );
      const res = await GET_BY_ID(req, {
        params: Promise.resolve({ mockStepOutputId: "mock-mso-1" }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PUT /api/workflow/mock-step-outputs/[mockStepOutputId]
  // ──────────────────────────────────────────────────────────────────────────

  describe("PUT /api/workflow/mock-step-outputs/[id]", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "PUT", {
        output: { x: 1 },
      });
      const res = await PUT(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectUnauthorized(res);
    });

    test("returns 400 when output key is absent", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "PUT", {
        workflow_id: "wf-1",
      });
      const res = await PUT(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectError(res, "output", 400);
    });

    test("wraps body under mock_step_output when calling Stakwork", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      stakworkOk({ id: "mso-1", output: { updated: true } });

      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "PUT", {
        workflow_id: "wf-1",
        step_id: "step-1",
        output: { updated: true },
      });
      const res = await PUT(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      expect(res.status).toBe(200);

      const [_url, opts] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody).toHaveProperty("mock_step_output");
      expect(sentBody.mock_step_output.output).toEqual({ updated: true });
    });

    test("forwards 422 from Stakwork", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      stakworkError(422, "output cannot be blank. Use DELETE to remove a mock.");
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "PUT", {
        output: null,
      });
      const res = await PUT(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      expect(res.status).toBe(422);
    });

    test("accepts falsy output values (0, false, null) in dev mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      for (const val of [0, false, null]) {
        // Create an entry to update
        const createReq = makeReq(
          "http://localhost/api/workflow/mock-step-outputs",
          "POST",
          {
            workflow_id: "wf-put-falsy",
            step_id: `step-falsy-${String(val)}`,
            output: { initial: true },
          }
        );
        const createRes = await POST(createReq);
        const created = await createRes.json();
        const id = created.data.id;

        const req = makeReq(
          `http://localhost/api/workflow/mock-step-outputs/${id}`,
          "PUT",
          { output: val }
        );
        const res = await PUT(req, { params: Promise.resolve({ mockStepOutputId: id }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.output).toStrictEqual(val);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/workflow/mock-step-outputs/[mockStepOutputId]
  // ──────────────────────────────────────────────────────────────────────────

  describe("DELETE /api/workflow/mock-step-outputs/[id]", () => {
    test("returns 401 when unauthenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectUnauthorized(res);
    });

    test("returns 403 for non-member", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      await expectForbidden(res);
    });

    test("deletes entry via Stakwork and returns success", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: "Mock step output deleted successfully" }),
      } as Response);

      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-1", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ mockStepOutputId: "mso-1" }) });
      const data = await expectSuccess(res);
      expect(data.success).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/mock_step_outputs/mso-1");
      expect(opts.method).toBe("DELETE");
    });

    test("forwards 404 from Stakwork", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);
      stakworkError(404, "Resource not found");
      const req = makeReq("http://localhost/api/workflow/mock-step-outputs/mso-999", "DELETE");
      const res = await DELETE(req, {
        params: Promise.resolve({ mockStepOutputId: "mso-999" }),
      });
      expect(res.status).toBe(404);
    });

    test("deletes entry in dev mode mock and returns success message", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      // Create an entry first
      const createReq = makeReq(
        "http://localhost/api/workflow/mock-step-outputs",
        "POST",
        { workflow_id: "wf-del", step_id: "step-del", output: { to: "delete" } }
      );
      const createRes = await POST(createReq);
      const created = await createRes.json();
      const id = created.data.id;

      const req = makeReq(`http://localhost/api/workflow/mock-step-outputs/${id}`, "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ mockStepOutputId: id }) });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toBe("Mock step output deleted successfully");
    });
  });
});

/**
 * Unit tests for the in-memory mock store in
 * src/app/api/mock/stakwork/mock-step-outputs/route.ts
 *
 * Covers:
 * - GET list: requires workflow_id, filters by it (+ optional version)
 * - POST: upsert on (workflow_id, step_id, workflow_version_id) — no duplicate rows
 * - GET/PUT/DELETE by id: 404 when id not found
 * - output values 0 / false / "" / null accepted by POST & PUT
 */
import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetReq(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

function makePostReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeIdReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Re-import module fresh before each test to get a clean store ─────────────
// We use vi.isolateModules() inside beforeEach so the module-level array is
// re-initialised for every test rather than sharing state across tests.

describe("Mock Step Outputs In-Memory Store", () => {
  // The seed data in the module includes these ids, so tests can rely on them.
  const SEED_ID_1 = "mock-mso-1"; // workflow-123, step-fetch-data, version null
  const SEED_ID_2 = "mock-mso-2"; // workflow-123, step-transform, version-42
  const SEED_ID_3 = "mock-mso-3"; // workflow-456, step-notify, version null

  // We import fresh per describe block so the store resets between groups.
  // Because vitest caches modules, we re-import dynamically each time.
  let GET: (req: NextRequest) => Promise<Response>;
  let POST: (req: NextRequest) => Promise<Response>;
  let GET_ID: (
    req: NextRequest,
    ctx: { params: Promise<{ mockStepOutputId: string }> }
  ) => Promise<Response>;
  let PUT_ID: (
    req: NextRequest,
    ctx: { params: Promise<{ mockStepOutputId: string }> }
  ) => Promise<Response>;
  let DELETE_ID: (
    req: NextRequest,
    ctx: { params: Promise<{ mockStepOutputId: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    // Force a fresh module load so the in-memory array resets to seed data.
    // Using unstable_isolateModules doesn't work well with async imports,
    // so we use a cache-busting query string to trick Next's module resolver.
    // For Vitest, the cleanest approach is to just re-import with vi.resetModules().
    const { vi } = await import("vitest");
    vi.resetModules();

    const listMod = await import("@/app/api/mock/stakwork/mock-step-outputs/route");
    const idMod = await import(
      "@/app/api/mock/stakwork/mock-step-outputs/[mockStepOutputId]/route"
    );

    GET = listMod.GET;
    POST = listMod.POST;
    GET_ID = idMod.GET;
    PUT_ID = idMod.PUT;
    DELETE_ID = idMod.DELETE;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET (list)
  // ────────────────────────────────────────────────────────────────────────────

  describe("GET /mock_step_outputs (list)", () => {
    test("returns 400 when workflow_id is missing", async () => {
      const req = makeGetReq("http://localhost/api/mock/stakwork/mock_step_outputs");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    test("returns only entries matching workflow_id", async () => {
      const req = makeGetReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs?workflow_id=workflow-123"
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      // Should include mock-mso-1 and mock-mso-2, not mock-mso-3
      const ids = body.data.map((e: { id: string }) => e.id);
      expect(ids).toContain(SEED_ID_1);
      expect(ids).toContain(SEED_ID_2);
      expect(ids).not.toContain(SEED_ID_3);
    });

    test("returns empty array for unknown workflow_id", async () => {
      const req = makeGetReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs?workflow_id=nonexistent"
      );
      const res = await GET(req);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    test("filters by workflow_version_id when provided — includes matching + null-version entries", async () => {
      // SEED_ID_1 has version null, SEED_ID_2 has version-42 — both belong to workflow-123
      const req = makeGetReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs?workflow_id=workflow-123&workflow_version_id=version-42"
      );
      const res = await GET(req);
      const body = await res.json();
      expect(body.success).toBe(true);
      const ids = body.data.map((e: { id: string }) => e.id);
      // mock-mso-2 matches version-42, mock-mso-1 matches null (included), mock-mso-3 is wrong workflow
      expect(ids).toContain(SEED_ID_1); // null version — always included
      expect(ids).toContain(SEED_ID_2); // exact version match
      expect(ids).not.toContain(SEED_ID_3);
    });

    test("returns no pagination fields in response", async () => {
      const req = makeGetReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs?workflow_id=workflow-123"
      );
      const res = await GET(req);
      const body = await res.json();
      expect(body).not.toHaveProperty("total");
      expect(body).not.toHaveProperty("page");
      expect(body).not.toHaveProperty("size");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST (create / upsert)
  // ────────────────────────────────────────────────────────────────────────────

  describe("POST /mock_step_outputs (create / upsert)", () => {
    test("creates a new entry and returns it", async () => {
      const req = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-new",
          step_id: "step-new",
          workflow_version_id: null,
          output: { hello: "world" },
        },
      });
      const res = await POST(req);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.workflow_id).toBe("wf-new");
      expect(body.data.step_id).toBe("step-new");
      expect(body.data.output).toEqual({ hello: "world" });
      expect(body.data.id).toBeDefined();
    });

    test("upserts (updates in place) when (workflow_id, step_id, version) key exists", async () => {
      // First create
      const createReq = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-upsert",
          step_id: "step-upsert",
          workflow_version_id: "v-1",
          output: { attempt: 1 },
        },
      });
      const createRes = await POST(createReq);
      const created = await createRes.json();
      const originalId = created.data.id;

      // Upsert same key with new output
      const upsertReq = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-upsert",
          step_id: "step-upsert",
          workflow_version_id: "v-1",
          output: { attempt: 2 },
        },
      });
      const upsertRes = await POST(upsertReq);
      const upserted = await upsertRes.json();

      // ID stays the same — no duplicate row
      expect(upserted.data.id).toBe(originalId);
      expect(upserted.data.output).toEqual({ attempt: 2 });

      // List should still have exactly one entry for this key
      const listReq = makeGetReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs?workflow_id=wf-upsert"
      );
      const listRes = await GET(listReq);
      const list = await listRes.json();
      const matches = list.data.filter(
        (e: { step_id: string }) => e.step_id === "step-upsert"
      );
      expect(matches).toHaveLength(1);
    });

    test("treats null version and absent version as the same upsert key", async () => {
      const firstReq = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-null-ver",
          step_id: "step-x",
          workflow_version_id: null,
          output: "first",
        },
      });
      const firstRes = await POST(firstReq);
      const first = await firstRes.json();

      // Post again without workflow_version_id (defaults to null)
      const secondReq = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-null-ver",
          step_id: "step-x",
          output: "second",
        },
      });
      const secondRes = await POST(secondReq);
      const second = await secondRes.json();

      expect(second.data.id).toBe(first.data.id);
      expect(second.data.output).toBe("second");
    });

    test.each([
      ["0 (number zero)", 0],
      ["false (boolean)", false],
      ['"" (empty string)', ""],
      ["null", null],
    ])("accepts output of %s without error", async (_label, outputValue) => {
      const req = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-falsy",
          step_id: `step-falsy-${String(outputValue)}`,
          output: outputValue,
        },
      });
      const res = await POST(req);
      expect(res.status).not.toBe(422);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.output).toStrictEqual(outputValue);
    });

    test("returns 422 when output key is entirely absent", async () => {
      const req = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: {
          workflow_id: "wf-no-output",
          step_id: "step-no-output",
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    test("returns 422 when workflow_id is missing", async () => {
      const req = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: { step_id: "step-1", output: {} },
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    test("returns 422 when step_id is missing", async () => {
      const req = makePostReq("http://localhost/api/mock/stakwork/mock_step_outputs", {
        mock_step_output: { workflow_id: "wf-1", output: {} },
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET by id
  // ────────────────────────────────────────────────────────────────────────────

  describe("GET /mock_step_outputs/:id", () => {
    test("returns entry for known seed id", async () => {
      const req = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_1}`,
        "GET"
      );
      const res = await GET_ID(req, { params: Promise.resolve({ mockStepOutputId: SEED_ID_1 }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(SEED_ID_1);
    });

    test("returns 404 for unknown id", async () => {
      const req = makeIdReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs/nonexistent-id",
        "GET"
      );
      const res = await GET_ID(req, {
        params: Promise.resolve({ mockStepOutputId: "nonexistent-id" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe("Resource not found");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PUT by id
  // ────────────────────────────────────────────────────────────────────────────

  describe("PUT /mock_step_outputs/:id", () => {
    test("updates output of existing entry", async () => {
      const req = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_1}`,
        "PUT",
        { output: { updated: true } }
      );
      const res = await PUT_ID(req, {
        params: Promise.resolve({ mockStepOutputId: SEED_ID_1 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.output).toEqual({ updated: true });
      expect(body.data.id).toBe(SEED_ID_1);
    });

    test("returns 404 for unknown id", async () => {
      const req = makeIdReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs/bad-id",
        "PUT",
        { output: {} }
      );
      const res = await PUT_ID(req, {
        params: Promise.resolve({ mockStepOutputId: "bad-id" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Resource not found");
    });

    test("returns 422 when output key is absent", async () => {
      const req = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_1}`,
        "PUT",
        { workflow_id: "wf-1" }
      );
      const res = await PUT_ID(req, {
        params: Promise.resolve({ mockStepOutputId: SEED_ID_1 }),
      });
      expect(res.status).toBe(422);
    });

    test.each([
      ["0", 0],
      ["false", false],
      ['""', ""],
      ["null", null],
    ])("accepts output of %s", async (_label, val) => {
      const req = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_1}`,
        "PUT",
        { output: val }
      );
      const res = await PUT_ID(req, {
        params: Promise.resolve({ mockStepOutputId: SEED_ID_1 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.output).toStrictEqual(val);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // DELETE by id
  // ────────────────────────────────────────────────────────────────────────────

  describe("DELETE /mock_step_outputs/:id", () => {
    test("deletes existing entry and returns success message", async () => {
      const req = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_3}`,
        "DELETE"
      );
      const res = await DELETE_ID(req, {
        params: Promise.resolve({ mockStepOutputId: SEED_ID_3 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBe("Mock step output deleted successfully");

      // Confirm it's gone
      const getReq = makeIdReq(
        `http://localhost/api/mock/stakwork/mock_step_outputs/${SEED_ID_3}`,
        "GET"
      );
      const getRes = await GET_ID(getReq, {
        params: Promise.resolve({ mockStepOutputId: SEED_ID_3 }),
      });
      expect(getRes.status).toBe(404);
    });

    test("returns 404 for unknown id", async () => {
      const req = makeIdReq(
        "http://localhost/api/mock/stakwork/mock_step_outputs/bad-id",
        "DELETE"
      );
      const res = await DELETE_ID(req, {
        params: Promise.resolve({ mockStepOutputId: "bad-id" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Resource not found");
    });
  });
});

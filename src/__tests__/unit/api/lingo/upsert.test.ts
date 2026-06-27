/**
 * Unit tests for POST /api/lingo/extraction/upsert
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db");
vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));
vi.mock("@/services/swarm/api/nodes", () => ({
  searchLatestByTypes: vi.fn(),
  addNodeBulk: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { searchLatestByTypes, addNodeBulk } from "@/services/swarm/api/nodes";
import { POST } from "@/app/api/lingo/extraction/upsert/route";

const mockedDb = vi.mocked(db);
const mockedGetJarvisConfig = vi.mocked(getJarvisConfigForWorkspace);
const mockedSearchLatest = vi.mocked(searchLatestByTypes);
const mockedAddNodeBulk = vi.mocked(addNodeBulk);

const WORKSPACE_ID = "ws-test-456";
const JARVIS_CONFIG = { jarvisUrl: "http://jarvis", apiKey: "key" };

const CURSOR_STATE = {
  reachedFloor: true,
  backwardsCursor: "2024-01-01T00:00:00.000Z",
  lastProcessedAt: "2024-06-01T00:00:00.000Z",
};

const HIGH_TERM = {
  name: "TestTerm",
  definition: "A test term",
  lingo_type: "product_term",
  confidence: "high" as const,
  evidence: "Used in chat",
};

const MEDIUM_TERM = {
  name: "MediumTerm",
  definition: "A medium confidence term",
  lingo_type: "industry_term",
  confidence: "medium" as const,
  evidence: "Maybe used",
};

const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

// Prevent real network calls from the hub-mirror trigger in all tests
let globalFetchSpy: ReturnType<typeof vi.spyOn>;

function makeRequest(body: object, secret = "test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/lingo/extraction/upsert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
  globalFetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  process.env.JANITOR_WEBHOOK_SECRET = origSecret;
  globalFetchSpy.mockRestore();
  vi.clearAllMocks();
});

describe("POST /api/lingo/extraction/upsert — auth", () => {
  it("returns 401 if secret is missing", async () => {
    const req = new NextRequest("http://localhost/api/lingo/extraction/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, terms: [], cursor_state: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 if secret is wrong", async () => {
    const req = makeRequest({ workspaceId: WORKSPACE_ID, terms: [], cursor_state: {} }, "bad-secret");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/lingo/extraction/upsert — confidence filtering", () => {
  beforeEach(() => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({ id: WORKSPACE_ID });
    mockedGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockedSearchLatest.mockResolvedValue({ ok: true, nodes: [] });
    mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });
    mockedDb.workspace.update = vi.fn().mockResolvedValue({});
  });

  it("high confidence term is upserted", async () => {
    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.upserted).toBe(1);
    expect(json.skipped_confidence).toBe(0);
    expect(mockedAddNodeBulk).toHaveBeenCalledTimes(1);
  });

  it("medium confidence term is counted in skipped_confidence and not written", async () => {
    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [MEDIUM_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.skipped_confidence).toBe(1);
    expect(json.upserted).toBe(0);
  });

  it("mix of high and medium: only high is upserted", async () => {
    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM, MEDIUM_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.upserted).toBe(1);
    expect(json.skipped_confidence).toBe(1);
  });
});

describe("POST /api/lingo/extraction/upsert — deduplication", () => {
  beforeEach(() => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({ id: WORKSPACE_ID });
    mockedGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockedDb.workspace.update = vi.fn().mockResolvedValue({});
  });

  it("normalized name match skips term and counts in skipped_dedup", async () => {
    mockedSearchLatest.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "existing-1",
          node_type: "Lingo",
          properties: { name: "testterm" }, // lowercase
        },
      ],
    });
    mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });

    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM], // HIGH_TERM.name = "TestTerm" → normalized "testterm"
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.skipped_dedup).toBe(1);
    expect(json.upserted).toBe(0);
  });

  it("new term with no name collision is upserted", async () => {
    mockedSearchLatest.mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: "existing-1",
          node_type: "Lingo",
          properties: { name: "completely-different" },
        },
      ],
    });
    mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });

    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.upserted).toBe(1);
    expect(json.skipped_dedup).toBe(0);
  });
});

describe("POST /api/lingo/extraction/upsert — cursor persistence", () => {
  beforeEach(() => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({ id: WORKSPACE_ID });
    mockedGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockedSearchLatest.mockResolvedValue({ ok: true, nodes: [] });
    mockedDb.workspace.update = vi.fn().mockResolvedValue({});
  });

  it("successful addNodeBulk → cursor_state persisted to workspace.lingoExtractionState", async () => {
    mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });

    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    await POST(req);

    expect(mockedDb.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_ID },
        data: expect.objectContaining({
          lingoExtractionState: expect.objectContaining({
            reachedFloor: CURSOR_STATE.reachedFloor,
            backwardsCursor: CURSOR_STATE.backwardsCursor,
          }),
        }),
      }),
    );
  });

  it("addNodeBulk throws → cursor not advanced, error in response", async () => {
    mockedAddNodeBulk.mockResolvedValue({ success: false, errors: ["Jarvis error"] });

    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.errors).toContain("Jarvis error");
    expect(json.upserted).toBe(0);
    // cursor must NOT be advanced
    expect(mockedDb.workspace.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/lingo/extraction/upsert — hub mirror", () => {
  beforeEach(() => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({ id: WORKSPACE_ID });
    mockedGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockedSearchLatest.mockResolvedValue({ ok: true, nodes: [] });
    mockedAddNodeBulk.mockResolvedValue({ success: true, errors: [] });
    mockedDb.workspace.update = vi.fn().mockResolvedValue({});
  });

  it("hub-mirror fetch is called after successful upsert", async () => {
    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    await POST(req);

    expect(globalFetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/cron/lingo-hub-mirror"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("hub-mirror fetch failure is logged but response still returns success", async () => {
    globalFetchSpy.mockRejectedValue(new Error("hub-mirror unreachable"));

    const req = makeRequest({
      workspaceId: WORKSPACE_ID,
      terms: [HIGH_TERM],
      cursor_state: CURSOR_STATE,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.upserted).toBe(1);
  });
});

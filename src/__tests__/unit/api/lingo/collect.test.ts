/**
 * Unit tests for POST /api/lingo/extraction/collect
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db");
vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));
vi.mock("@/services/swarm/api/nodes", () => ({
  searchLatestByTypes: vi.fn(),
}));
vi.mock("@/lib/utils/lingo-extraction", () => ({
  jargonScore: vi.fn((text: string) => {
    // Deterministic: texts containing "JARGON" score high, others score 0
    return text.includes("JARGON") ? 10 : 0;
  }),
}));

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { searchLatestByTypes } from "@/services/swarm/api/nodes";

const mockedDb = vi.mocked(db);
const mockedGetJarvisConfig = vi.mocked(getJarvisConfigForWorkspace);
const mockedSearchLatest = vi.mocked(searchLatestByTypes);

function makeRequest(body: object, secret = "test-secret"): NextRequest {
  return new NextRequest("http://localhost/api/lingo/extraction/collect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

const WORKSPACE_ID = "ws-test-123";

describe("POST /api/lingo/extraction/collect — auth", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
  });

  it("returns 401 if secret is missing", async () => {
    const req = new NextRequest("http://localhost/api/lingo/extraction/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 if secret is wrong", async () => {
    const req = makeRequest({ workspaceId: WORKSPACE_ID }, "wrong-secret");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/lingo/extraction/collect — backwards mode (no prior state)", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;

    // Workspace with empty state
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {},
    });

    // No Jarvis config
    mockedGetJarvisConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
    vi.clearAllMocks();
  });

  it("uses backwards mode when no prior state", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    // cursor_state should have reachedFloor: true (empty batch < 200 default)
    expect(json.cursor_state.reachedFloor).toBe(true);
    // Verify the findMany was called with desc order (backwards mode) and default limit 200
    expect(mockedDb.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  });

  it("batch of exactly 500 keeps reachedFloor false and advances backwardsCursor", async () => {
    const now = new Date();
    const batch = Array.from({ length: 500 }, (_, i) => ({
      id: `msg-${i}`,
      message: "JARGON content here",
      createdAt: new Date(now.getTime() - i * 1000),
    }));
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue(batch);

    // Pass limit: 500 explicitly so the batch hits the limit
    const req = makeRequest({ workspaceId: WORKSPACE_ID, limit: 500 });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.reachedFloor).toBeFalsy();
    expect(json.cursor_state.backwardsCursor).toBe(batch[499].createdAt.toISOString());
  });

  it("batch < 500 sets reachedFloor: true", async () => {
    const batch = Array.from({ length: 3 }, (_, i) => ({
      id: `msg-${i}`,
      message: "plain text no score",
      createdAt: new Date(),
    }));
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue(batch);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.reachedFloor).toBe(true);
  });

  it("USER role + non-null userId included; assistant excluded", async () => {
    // Our mock only returns USER messages (db mock)
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([
      { id: "msg-user", message: "JARGON user message", createdAt: new Date() },
    ]);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    // Verify the findMany was called with role: "USER" and userId: { not: null }
    expect(mockedDb.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "USER",
          userId: { not: null },
        }),
      }),
    );
  });

  it("does NOT write workspace.lingoExtractionState", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    mockedDb.workspace.update = vi.fn().mockResolvedValue({});

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    await POST(req);

    expect(mockedDb.workspace.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/lingo/extraction/collect — forward mode (reachedFloor: true)", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;

    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {
        reachedFloor: true,
        backwardsCursor: "2024-01-01T00:00:00.000Z",
        lastProcessedAt: "2024-06-01T00:00:00.000Z",
      },
    });
    mockedGetJarvisConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
    vi.clearAllMocks();
  });

  it("uses forward mode when reachedFloor is true", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    await POST(req);

    expect(mockedDb.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
        where: expect.objectContaining({
          createdAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });
});

describe("POST /api/lingo/extraction/collect — jargon score filter", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;

    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {},
    });
    mockedGetJarvisConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
    vi.clearAllMocks();
  });

  it("messages with score < 4 are excluded from texts and source_map", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([
      { id: "low", message: "plain text no score", createdAt: new Date() },
    ]);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.texts).toHaveLength(0);
    expect(json.source_map).toHaveLength(0);
    expect(json.total_before_filter).toBe(1);
    expect(json.total_after_filter).toBe(0);
  });

  it("messages with score >= 4 are included with correct source_map entry", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([
      { id: "high", message: "JARGON content here", createdAt: new Date() },
    ]);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.texts).toHaveLength(1);
    expect(json.source_map).toHaveLength(1);
    expect(json.source_map[0].source_id).toBe("high");
    expect(json.source_map[0].score).toBe(10);
    expect(json.total_before_filter).toBe(1);
    expect(json.total_after_filter).toBe(1);
  });
});

describe("POST /api/lingo/extraction/collect — Jarvis sources", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;

    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {},
    });
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    mockedGetJarvisConfig.mockResolvedValue({ jarvisUrl: "http://jarvis", apiKey: "key" });
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
    vi.clearAllMocks();
  });

  it("HiveChatMessage with node_data.role === 'assistant' is excluded", async () => {
    mockedSearchLatest.mockImplementation(async (config, types) => {
      if (types.HiveChatMessage) {
        return {
          ok: true,
          nodes: [
            {
              ref_id: "sphinx-1",
              node_type: "HiveChatMessage",
              node_data: { role: "assistant", content: "JARGON assistant message" },
            },
          ],
        };
      }
      return { ok: true, nodes: [] };
    });

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    // Assistant message must be excluded
    expect(json.texts).toHaveLength(0);
  });

  it("Episode/Call with neither description nor transcript is silently skipped", async () => {
    mockedSearchLatest.mockImplementation(async (config, types) => {
      if (types.Episode || types.Call) {
        return {
          ok: true,
          nodes: [
            {
              ref_id: "episode-1",
              node_type: "Episode",
              properties: {}, // no description or transcript
            },
          ],
        };
      }
      return { ok: true, nodes: [] };
    });

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.total_before_filter).toBe(0);
  });
});

describe("POST /api/lingo/extraction/collect — configurable limit and hasMore", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  const origSecret = process.env.JANITOR_WEBHOOK_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JANITOR_WEBHOOK_SECRET = "test-secret";
    const mod = await import("@/app/api/lingo/extraction/collect/route");
    POST = mod.POST;

    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {},
    });
    mockedGetJarvisConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.JANITOR_WEBHOOK_SECRET = origSecret;
    vi.clearAllMocks();
  });

  it("default limit of 200 — findMany called with take: 200 when no limit in body", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    await POST(req);

    expect(mockedDb.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it("custom limit param — findMany called with take: 50 when limit: 50 passed", async () => {
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([]);
    const req = makeRequest({ workspaceId: WORKSPACE_ID, limit: 50 });
    await POST(req);

    expect(mockedDb.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it("hasMore: true when batch length equals limit", async () => {
    const batch = Array.from({ length: 200 }, (_, i) => ({
      id: `msg-${i}`,
      message: "plain text",
      createdAt: new Date(Date.now() - i * 1000),
    }));
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue(batch);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.hasMore).toBe(true);
  });

  it("hasMore: false when batch length is less than limit", async () => {
    const batch = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i}`,
      message: "plain text",
      createdAt: new Date(Date.now() - i * 1000),
    }));
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue(batch);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.hasMore).toBe(false);
  });

  it("hasMore: true in forward mode when batch equals limit", async () => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {
        reachedFloor: true,
        lastProcessedAt: "2024-06-01T00:00:00.000Z",
      },
    });

    const batch = Array.from({ length: 200 }, (_, i) => ({
      id: `msg-${i}`,
      message: "plain text",
      createdAt: new Date(Date.now() - i * 1000),
    }));
    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue(batch);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.hasMore).toBe(true);
  });

  it("hasMore: false in forward mode when batch is under limit", async () => {
    mockedDb.workspace.findUnique = vi.fn().mockResolvedValue({
      lingoExtractionState: {
        reachedFloor: true,
        lastProcessedAt: "2024-06-01T00:00:00.000Z",
      },
    });

    mockedDb.chatMessage.findMany = vi.fn().mockResolvedValue([
      { id: "msg-1", message: "plain text", createdAt: new Date() },
    ]);

    const req = makeRequest({ workspaceId: WORKSPACE_ID });
    const res = await POST(req);
    const json = await res.json();

    expect(json.cursor_state.hasMore).toBe(false);
  });
});

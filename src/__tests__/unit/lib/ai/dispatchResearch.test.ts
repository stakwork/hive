/**
 * Unit tests for the `dispatch_research` tool in researchTools.ts.
 *
 * Coverage:
 *   - Happy path: creates Research row, pushes intent to collector, returns awaitingReply: true.
 *   - Duplicate-slug error path: DB throws → returns { error }.
 *   - IDOR guard: invalid initiativeId collapses to root scope.
 *   - No collector: tool still works when dispatchedResearch is not provided.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type { DispatchedResearchIntent } from "@/lib/ai/researchTools";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    research: { create: vi.fn() },
  },
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(async () => {}),
  notifyResearchEvent: vi.fn(async () => {}),
}));

import { db } from "@/lib/db";
import { notifyCanvasUpdated } from "@/lib/canvas";
import { buildResearchTools } from "@/lib/ai/researchTools";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const CONV_ID = "conv-1";

function makeTools(collector?: DispatchedResearchIntent[]) {
  return buildResearchTools(
    ORG_ID,
    USER_ID,
    [], // webSearchResults
    collector,
    CONV_ID,
  );
}

const BASE_INPUT = {
  slug: "test-research",
  topic: "How does X work",
  title: "X Deep Dive",
  summary: "A comprehensive look at X.",
  prompt: "Search for X and write a detailed doc.",
};

describe("dispatch_research tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.initiative.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.research.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "res-1",
      slug: BASE_INPUT.slug,
    });
  });

  test("creates the Research row and returns awaitingReply: true", async () => {
    const tools = makeTools();
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    const result = await tool.execute(BASE_INPUT);

    expect(db.research.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: BASE_INPUT.slug,
          topic: BASE_INPUT.topic,
          title: BASE_INPUT.title,
          summary: BASE_INPUT.summary,
          orgId: ORG_ID,
          createdBy: USER_ID,
          content: null,
        }),
      }),
    );
    expect(result).toMatchObject({
      awaitingReply: true,
      researchId: "res-1",
      slug: BASE_INPUT.slug,
      topic: BASE_INPUT.topic,
      title: BASE_INPUT.title,
      status: "dispatched",
    });
  });

  test("pushes intent into the collector array", async () => {
    const collector: DispatchedResearchIntent[] = [];
    const tools = makeTools(collector);
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    await tool.execute(BASE_INPUT);

    expect(collector).toHaveLength(1);
    expect(collector[0]).toMatchObject({
      researchId: "res-1",
      slug: BASE_INPUT.slug,
      topic: BASE_INPUT.topic,
      title: BASE_INPUT.title,
      summary: BASE_INPUT.summary,
      prompt: BASE_INPUT.prompt,
      conversationId: CONV_ID,
      orgId: ORG_ID,
      userId: USER_ID,
    });
    expect(collector[0].initiativeId).toBeUndefined();
  });

  test("fires notifyCanvasUpdated after creating the row", async () => {
    const tools = makeTools();
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    await tool.execute(BASE_INPUT);
    expect(notifyCanvasUpdated).toHaveBeenCalledWith(
      ORG_ID,
      "", // root ref (no initiativeId)
      "research-created",
      expect.objectContaining({ slug: BASE_INPUT.slug, researchId: "res-1" }),
    );
  });

  test("returns { error } when db.research.create throws (duplicate slug)", async () => {
    (db.research.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unique constraint violation"),
    );
    const tools = makeTools();
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    const result = await tool.execute(BASE_INPUT);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/slug may already be in use/i);
  });

  test("does not push to collector when db.research.create throws", async () => {
    (db.research.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    const collector: DispatchedResearchIntent[] = [];
    const tools = makeTools(collector);
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    await tool.execute(BASE_INPUT);
    expect(collector).toHaveLength(0);
  });

  test("IDOR guard: valid initiativeId is resolved and included", async () => {
    (db.initiative.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "init-1" });
    const collector: DispatchedResearchIntent[] = [];
    const tools = makeTools(collector);
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    await tool.execute({ ...BASE_INPUT, initiativeId: "init-1" });

    expect(db.research.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ initiativeId: "init-1" }),
      }),
    );
    expect(collector[0].initiativeId).toBe("init-1");
    expect(notifyCanvasUpdated).toHaveBeenCalledWith(
      ORG_ID,
      "initiative:init-1",
      "research-created",
      expect.any(Object),
    );
  });

  test("IDOR guard: invalid/foreign initiativeId collapses to root scope", async () => {
    (db.initiative.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const collector: DispatchedResearchIntent[] = [];
    const tools = makeTools(collector);
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    await tool.execute({ ...BASE_INPUT, initiativeId: "foreign-init" });

    expect(db.research.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ initiativeId: null }),
      }),
    );
    expect(collector[0].initiativeId).toBeUndefined();
  });

  test("works without a collector (no error thrown)", async () => {
    const tools = buildResearchTools(ORG_ID, USER_ID, []);
    const tool = tools["dispatch_research"] as { execute: (args: unknown) => Promise<unknown> };
    const result = await tool.execute(BASE_INPUT);
    expect(result).toMatchObject({ awaitingReply: true });
  });
});

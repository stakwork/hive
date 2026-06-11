import { describe, it, expect, vi, beforeEach } from "vitest";
import { JanitorStatus, JanitorTrigger } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mocks (must come before imports that use them)
// ---------------------------------------------------------------------------

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@/lib/ai/provider", () => ({
  getApiKeyForProvider: vi.fn().mockReturnValue("test-api-key"),
  getModel: vi.fn().mockReturnValue("mock-model"),
}));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getOrgChannelName: (login: string) => `org-${login}`,
  PUSHER_EVENTS: { CANVAS_REVIEW_UPDATED: "canvas-review-updated" },
}));

import { db } from "@/lib/db";
import { generateText } from "ai";
import { runCanvasJanitorForOrg } from "@/services/canvas-janitor";

const mockedGenerateText = vi.mocked(generateText);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(id = "run-1") {
  return { id, configId: "cfg-1", status: JanitorStatus.PENDING };
}

function makeAuthoredNode(id: string, category: string, text: string, userId: string) {
  return {
    id,
    category,
    label: text,
    customData: { createdBy: userId, createdAt: "2025-09-01T00:00:00Z" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCanvasJanitorForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default db mock behaviour
    vi.mocked(db.canvasJanitorRun.create).mockResolvedValue(makeRun() as never);
    vi.mocked(db.canvasJanitorRun.update).mockResolvedValue(makeRun() as never);
    vi.mocked(db.canvasJanitorConfig.update).mockResolvedValue({} as never);
    vi.mocked(db.canvas.findMany).mockResolvedValue([] as never);
    vi.mocked(db.feature.findMany).mockResolvedValue([] as never);
    vi.mocked(db.initiative.findMany).mockResolvedValue([] as never);
    vi.mocked(db.research.findMany).mockResolvedValue([] as never);
    vi.mocked(db.canvasReviewCard.findMany).mockResolvedValue([] as never);
    vi.mocked(db.canvasReviewCard.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.canvasReviewCard.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
      githubLogin: "test-org",
    } as never);
  });

  it("returns 0 cardsCreated when no canvases exist", async () => {
    vi.mocked(db.canvas.findMany).mockResolvedValue([] as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(result.cardsCreated).toBe(0);
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("skips nodes without customData.createdBy", async () => {
    const blob = {
      nodes: [
        { id: "n1", category: "note", label: "orphan note", customData: {} },
        { id: "n2", category: "note", label: "another", customData: null },
      ],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(result.cardsCreated).toBe(0);
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("skips DB-creating categories (initiative, milestone, feature)", async () => {
    const blob = {
      nodes: [
        { id: "n1", category: "initiative", label: "init", customData: { createdBy: "user-1" } },
        { id: "n2", category: "milestone", label: "mile", customData: { createdBy: "user-1" } },
        { id: "n3", category: "feature", label: "feat", customData: { createdBy: "user-1" } },
      ],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(result.cardsCreated).toBe(0);
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("calls LLM and creates cards for authored nodes", async () => {
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Reminder: Q3 retro", "user-1")],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify([
        {
          id: "n1",
          flagged: true,
          reason: "This reminder appears stale",
          reasonCategory: "STALE_CONTENT",
        },
      ]),
    } as never);
    vi.mocked(db.canvasReviewCard.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(mockedGenerateText).toHaveBeenCalledOnce();
    expect(vi.mocked(db.canvasReviewCard.createMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            nodeId: "n1",
            reason: "STALE_CONTENT",
            status: "PENDING",
          }),
        ]),
      }),
    );
    expect(result.cardsCreated).toBe(1);
  });

  it("includes today's date in the LLM prompt", async () => {
    const today = new Date().toISOString().split("T")[0];
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Some note", "user-1")],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    mockedGenerateText.mockResolvedValue({ text: JSON.stringify([]) } as never);

    await runCanvasJanitorForOrg("org-1", "cfg-1");

    const callArgs = mockedGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain(`Today is ${today}`);
  });

  it("includes linked entity states in the LLM prompt", async () => {
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Spike note", "user-1")],
      edges: [{ id: "e1", fromNode: "n1", toNode: "feature:feat-1" }],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    vi.mocked(db.feature.findMany).mockResolvedValue([
      { id: "feat-1", title: "Redis Caching", deleted: false, status: "CANCELLED" },
    ] as never);
    mockedGenerateText.mockResolvedValue({ text: JSON.stringify([]) } as never);

    await runCanvasJanitorForOrg("org-1", "cfg-1");

    const callArgs = mockedGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Redis Caching");
    expect(callArgs.prompt).toContain("CANCELLED");
  });

  it("does not create a card when a DISMISSED card already exists for same (nodeId, reason)", async () => {
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Old note", "user-1")],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify([
        { id: "n1", flagged: true, reason: "stale", reasonCategory: "STALE_CONTENT" },
      ]),
    } as never);
    // Existing DISMISSED card for same nodeId+reason
    vi.mocked(db.canvasReviewCard.findMany).mockResolvedValue([
      { nodeId: "n1", reason: "STALE_CONTENT" },
    ] as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(vi.mocked(db.canvasReviewCard.createMany)).not.toHaveBeenCalled();
    expect(result.cardsCreated).toBe(0);
  });

  it("handles malformed LLM JSON gracefully (no crash)", async () => {
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Some note", "user-1")],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    mockedGenerateText.mockResolvedValue({ text: "not valid json {{{" } as never);

    const result = await runCanvasJanitorForOrg("org-1", "cfg-1");
    expect(result.cardsCreated).toBe(0);
    expect(vi.mocked(db.canvasReviewCard.createMany)).not.toHaveBeenCalled();
  });

  it("marks run COMPLETED with correct cardsCreated count", async () => {
    const blob = {
      nodes: [makeAuthoredNode("n1", "note", "Note", "user-1")],
      edges: [],
    };
    vi.mocked(db.canvas.findMany).mockResolvedValue([
      { id: "c1", ref: "", data: blob },
    ] as never);
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify([
        { id: "n1", flagged: true, reason: "stale", reasonCategory: "STALE_CONTENT" },
      ]),
    } as never);
    vi.mocked(db.canvasReviewCard.createMany).mockResolvedValue({ count: 1 } as never);

    await runCanvasJanitorForOrg("org-1", "cfg-1");

    expect(vi.mocked(db.canvasJanitorRun.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: JanitorStatus.COMPLETED,
          cardsCreated: 1,
        }),
      }),
    );
  });

  it("uses MANUAL trigger when specified", async () => {
    vi.mocked(db.canvas.findMany).mockResolvedValue([] as never);

    await runCanvasJanitorForOrg("org-1", "cfg-1", "user-1", JanitorTrigger.MANUAL);

    expect(vi.mocked(db.canvasJanitorRun.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredBy: JanitorTrigger.MANUAL,
          triggeredByUserId: "user-1",
        }),
      }),
    );
  });
});

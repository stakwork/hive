/**
 * A chat's A/B mode (`SharedConversation.mode`): stamped when the row is
 * created, read back by `loadOrgCanvasPromptCache`, never rewritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, findFirst, appendTurnMessages } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  appendTurnMessages: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { sharedConversation: { create, findFirst } } }));
vi.mock("@/services/canvas-turn-persistence", () => ({ appendTurnMessages }));

import { loadOrgCanvasPromptCache, persistCanvasUserMessage } from "@/services/org-canvas-conversation";

const BASE = {
  orgId: "org-1",
  userId: "user-1",
  turnId: "turn-1",
  content: "hello",
  workspaceSlugs: ["alpha"],
};

describe("persistCanvasUserMessage — mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: "new-row" });
  });

  it("stores concept mode on a newly created row", async () => {
    const id = await persistCanvasUserMessage({ ...BASE, existingRowId: null, mode: "concept" });
    expect(id).toBe("new-row");
    expect(create.mock.calls[0][0].data.mode).toBe("concept");
  });

  it("defaults a new row to full", async () => {
    await persistCanvasUserMessage({ ...BASE, existingRowId: null });
    expect(create.mock.calls[0][0].data.mode).toBe("full");
  });

  it("never stores anything but full / concept", async () => {
    await persistCanvasUserMessage({ ...BASE, existingRowId: null, mode: "weird" as never });
    expect(create.mock.calls[0][0].data.mode).toBe("full");
  });

  it("leaves an existing row alone — the mode is set once, at creation", async () => {
    const id = await persistCanvasUserMessage({ ...BASE, existingRowId: "row-9", mode: "concept" });
    expect(id).toBe("row-9");
    expect(create).not.toHaveBeenCalled();
    expect(appendTurnMessages).toHaveBeenCalledOnce();
  });
});

describe("loadOrgCanvasPromptCache — mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the stored mode (ignoring anything a request might say)", async () => {
    findFirst.mockResolvedValue({ id: "row-1", settings: {}, mode: "concept" });
    const cache = await loadOrgCanvasPromptCache({ conversationId: "row-1", userId: "u", orgId: "o" });
    expect(findFirst.mock.calls[0][0].select.mode).toBe(true);
    expect(cache).toEqual({ rowId: "row-1", cachedConcepts: null, mode: "concept" });
  });

  it("reads a legacy / unknown value as full", async () => {
    findFirst.mockResolvedValue({ id: "row-1", settings: {}, mode: undefined });
    const cache = await loadOrgCanvasPromptCache({ conversationId: "row-1", userId: "u", orgId: "o" });
    expect(cache?.mode).toBe("full");
  });
});

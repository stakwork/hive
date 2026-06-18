/**
 * Unit tests for the milestone rename intercept in OrgCanvasBackground.
 *
 * We test the pure logic inline (the intercept guards and the PATCH
 * call) without mounting the full canvas component.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Inline re-implementation of the intercept guard
// ---------------------------------------------------------------------------

type NodeLike = { id: string; text?: string; customData?: Record<string, unknown> };
type PatchLike = { text?: string; customData?: Record<string, unknown> };

/**
 * Mirrors the guard in `handleNodeUpdate`:
 *   if milestone: + patch.text + initiative: canvasRef → persistMilestoneName
 */
function shouldPersistMilestoneName(
  id: string,
  patch: PatchLike,
  canvasRef: string | undefined,
  prevNode: NodeLike | undefined,
): { should: boolean; milestoneId?: string; initiativeId?: string; name?: string } {
  if (!(id.startsWith("milestone:") && patch.text !== undefined)) {
    return { should: false };
  }
  if (!canvasRef?.startsWith("initiative:")) {
    return { should: false };
  }
  const prevText = (prevNode?.text ?? "").trim();
  const nextText = patch.text.trim();
  if (nextText.length === 0 || nextText === prevText) {
    return { should: false };
  }
  return {
    should: true,
    milestoneId: id.slice("milestone:".length),
    initiativeId: canvasRef.slice("initiative:".length),
    name: nextText,
  };
}

// ---------------------------------------------------------------------------
// Fake persistMilestoneName (matches real PATCH logic)
// ---------------------------------------------------------------------------

async function fakePersistMilestoneName(
  githubLogin: string,
  milestoneId: string,
  initiativeId: string,
  name: string,
  fetchFn: typeof fetch,
) {
  const res = await fetchFn(
    `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return res.ok;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("milestone rename intercept guard (shouldPersistMilestoneName)", () => {
  it("fires for a milestone id with changed text on an initiative canvas", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "New Name" },
      "initiative:init456",
      { id: "milestone:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(true);
    expect(result.milestoneId).toBe("abc123");
    expect(result.initiativeId).toBe("init456");
    expect(result.name).toBe("New Name");
  });

  it("no-op when text is unchanged", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "Same Name" },
      "initiative:init456",
      { id: "milestone:abc123", text: "Same Name" },
    );
    expect(result.should).toBe(false);
  });

  it("no-op when trimmed text is empty", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "   " },
      "initiative:init456",
      { id: "milestone:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(false);
  });

  it("no-op when canvasRef is not an initiative canvas", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "New Name" },
      "ws:workspace1",
      { id: "milestone:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(false);
  });

  it("no-op when canvasRef is undefined", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "New Name" },
      undefined,
      { id: "milestone:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(false);
  });

  it("no-op when id is not a milestone prefix", () => {
    const result = shouldPersistMilestoneName(
      "feature:abc123",
      { text: "New Name" },
      "initiative:init456",
      { id: "feature:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(false);
  });

  it("no-op when patch has no text field", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { customData: { status: "COMPLETED" } },
      "initiative:init456",
      { id: "milestone:abc123", text: "Old Name" },
    );
    expect(result.should).toBe(false);
  });

  it("fires when prevNode is undefined (new node, first text set)", () => {
    const result = shouldPersistMilestoneName(
      "milestone:abc123",
      { text: "First Name" },
      "initiative:init456",
      undefined,
    );
    expect(result.should).toBe(true);
    expect(result.name).toBe("First Name");
  });
});

describe("persistMilestoneName PATCH call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls PATCH with correct URL and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const ok = await fakePersistMilestoneName(
      "testorg",
      "abc123",
      "init456",
      "Renamed Milestone",
      mockFetch as unknown as typeof fetch,
    );
    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/orgs/testorg/initiatives/init456/milestones/abc123",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed Milestone" }),
      }),
    );
  });

  it("returns false when server responds non-ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "Not found" });
    const ok = await fakePersistMilestoneName(
      "testorg",
      "abc123",
      "init456",
      "Renamed",
      mockFetch as unknown as typeof fetch,
    );
    expect(ok).toBe(false);
  });
});

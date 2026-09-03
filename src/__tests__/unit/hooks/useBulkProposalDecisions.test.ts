import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  reconcileBulkSelection,
  useBulkProposalDecisions,
} from "@/app/w/[slug]/learn/hooks/useBulkProposalDecisions";
import type { BulkProposalDecisionResult } from "@/types/concept-proposals";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("reconcileBulkSelection", () => {
  it("drops succeeded ids and keeps still-pending failures", () => {
    const results: BulkProposalDecisionResult[] = [
      { id: "ok", ok: true },
      { id: "stale", ok: false, code: "stale_base" },
      { id: "gone", ok: false, code: "not_found" },
      { id: "decided", ok: false, code: "already_decided" },
      { id: "retry", ok: false, code: "upstream_error" },
      { id: "later", ok: false, code: "not_attempted" },
    ];
    expect(
      reconcileBulkSelection(
        ["ok", "stale", "gone", "decided", "retry", "later"],
        results,
        ["stale", "retry", "later"],
      ),
    ).toEqual(["stale", "retry", "later"]);
  });

  it("prunes retriable failures that vanished from the pending list", () => {
    const results: BulkProposalDecisionResult[] = [
      { id: "stale", ok: false, code: "stale_base" },
    ];
    expect(reconcileBulkSelection(["stale"], results, [])).toEqual([]);
  });
});

describe("useBulkProposalDecisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the batch and returns partial-failure results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { id: "p1", ok: true },
            { id: "p2", ok: false, code: "stale_base", message: "Needs re-review" },
          ],
        }),
    });

    const { result } = renderHook(() => useBulkProposalDecisions("test-ws"));
    let returned: BulkProposalDecisionResult[] | undefined;
    await act(async () => {
      returned = await result.current.submit("accept", ["p1", "p2"]);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/learnings/concepts/proposals/bulk?workspace=test-ws",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "accept", ids: ["p1", "p2"] }),
      }),
    );
    expect(returned).toHaveLength(2);
    expect(result.current.results?.[1].code).toBe("stale_base");
  });

  it("rejects a second concurrent submit while in flight", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result } = renderHook(() => useBulkProposalDecisions("test-ws"));

    let first: Promise<BulkProposalDecisionResult[] | undefined> = Promise.resolve(undefined);
    act(() => {
      first = result.current.submit("accept", ["p1"]);
    });
    expect(result.current.submitting).toBe(true);

    let second: BulkProposalDecisionResult[] | undefined;
    await act(async () => {
      second = await result.current.submit("accept", ["p1"]);
    });
    expect(second).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        ok: true,
        json: () => Promise.resolve({ results: [{ id: "p1", ok: true }] }),
      });
      await first;
    });
  });
});

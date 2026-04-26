/**
 * Unit tests for the feature-canvas refresh helper.
 *
 * Two responsibilities to lock down:
 *   1. The chain `Feature → Milestone → Initiative → Org` resolves the
 *      right canvas refs (root + initiative + milestone) and the right
 *      `githubLogin`.
 *   2. When a feature isn't linked to a milestone, the helper bails
 *      silently — the canvas notifier should not be called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasesUpdatedByLogin: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { notifyCanvasesUpdatedByLogin } from "@/lib/canvas";
import {
  notifyFeatureCanvasRefresh,
  resolveAffectedCanvasRefs,
} from "@/services/roadmap/feature-canvas-notify";

const dbFeature = db.feature as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const notifyMock = notifyCanvasesUpdatedByLogin as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveAffectedCanvasRefs", () => {
  it("resolves the org login and the three affected canvas refs when fully linked", async () => {
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: "m-1",
      milestone: {
        id: "m-1",
        initiativeId: "i-1",
        initiative: {
          id: "i-1",
          org: { githubLogin: "acme" },
        },
      },
    });

    const out = await resolveAffectedCanvasRefs("f-1");
    expect(out).not.toBeNull();
    expect(out?.githubLogin).toBe("acme");
    // Order matters here: root first (initiative rollup), then the
    // initiative timeline, then the milestone sub-canvas.
    expect(out?.refs).toEqual(["", "initiative:i-1", "milestone:m-1"]);
  });

  it("returns null when the feature isn't linked to a milestone", async () => {
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: null,
      milestone: null,
    });
    const out = await resolveAffectedCanvasRefs("f-1");
    expect(out).toBeNull();
  });

  it("returns null when the feature itself isn't found", async () => {
    dbFeature.findUnique.mockResolvedValue(null);
    const out = await resolveAffectedCanvasRefs("missing");
    expect(out).toBeNull();
  });

  it("returns null when the milestone's initiative has no org (data integrity edge)", async () => {
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: "m-1",
      milestone: {
        id: "m-1",
        initiativeId: "i-1",
        initiative: { id: "i-1", org: null },
      },
    });
    const out = await resolveAffectedCanvasRefs("f-1");
    expect(out).toBeNull();
  });
});

describe("notifyFeatureCanvasRefresh", () => {
  it("fires CANVAS_UPDATED on root + initiative + milestone refs when linked", async () => {
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: "m-1",
      milestone: {
        id: "m-1",
        initiativeId: "i-1",
        initiative: { id: "i-1", org: { githubLogin: "acme" } },
      },
    });

    await notifyFeatureCanvasRefresh("f-1", "task-updated", { taskId: "t-1" });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [login, refs, action, detail] = notifyMock.mock.calls[0];
    expect(login).toBe("acme");
    expect(refs).toEqual(["", "initiative:i-1", "milestone:m-1"]);
    expect(action).toBe("task-updated");
    // Caller-supplied detail is merged onto the standard `featureId` field.
    expect(detail).toEqual({ featureId: "f-1", taskId: "t-1" });
  });

  it("does NOT call the notifier when the feature isn't linked to a milestone", async () => {
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: null,
      milestone: null,
    });
    await notifyFeatureCanvasRefresh("f-1");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("swallows notifier errors so caller mutations stay successful", async () => {
    // Pusher outages or transient errors in the notifier must NOT
    // bubble up to the calling task/feature mutation. The whole point
    // of `notifyFeatureCanvasRefresh` being a `void` fire-and-forget
    // is that the canvas refresh is best-effort.
    dbFeature.findUnique.mockResolvedValue({
      milestoneId: "m-1",
      milestone: {
        id: "m-1",
        initiativeId: "i-1",
        initiative: { id: "i-1", org: { githubLogin: "acme" } },
      },
    });
    notifyMock.mockRejectedValueOnce(new Error("pusher is down"));

    // The call must NOT reject. If it does, the test fails.
    await expect(notifyFeatureCanvasRefresh("f-1")).resolves.toBeUndefined();
  });
});

/**
 * Unit tests for the live-PR-nudge helper (`forwardPrUpdate`).
 *
 * Mirrors `forwardArtifactEvent`'s shape (strut-jobs/artifact-events.ts):
 * the export is void-returning and schedules the real async delivery
 * inside next/server's `after()`, falling back to a floating promise
 * when `after()` isn't available (outside a request context) — so the
 * webhook route's call site is a synchronous, never-throwing nudge.
 *
 * Two responsibilities to lock down:
 *   1. The deferred delivery resolves the workspace's org login
 *      (`Workspace.sourceControlOrg.githubLogin`) and fires
 *      `notifyCanvasPrUpdated` with a bare `{ repo, number }` — no
 *      pull-request data.
 *   2. It no-ops quietly (never throws) when the workspace has no
 *      source-control org, or the DB read itself fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockNotify, mockLogger, mockAfter, afterCallbacks } = vi.hoisted(() => {
  const afterCallbacks: Array<() => Promise<void>> = [];
  return {
    mockDb: { workspace: { findUnique: vi.fn() } },
    mockNotify: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockAfter: vi.fn((fn: () => Promise<void>) => void afterCallbacks.push(fn)),
    afterCallbacks,
  };
});

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: mockAfter,
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasPrUpdated: mockNotify }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

import { forwardPrUpdate } from "@/services/pr-live-notify";

const INPUT = { workspaceId: "ws-1", repoFullName: "acme/app", number: 42 };

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
});

describe("forwardPrUpdate", () => {
  it("schedules delivery via next/server's after() rather than running inline", () => {
    mockDb.workspace.findUnique.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme" } });

    forwardPrUpdate(INPUT);

    expect(afterCallbacks).toHaveLength(1);
    expect(mockDb.workspace.findUnique).not.toHaveBeenCalled();
  });

  it("resolves the org login off the workspace and fires notifyCanvasPrUpdated with repo+number only", async () => {
    mockDb.workspace.findUnique.mockResolvedValue({
      sourceControlOrg: { githubLogin: "acme" },
    });

    forwardPrUpdate(INPUT);
    await afterCallbacks[0]();

    expect(mockDb.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith("acme", { repo: "acme/app", number: 42 });
  });

  it("no-ops when the workspace has no source-control org", async () => {
    mockDb.workspace.findUnique.mockResolvedValue({ sourceControlOrg: null });

    forwardPrUpdate({ workspaceId: "ws-2", repoFullName: "acme/app", number: 1 });
    await afterCallbacks[0]();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("no-ops when the workspace is not found", async () => {
    mockDb.workspace.findUnique.mockResolvedValue(null);

    forwardPrUpdate({ workspaceId: "missing", repoFullName: "acme/app", number: 1 });
    await afterCallbacks[0]();

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("delivers after the response and never throws when the DB read fails", async () => {
    mockDb.workspace.findUnique.mockRejectedValueOnce(new Error("db down"));

    forwardPrUpdate({ workspaceId: "ws-3", repoFullName: "acme/app", number: 1 });
    expect(afterCallbacks).toHaveLength(1);

    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "forwardPrUpdate failed (non-fatal)",
      "CANVAS_PR_LIVE_NOTIFY",
      expect.objectContaining({ workspaceId: "ws-3", repoFullName: "acme/app", number: 1, error: "db down" }),
    );
  });

  it("never throws when notifyCanvasPrUpdated itself throws", async () => {
    mockDb.workspace.findUnique.mockResolvedValue({
      sourceControlOrg: { githubLogin: "acme" },
    });
    mockNotify.mockImplementation(() => {
      throw new Error("pusher down");
    });

    forwardPrUpdate({ workspaceId: "ws-4", repoFullName: "acme/app", number: 1 });
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("falls back to a floating promise when after() throws (no request context)", async () => {
    const { after } = await import("next/server");
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error("no request context");
    });
    mockDb.workspace.findUnique.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme" } });

    expect(() => forwardPrUpdate(INPUT)).not.toThrow();
    expect(afterCallbacks).toHaveLength(0);

    // Let the floating promise's microtasks settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNotify).toHaveBeenCalledWith("acme", { repo: "acme/app", number: 42 });
  });
});

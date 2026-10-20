/**
 * Unit tests for `adoptOrchestratorJobRun`'s `liveUpdates`: the row minted
 * for a job the orchestrator started carries the orchestrator row's flag —
 * the job inherited that turn's jobCallback (strut CALLBACKS.md §5) — read
 * from the row when the caller (the settling turn) did not select it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindUnique, mockUpsert, mockWorkspaceFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { strutRun: { findUnique: mockFindUnique, upsert: mockUpsert }, workspace: { findUnique: mockWorkspaceFindUnique } },
}));
vi.mock("@/services/strut-runs", () => ({ hashStrutRunToken: () => "f".repeat(64) }));

import { adoptOrchestratorJobRun } from "@/services/strut-runs/orchestrator-jobs";

const parent = { id: "orch-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1" };
const run = { job: "j-1", runId: "1790000000777", title: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceFindUnique.mockResolvedValue({ slug: "acme" });
  mockUpsert.mockResolvedValue({ id: "jt-1" });
});

describe("adoptOrchestratorJobRun — liveUpdates", () => {
  it("reads the orchestrator row's flag when the caller did not select it", async () => {
    mockFindUnique.mockResolvedValue({ liveUpdates: true });
    await adoptOrchestratorJobRun(parent, run);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "orch-1" }, select: { liveUpdates: true } });
    expect(mockUpsert.mock.calls[0][0].create.liveUpdates).toBe(true);

    mockFindUnique.mockResolvedValue(null);
    await adoptOrchestratorJobRun(parent, run);
    expect(mockUpsert.mock.calls[1][0].create.liveUpdates).toBe(false);
  });

  it("takes the caller's flag without a read", async () => {
    await adoptOrchestratorJobRun({ ...parent, liveUpdates: false }, run);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpsert.mock.calls[0][0].create.liveUpdates).toBe(false);
  });
});

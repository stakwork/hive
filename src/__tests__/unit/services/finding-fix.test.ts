import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    findingFix: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    repository: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/helpers/jarvis-config", () => ({ getJarvisConfigForWorkspace: vi.fn() }));
vi.mock("@/lib/system-map/findings", () => ({ listFindings: vi.fn(), FINDING_NAMESPACE: "infosec" }));
vi.mock("@/services/swarm/api/nodes", () => ({ updateNodeV2: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/service-factory", () => ({ stakworkService: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: vi.fn() }));
vi.mock("@/lib/vercel/stakwork-token", () => ({ getStakworkTokenReference: () => "ref" }));

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings } from "@/lib/system-map/findings";
import { applyFindingFixCallback, startFindingFixes } from "@/services/system-map/finding-fix";

const confirmed = {
  refId: "f1",
  title: "t",
  severity: "high",
  status: null,
  cweId: "CWE-79",
  file: "a.ts",
  line: 1,
  description: null,
  dateAdded: null,
  properties: { finding_status: "confirmed" },
};

describe("startFindingFixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({ jarvisUrl: "u", apiKey: "k" } as never);
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [confirmed], truncated: false } as never);
  });
  const args = { workspaceId: "w", workspaceSlug: "s", userId: "u" };

  it("rejects over-cap batches before touching anything", async () => {
    const refIds = Array.from({ length: 11 }, (_, i) => `f${i}`);
    await expect(startFindingFixes({ ...args, refIds })).rejects.toMatchObject({ status: 400 });
    expect(listFindings).not.toHaveBeenCalled();
  });

  it("refuses findings already being fixed", async () => {
    vi.mocked(db.findingFix.findMany).mockResolvedValue([{ findingRefId: "f1" }] as never);
    const res = await startFindingFixes({ ...args, refIds: ["f1"] });
    expect(res.started).toEqual([]);
    expect(res.refused[0].reason).toMatch(/already in progress/);
    expect(db.findingFix.create).not.toHaveBeenCalled();
  });

  it("refuses unconfirmed findings server-side", async () => {
    vi.mocked(listFindings).mockResolvedValue({
      ok: true,
      findings: [{ ...confirmed, properties: {} }],
      truncated: false,
    } as never);
    vi.mocked(db.findingFix.findMany).mockResolvedValue([] as never);
    const res = await startFindingFixes({ ...args, refIds: ["f1"] });
    expect(res.refused[0].reason).toMatch(/confirmed/);
    expect(db.findingFix.create).not.toHaveBeenCalled();
  });
});

describe("applyFindingFixCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue(null);
  });
  const row = (status: string) => ({ id: "x", workspaceId: "w", findingRefId: "f1", status, prUrl: null });

  it("records the PR url and status", async () => {
    vi.mocked(db.findingFix.findUnique).mockResolvedValue(row("RUNNING") as never);
    vi.mocked(db.findingFix.update).mockResolvedValue({
      ...row("PR_OPENED"),
      prUrl: "https://github.com/a/b/pull/1",
    } as never);
    await applyFindingFixCallback({ fixId: "x", status: "completed", prUrl: "https://github.com/a/b/pull/1" });
    expect(db.findingFix.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { status: "PR_OPENED", prUrl: "https://github.com/a/b/pull/1" },
    });
  });

  it("ignores a late callback on a terminal fix and non-PR urls", async () => {
    vi.mocked(db.findingFix.findUnique).mockResolvedValue(row("PR_OPENED") as never);
    await applyFindingFixCallback({ fixId: "x", status: "failed" });
    expect(db.findingFix.update).not.toHaveBeenCalled();

    vi.mocked(db.findingFix.findUnique).mockResolvedValue(row("RUNNING") as never);
    vi.mocked(db.findingFix.update).mockResolvedValue(row("FAILED") as never);
    await applyFindingFixCallback({ fixId: "x", status: "completed", prUrl: "javascript:x" });
    expect(db.findingFix.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("returns null for unknown fixes", async () => {
    vi.mocked(db.findingFix.findUnique).mockResolvedValue(null);
    expect(await applyFindingFixCallback({ fixId: "x", status: "running" })).toBeNull();
  });
});

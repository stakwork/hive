import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    findingFix: { findMany: vi.fn(), create: vi.fn() },
    strutRun: { findMany: vi.fn() },
    sharedConversation: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    workspace: { findUnique: vi.fn() },
    repository: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/helpers/jarvis-config", () => ({ getJarvisConfigForWorkspace: vi.fn() }));
vi.mock("@/lib/system-map/findings", () => ({ listFindings: vi.fn() }));
vi.mock("@/services/strut-orchestrator", () => ({ launchOrchestratorTurn: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateUserBelongsToOrg: vi.fn() }));

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings } from "@/lib/system-map/findings";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { listLatestFixes, startFindingFixes } from "@/services/system-map/finding-fix";

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
const args = { workspaceId: "w", workspaceSlug: "s", userId: "u" };
const fixRow = { id: "x", findingRefId: "f1", kind: "code_issue", conversationId: "c1", createdAt: new Date() };

describe("startFindingFixes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({ jarvisUrl: "u", apiKey: "k" } as never);
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [confirmed], truncated: false } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      sourceControlOrgId: "o",
      sourceControlOrg: { githubLogin: "acme" },
    } as never);
    vi.mocked(validateUserBelongsToOrg).mockResolvedValue(true);
    vi.mocked(db.findingFix.findMany).mockResolvedValue([] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([] as never);
    vi.mocked(db.repository.findMany).mockResolvedValue([{ repositoryUrl: "https://github.com/acme/api" }] as never);
    vi.mocked(db.sharedConversation.create).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(db.findingFix.create).mockResolvedValue(fixRow as never);
    vi.mocked(db.sharedConversation.delete).mockResolvedValue({} as never);
    vi.mocked(db.sharedConversation.findMany).mockResolvedValue([] as never);
  });

  it("rejects over-cap batches before touching anything", async () => {
    const refIds = Array.from({ length: 11 }, (_, i) => `f${i}`);
    await expect(startFindingFixes({ ...args, refIds })).rejects.toMatchObject({ status: 400 });
    expect(listFindings).not.toHaveBeenCalled();
  });

  it("requires org membership", async () => {
    vi.mocked(validateUserBelongsToOrg).mockResolvedValue(false);
    await expect(startFindingFixes({ ...args, refIds: ["f1"] })).rejects.toMatchObject({ status: 403 });
  });

  it("seeds a conversation and launches the orchestrator turn", async () => {
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "started", runId: "r", strutRunId: "sr" });
    const res = await startFindingFixes({ ...args, refIds: ["f1"], publicBaseUrl: "https://hive" });
    expect(launchOrchestratorTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u",
        orgId: "o",
        conversationId: "c1",
        publicBaseUrl: "https://hive",
        message: expect.stringContaining('start_job tool with workspace "s"'),
      }),
    );
    expect(db.sharedConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: "org-canvas", sourceControlOrgId: "o", workspaceId: null }),
      }),
    );
    expect(db.findingFix.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findingRefId: "f1",
        conversationId: "c1",
        repositoryUrl: "https://github.com/acme/api",
      }),
    });
    expect(res.started).toHaveLength(1);
    expect(res.started[0]).toMatchObject({ status: "QUEUED", chatPath: "/org/acme?chat=c1" });
  });

  it("drops the conversation and refuses when strut will not take the turn", async () => {
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "error", error: "no strut" });
    const res = await startFindingFixes({ ...args, refIds: ["f1"] });
    expect(db.sharedConversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(db.findingFix.create).not.toHaveBeenCalled();
    expect(res.refused).toEqual([{ refId: "f1", reason: "no strut" }]);
  });

  it("refuses findings whose fix is queued or running", async () => {
    vi.mocked(db.findingFix.findMany).mockResolvedValue([fixRow] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([
      { conversationId: "c1", kind: "job_turn", status: "PENDING", error: null },
    ] as never);
    const res = await startFindingFixes({ ...args, refIds: ["f1"] });
    expect(res.refused[0].reason).toMatch(/already in progress/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
  });

  it("allows a retry after a failed fix", async () => {
    vi.mocked(db.findingFix.findMany).mockResolvedValue([fixRow] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([
      { conversationId: "c1", kind: "job_turn", status: "ERROR", error: "x" },
    ] as never);
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "started", runId: "r", strutRunId: "sr" });
    expect((await startFindingFixes({ ...args, refIds: ["f1"] })).started).toHaveLength(1);
  });

  it("refuses unconfirmed findings server-side", async () => {
    vi.mocked(listFindings).mockResolvedValue({
      ok: true,
      findings: [{ ...confirmed, properties: {} }],
      truncated: false,
    } as never);
    const res = await startFindingFixes({ ...args, refIds: ["f1"] });
    expect(res.refused[0].reason).toMatch(/confirmed/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
    expect(db.sharedConversation.create).not.toHaveBeenCalled();
  });
});

describe("listLatestFixes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ sourceControlOrg: { githubLogin: "acme" } } as never);
  });

  it("reads status and PR from the conversation's strut runs and rows", async () => {
    vi.mocked(db.findingFix.findMany).mockResolvedValue([
      fixRow,
      { ...fixRow, id: "old", conversationId: "c0", createdAt: new Date(0) },
    ] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([
      { conversationId: "c1", kind: "job_turn", status: "SUCCESS", error: null },
    ] as never);
    vi.mocked(db.sharedConversation.findMany).mockResolvedValue([
      {
        id: "c1",
        messages: [
          {
            id: "job-1",
            artifacts: [{ kind: "pull_request", source: { content: { url: "https://github.com/a/b/pull/3" } } }],
          },
        ],
      },
    ] as never);
    const fixes = await listLatestFixes("w");
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      status: "PR_OPENED",
      prUrl: "https://github.com/a/b/pull/3",
      chatPath: "/org/acme?chat=c1",
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    strutRun: { findMany: vi.fn() },
    sharedConversation: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    workspace: { findUnique: vi.fn() },
    repository: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/helpers/jarvis-config", () => ({ getJarvisConfigForWorkspace: vi.fn() }));
vi.mock("@/lib/system-map/findings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/system-map/findings")>("@/lib/system-map/findings");
  return { ...actual, listFindings: vi.fn() };
});
vi.mock("@/services/strut-orchestrator", () => ({ launchOrchestratorTurn: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateUserBelongsToOrg: vi.fn() }));
vi.mock("@/services/swarm/api/nodes", () => ({ readNodeByRef: vi.fn(), updateNodeV2: vi.fn() }));

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listFindings, parseFinding } from "@/lib/system-map/findings";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { deriveFixes, listFixes, startFindingFixes } from "@/services/system-map/finding-fix";

const REF = "f1";
const baseProps: Record<string, unknown> = {
  title: "t",
  severity: "high",
  cwe_id: "CWE-79",
  file: "a.ts",
  line: 1,
  finding_status: "confirmed",
};
const finding = (extra: Record<string, unknown> = {}, base = baseProps) =>
  parseFinding({ ref_id: REF, node_type: "Finding", properties: { ...base, ...extra } })!;
const args = { workspaceId: "w", workspaceSlug: "s", userId: "u" };
const NOW = new Date().toISOString();

/** Node store behind readNodeByRef / updateNodeV2, so marks are read back as written. */
function fakeNode(initial: Record<string, unknown> = baseProps) {
  let props = { ...initial };
  vi.mocked(readNodeByRef).mockImplementation(
    async () => ({ success: true, ref_id: REF, node_type: "Finding", properties: { ...props } }) as never,
  );
  vi.mocked(updateNodeV2).mockImplementation(async (_c, _r, data) => {
    props = { ...props, ...data };
    return { success: true } as never;
  });
  return { props: () => props };
}

describe("startFindingFixes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({ jarvisUrl: "u", apiKey: "k" } as never);
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [finding()], truncated: false } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      sourceControlOrgId: "o",
      sourceControlOrg: { githubLogin: "acme" },
    } as never);
    vi.mocked(validateUserBelongsToOrg).mockResolvedValue(true);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([] as never);
    vi.mocked(db.sharedConversation.findMany).mockResolvedValue([] as never);
    vi.mocked(db.repository.findMany).mockResolvedValue([{ repositoryUrl: "https://github.com/acme/api" }] as never);
    vi.mocked(db.sharedConversation.create).mockResolvedValue({ id: "c1" } as never);
    vi.mocked(db.sharedConversation.delete).mockResolvedValue({} as never);
  });

  it("rejects over-cap batches before touching anything", async () => {
    const refIds = Array.from({ length: 11 }, (_, i) => `f${i}`);
    await expect(startFindingFixes({ ...args, refIds })).rejects.toMatchObject({ status: 400 });
    expect(listFindings).not.toHaveBeenCalled();
  });

  it("requires org membership", async () => {
    vi.mocked(validateUserBelongsToOrg).mockResolvedValue(false);
    await expect(startFindingFixes({ ...args, refIds: [REF] })).rejects.toMatchObject({ status: 403 });
  });

  it("marks launching, launches the strut, then records the conversation on the node", async () => {
    const node = fakeNode();
    vi.mocked(launchOrchestratorTurn).mockImplementation(async () => {
      expect(node.props()).toMatchObject({
        fix_state: "launching",
        fix_started_by: "u",
        fix_repo: "https://github.com/acme/api",
      });
      return { status: "started", runId: "r", strutRunId: "sr" };
    });
    const res = await startFindingFixes({ ...args, refIds: [REF], publicBaseUrl: "https://hive" });
    expect(launchOrchestratorTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "o",
        conversationId: "c1",
        publicBaseUrl: "https://hive",
        message: expect.stringContaining('start_job tool with workspace "s"'),
      }),
    );
    expect(node.props()).toMatchObject({ fix_state: "launched", fix_conversation_id: "c1", fix_kind: "code_issue" });
    expect(vi.mocked(updateNodeV2).mock.calls.every((c) => c[3] === "infosec")).toBe(true);
    expect(res.started).toEqual([
      expect.objectContaining({ findingRefId: REF, status: "QUEUED", chatPath: "/org/acme?chat=c1" }),
    ]);
  });

  it("rolls the marks back and drops the conversation when strut refuses", async () => {
    const node = fakeNode();
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "error", error: "no strut" });
    const res = await startFindingFixes({ ...args, refIds: [REF] });
    expect(db.sharedConversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(node.props()).toMatchObject({ fix_state: "", fix_conversation_id: "", fix_started_at: "" });
    expect(res.refused).toEqual([{ refId: REF, reason: "no strut" }]);
  });

  it("rolls back when the launch throws", async () => {
    const node = fakeNode();
    vi.mocked(launchOrchestratorTurn).mockRejectedValue(new Error("boom"));
    const res = await startFindingFixes({ ...args, refIds: [REF] });
    expect(node.props()).toMatchObject({ fix_state: "" });
    expect(res.started).toEqual([]);
    expect(res.refused).toHaveLength(1);
  });

  it("refuses when the fresh node is already launching (race), without launching", async () => {
    fakeNode({ ...baseProps, fix_state: "launching", fix_started_at: NOW, fix_started_by: "other" });
    const res = await startFindingFixes({ ...args, refIds: [REF] });
    expect(res.refused[0].reason).toMatch(/already in progress/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  it("refuses when another launch overwrites the mark", async () => {
    const node = fakeNode();
    vi.mocked(updateNodeV2).mockImplementation(async (_c, _r, data) => {
      // our write lands, then a competitor's replaces it
      void data;
      node.props().fix_started_by = "other";
      return { success: true } as never;
    });
    const res = await startFindingFixes({ ...args, refIds: [REF] });
    expect(res.refused[0].reason).toMatch(/already in progress/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
  });

  it("treats a stale launching mark as expired", async () => {
    fakeNode({ ...baseProps, fix_state: "launching", fix_started_at: "2020-01-01T00:00:00.000Z", fix_started_by: "x" });
    vi.mocked(listFindings).mockResolvedValue({
      ok: true,
      findings: [finding({ fix_state: "launching", fix_started_at: "2020-01-01T00:00:00.000Z" })],
      truncated: false,
    } as never);
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "started", runId: "r", strutRunId: "sr" });
    expect((await startFindingFixes({ ...args, refIds: [REF] })).started).toHaveLength(1);
  });

  it("refuses findings whose conversation still has a pending run", async () => {
    const tracked = { fix_state: "launched", fix_conversation_id: "c0", fix_started_at: NOW };
    fakeNode({ ...baseProps, ...tracked });
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [finding(tracked)], truncated: false } as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([
      { conversationId: "c0", kind: "job_turn", status: "PENDING", error: null },
    ] as never);
    const res = await startFindingFixes({ ...args, refIds: [REF] });
    expect(res.refused[0].reason).toMatch(/already in progress/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
  });

  it("allows a retry after a failed fix", async () => {
    const tracked = { fix_state: "launched", fix_conversation_id: "c0", fix_started_at: NOW };
    fakeNode({ ...baseProps, ...tracked });
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [finding(tracked)], truncated: false } as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([
      { conversationId: "c0", kind: "job_turn", status: "ERROR", error: "x" },
    ] as never);
    vi.mocked(launchOrchestratorTurn).mockResolvedValue({ status: "started", runId: "r", strutRunId: "sr" });
    expect((await startFindingFixes({ ...args, refIds: [REF] })).started).toHaveLength(1);
  });

  it("refuses unconfirmed findings server-side, including a verdict changed since the list", async () => {
    const unconfirmed = { ...baseProps, finding_status: "disconfirmed" };
    vi.mocked(listFindings).mockResolvedValue({
      ok: true,
      findings: [finding({}, unconfirmed)],
      truncated: false,
    } as never);
    fakeNode(unconfirmed);
    expect((await startFindingFixes({ ...args, refIds: [REF] })).refused[0].reason).toMatch(/confirmed/);

    fakeNode(unconfirmed); // list says confirmed, node says otherwise
    vi.mocked(listFindings).mockResolvedValue({ ok: true, findings: [finding()], truncated: false } as never);
    expect((await startFindingFixes({ ...args, refIds: [REF] })).refused[0].reason).toMatch(/confirmed/);
    expect(launchOrchestratorTurn).not.toHaveBeenCalled();
    expect(db.sharedConversation.create).not.toHaveBeenCalled();
  });
});

describe("deriveFixes / listFixes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.strutRun.findMany).mockResolvedValue([] as never);
    vi.mocked(db.sharedConversation.findMany).mockResolvedValue([] as never);
  });

  it("reads status and PR from the conversation's strut runs and rows", async () => {
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
    const fixes = await deriveFixes(
      [
        finding({ fix_state: "launched", fix_conversation_id: "c1", fix_kind: "code_issue", fix_started_at: NOW }),
        finding({}, { ...baseProps }),
      ],
      "acme",
    );
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      status: "PR_OPENED",
      prUrl: "https://github.com/a/b/pull/3",
      chatPath: "/org/acme?chat=c1",
    });
  });

  it("shows a fresh launching mark as queued and ignores an expired one", async () => {
    const fresh = finding({ fix_state: "launching", fix_started_at: NOW });
    const stale = finding({ fix_state: "launching", fix_started_at: "2020-01-01T00:00:00.000Z" });
    expect((await deriveFixes([fresh], null))[0]).toMatchObject({ status: "QUEUED", chatPath: null });
    expect(await deriveFixes([stale], null)).toEqual([]);
  });

  it("listFixes reads findings from the graph", async () => {
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({ jarvisUrl: "u", apiKey: "k" } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ sourceControlOrg: { githubLogin: "acme" } } as never);
    vi.mocked(listFindings).mockResolvedValue({
      ok: true,
      findings: [finding({ fix_state: "launched", fix_conversation_id: "c1", fix_started_at: NOW })],
      truncated: false,
    } as never);
    expect(await listFixes("w")).toHaveLength(1);
  });
});

/**
 * Unit tests for `services/strut-proposals.ts` — reading and deciding a
 * strut proposal from hive, scoped by the proposing turn's row.
 *
 *   - access: the caller must be in the org, the turn's conversation theirs
 *     or shared, the row an orchestrator turn — every miss a 404;
 *   - read: `GET {lab}/proposals/:id` on the ROW's swarm, the record
 *     sanitised (actor / principal dropped, workspace slug added), and
 *     refused unless strut names THIS run as the proposer;
 *   - decide: `POST {lab}/proposals/:id/decide` with `x-api-token` and the
 *     CLICKING user's `x-strut-actor`, the body `{ action, reason? }`; 200
 *     → the record; 409 → the record as it stands; 400 → strut's reason;
 *   - the result row: "Applied: <title>" / "Rejected: <title>" / "Failed:
 *     <title> — <error>".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockResolveAuthorizedOrgId,
  mockStrutRunFindFirst,
  mockWorkspaceFindFirst,
  mockResolveConversation,
  mockLab,
  mockResolveActor,
  mockAppendRows,
} = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockStrutRunFindFirst: vi.fn(),
  mockWorkspaceFindFirst: vi.fn(),
  mockResolveConversation: vi.fn(),
  mockLab: vi.fn(),
  mockResolveActor: vi.fn(),
  mockAppendRows: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/db", () => ({
  db: { strutRun: { findFirst: mockStrutRunFindFirst }, workspace: { findFirst: mockWorkspaceFindFirst } },
}));
vi.mock("@/services/org-canvas-conversation", () => ({ resolveOrgConversationRowId: mockResolveConversation }));
vi.mock("@/services/strut-runs", () => ({ labForRow: mockLab }));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  STRUT_ACTOR_HEADER: "x-strut-actor",
  resolveStrutActor: mockResolveActor,
}));
vi.mock("@/services/strut-runs/orchestrator-turn", () => ({ appendOrchestratorRows: mockAppendRows }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  StrutProposalError,
  appendProposalResultRow,
  decideStrutProposal,
  readStrutProposal,
  renderProposalResult,
  resolveProposalTurn,
  type ProposalTurnRow,
} from "@/services/strut-proposals";

const mockFetch = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const DB_ROW = {
  id: "row-1",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  userId: "user-1",
  workflow: "orchestrator",
  strutRunId: "1790000000000",
  conversationId: "conv-1",
  status: "SUCCESS",
};
const TURN: ProposalTurnRow = {
  id: "row-1",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  userId: "user-1",
  workflow: "orchestrator",
  strutRunId: "1790000000000",
  conversationId: "conv-1",
  workspaceSlug: "acme",
};
const RECORD = {
  id: "p1",
  step: "graph/create-node",
  input: { node_type: "Concept", node_data: { name: "Retries" } },
  rationale: "Missing.",
  title: "Create a node.",
  status: "pending",
  createdAt: "2026-10-19T13:02:30Z",
  by: {
    workflow: "orchestrator",
    runId: "1790000000000",
    path: "orchestrator/turn",
    session: "conv-1",
    actor: "alice-user-1",
    principal: "secret-principal",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockStrutRunFindFirst.mockResolvedValue(DB_ROW);
  mockWorkspaceFindFirst.mockResolvedValue({ slug: "acme" });
  mockResolveConversation.mockResolvedValue("conv-1");
  mockLab.mockResolvedValue({
    labBase: "https://swarm1.sphinx.chat:3355/lab",
    swarmApiKey: "swarm-key",
    swarmName: "swarm1",
  });
  mockResolveActor.mockResolvedValue("bob-user-2");
  mockAppendRows.mockResolvedValue({ appended: ["x"], duplicate: [], skipped: false });
  mockFetch.mockResolvedValue(json(200, RECORD));
});

describe("resolveProposalTurn", () => {
  it("the turn's row, for a member who can read its conversation", async () => {
    expect(await resolveProposalTurn({ githubLogin: "acme-gh", userId: "user-2", runId: "row-1" })).toEqual(TURN);
    expect(mockResolveAuthorizedOrgId).toHaveBeenCalledWith("acme-gh", "user-2", false);
    expect(mockStrutRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-1", kind: "orchestrator_turn" } }),
    );
    expect(mockResolveConversation).toHaveBeenCalledWith({
      conversationId: "conv-1",
      userId: "user-2",
      orgId: "org-1",
    });
  });

  it("404 for a non-member, an unknown row, another org's row, a conversation not theirs, a turn still pending", async () => {
    const expect404 = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ status: 404 });
    mockResolveAuthorizedOrgId.mockResolvedValueOnce(null);
    await expect404(resolveProposalTurn({ githubLogin: "acme-gh", userId: "u", runId: "row-1" }));
    mockStrutRunFindFirst.mockResolvedValueOnce(null);
    await expect404(resolveProposalTurn({ githubLogin: "acme-gh", userId: "u", runId: "row-1" }));
    mockWorkspaceFindFirst.mockResolvedValueOnce(null); // the launch's workspace is another org's
    await expect404(resolveProposalTurn({ githubLogin: "acme-gh", userId: "u", runId: "row-1" }));
    mockResolveConversation.mockResolvedValueOnce(null);
    await expect404(resolveProposalTurn({ githubLogin: "acme-gh", userId: "u", runId: "row-1" }));
    mockStrutRunFindFirst.mockResolvedValueOnce({ ...DB_ROW, status: "PENDING" });
    await expect404(resolveProposalTurn({ githubLogin: "acme-gh", userId: "u", runId: "row-1" }));
  });
});

describe("readStrutProposal", () => {
  it("reads the record from the ROW's swarm and hands back the sanitised form", async () => {
    const out = await readStrutProposal(TURN, "p1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://swarm1.sphinx.chat:3355/lab/proposals/p1",
      expect.objectContaining({ headers: { "x-api-token": "swarm-key" } }),
    );
    expect(out).toEqual({
      id: "p1",
      step: "graph/create-node",
      input: { node_type: "Concept", node_data: { name: "Retries" } },
      rationale: "Missing.",
      title: "Create a node.",
      status: "pending",
      createdAt: "2026-10-19T13:02:30Z",
      by: { workflow: "orchestrator", runId: "1790000000000", path: "orchestrator/turn", session: "conv-1" },
      workspaceSlug: "acme",
    });
    expect(JSON.stringify(out)).not.toContain("secret-principal");
    expect(JSON.stringify(out)).not.toContain("alice-user-1");
  });

  it("a record another run proposed is not this run's (null); 404 is null; strut down is a 502", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { ...RECORD, by: { ...RECORD.by, runId: "other-run" } }));
    expect(await readStrutProposal(TURN, "p1")).toBeNull();
    mockFetch.mockResolvedValueOnce(json(404, {}));
    expect(await readStrutProposal(TURN, "p1")).toBeNull();
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(readStrutProposal(TURN, "p1")).rejects.toBeInstanceOf(StrutProposalError);
  });
});

describe("decideStrutProposal", () => {
  it("forwards the decision as the CLICKING user and hands back the record after it", async () => {
    const applied = {
      ...RECORD,
      status: "applied",
      decision: { action: "accept", by: "bob-user-2", at: "2026-10-19T13:05:00Z" },
      result: { output: { ref_id: "n1" }, at: "2026-10-19T13:05:01Z" },
    };
    mockFetch.mockResolvedValueOnce(json(200, RECORD)).mockResolvedValueOnce(json(200, applied));
    const out = await decideStrutProposal(TURN, "p1", { action: "accept" }, "user-2");
    expect(mockResolveActor).toHaveBeenCalledWith("user-2");
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://swarm1.sphinx.chat:3355/lab/proposals/p1/decide");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-token": "swarm-key",
      "x-strut-actor": "bob-user-2",
    });
    expect(JSON.parse(init.body as string)).toEqual({ action: "accept" });
    expect(out).toEqual({
      status: 200,
      proposal: expect.objectContaining({
        id: "p1",
        status: "applied",
        decision: { action: "accept", by: "bob-user-2", at: "2026-10-19T13:05:00Z" },
        result: { output: { ref_id: "n1" }, at: "2026-10-19T13:05:01Z" },
      }),
    });
  });

  it("a rejection carries its reason; 409 hands back strut's record; 400 strut's reason; another run's proposal is 404", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, RECORD))
      .mockResolvedValueOnce(json(200, { ...RECORD, status: "rejected" }));
    await decideStrutProposal(TURN, "p1", { action: "reject", reason: "Wrong parent." }, "user-2");
    expect(JSON.parse((mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({
      action: "reject",
      reason: "Wrong parent.",
    });

    mockFetch
      .mockResolvedValueOnce(json(200, RECORD))
      .mockResolvedValueOnce(json(409, { error: "already decided", proposal: { ...RECORD, status: "applied" } }));
    expect(await decideStrutProposal(TURN, "p1", { action: "accept" }, "user-2")).toEqual({
      status: 409,
      error: "already decided",
      proposal: expect.objectContaining({ status: "applied" }),
    });

    mockFetch
      .mockResolvedValueOnce(json(200, RECORD))
      .mockResolvedValueOnce(json(400, { error: "input does not fit the step's schema" }));
    expect(await decideStrutProposal(TURN, "p1", { action: "accept", input: { node_type: 7 } }, "user-2")).toEqual({
      status: 400,
      error: "input does not fit the step's schema",
    });

    mockFetch.mockResolvedValueOnce(json(200, { ...RECORD, by: { ...RECORD.by, runId: "other" } }));
    expect(await decideStrutProposal(TURN, "p1", { action: "accept" }, "user-2")).toEqual({
      status: 404,
      error: "Not found",
    });
    expect(mockFetch).toHaveBeenCalledTimes(7);
  });
});

describe("the result row", () => {
  it("says what happened", () => {
    expect(renderProposalResult("Create a node.", "applied")).toBe("Applied: Create a node.");
    expect(renderProposalResult("Create a node.", "rejected")).toBe("Rejected: Create a node.");
    expect(renderProposalResult("Create a node.", "failed", "schema mismatch")).toBe(
      "Failed: Create a node. — schema mismatch",
    );
  });

  it("is appended into the turn's conversation with the turn rows' discipline", async () => {
    await appendProposalResultRow(TURN, {
      ...RECORD,
      status: "applied",
      by: { workflow: "orchestrator", runId: "1790000000000" },
      workspaceSlug: "acme",
    } as never);
    expect(mockAppendRows).toHaveBeenCalledWith({ workspaceId: "ws-1", userId: "user-1", conversationId: "conv-1" }, [
      expect.objectContaining({
        id: expect.stringMatching(/^orchestrator-row-1-proposal-p1-applied-/),
        content: "Applied: Create a node.",
        source: {
          kind: "proposal_result",
          runId: "row-1",
          proposalId: "p1",
          status: "applied",
          title: "Create a node.",
        },
      }),
    ]);
  });
});

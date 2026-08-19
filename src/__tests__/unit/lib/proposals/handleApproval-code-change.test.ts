/**
 * Unit tests for `approveCodeChange` in handleApproval.ts.
 *
 * The theme of every case here: the transcript in `args.messages` is the
 * request body and must never be the source of anything that reaches the
 * swarm. The stored conversation row is.
 *
 *  1. The diff dispatched to `createPr` comes from the STORED transcript,
 *     not from the caller-supplied one, even when both carry a self-consistent
 *     `diff` + `diffSha256` pair.
 *  2. A stored diff that fails `enforceDiffCaps` / `scanForSecrets` is refused
 *     before the claim is inserted and before any dispatch.
 *  3. Only the originator may approve; a proposal with no `originatorUserId`
 *     fails closed.
 *  4. The dispatch receipt is written onto the claim Task via `onDispatch`,
 *     enriched with the conversation/proposal ids the webhook path needs.
 *  5. Re-approving a claim that has a receipt but no PR artifact reconciles
 *     instead of dead-ending, and never re-dispatches.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockFetchStored,
  mockCreatePr,
  mockReconcilePr,
  mockValidateWsAccess,
  mockCheckRateLimit,
  mockAddPrLabels,
} = vi.hoisted(() => ({
  mockFetchStored: vi.fn(),
  mockCreatePr: vi.fn(),
  mockReconcilePr: vi.fn(),
  mockValidateWsAccess: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAddPrLabels: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    repository: { findFirst: vi.fn() },
    task: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    chatMessage: { create: vi.fn(), findFirst: vi.fn() },
    artifact: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/services/org-canvas-conversation", () => ({
  fetchOrgCanvasConversationMessages: mockFetchStored,
}));
vi.mock("@/services/swarm/createPr", () => ({
  createPr: mockCreatePr,
  reconcilePr: mockReconcilePr,
  _processCompletedResult: vi.fn(),
  extractFilePaths: vi.fn(() => new Set<string>()),
}));
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: mockValidateWsAccess,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      encryptField: vi.fn((_f: string, v: string) => ({ data: `enc:${v}` })),
      decryptField: vi.fn((_f: string, v: string) => String(v)),
    }),
  },
}));
vi.mock("@/services/canvas-turn-persistence", () => ({
  patchStoredCodeChangeResult: vi.fn(),
  appendTurnMessages: vi.fn(),
}));
vi.mock("@/lib/github/labels", () => ({ addPrLabels: mockAddPrLabels }));
vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(),
  setLivePosition: vi.fn(),
  featureProjectsOn: vi.fn(),
  mostSpecificRef: vi.fn(),
  readAssignedFeatures: vi.fn(),
  resolvePlacement: vi.fn().mockReturnValue(null),
  findFreeSlotInViewport: vi.fn().mockReturnValue(null),
  notifyFeatureReassignmentRefresh: vi.fn(),
  ROOT_REF: "",
}));
vi.mock("@/lib/canvas/io", () => ({ readCanvas: vi.fn() }));
vi.mock("@/services/roadmap", () => ({ createFeature: vi.fn() }));
vi.mock("@/services/roadmap/feature-dependency", () => ({
  detectFeatureDependencyCycle: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/services/roadmap/feature-chat", () => ({ sendFeatureChatMessage: vi.fn() }));
vi.mock("@/lib/mcp/mcpTools", () => ({ mcpCreatePrompt: vi.fn(), mcpUpdatePrompt: vi.fn() }));
vi.mock("@/lib/helpers/swarm-access", () => ({ getSwarmAccessByWorkspaceId: vi.fn() }));
vi.mock("@/lib/ai/graphWriteAuth", () => ({
  resolveGraphJarvis: vi.fn(),
  GRAPH_JARVIS_ACCESS_DENIED: "denied",
}));
vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: vi.fn(),
  updateNodeV2: vi.fn(),
  addEdgeV2: vi.fn(),
  readNodeByRef: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Imports ────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { handleApproval, type MessageLike } from "@/lib/proposals/handleApproval";
import { PROPOSE_CODE_CHANGE_TOOL } from "@/lib/proposals/types";
import { db } from "@/lib/db";

// ── Fixtures ───────────────────────────────────────────────────────────────
const ORG_ID = "org-001";
const USER_ID = "user-001";
const OTHER_USER_ID = "user-002";
const WS_ID = "ws-001";
const WS_SLUG = "my-workspace";
const REPO_URL = "https://github.com/acme/widgets";
const PROPOSAL_ID = "prop-cc-1";
const CONVERSATION_ID = "conv-1";
const CLAIM_TASK_ID = "task-claim-1";
const SEED_MSG_ID = "msg-seed-1";

const APPROVED_DIFF = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "",
].join("\n");

const FORGED_DIFF = [
  "--- a/prisma/schema.prisma",
  "+++ b/prisma/schema.prisma",
  "@@ -1,2 +1,2 @@",
  " model Task {",
  "-  id String @id",
  "+  id String @id @default(cuid())",
  "",
].join("\n");

const sha = (t: string) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

function codeChangeOutput(overrides: Record<string, unknown> = {}) {
  const diff = (overrides.diff as string) ?? APPROVED_DIFF;
  return {
    kind: "codeChange",
    proposalId: PROPOSAL_ID,
    originatorUserId: USER_ID,
    payload: {
      workspaceId: WS_ID,
      workspaceSlug: WS_SLUG,
      repositoryUrl: REPO_URL,
      title: "Bump b",
      body: "body",
      diff,
      // Always self-consistent — that is the whole point: a forged payload
      // passes `createPr`'s own integrity check.
      diffSha256: sha(diff),
      filesChanged: 1,
    },
    meta: { repoName: "acme/widgets" },
    ...overrides,
  };
}

function msg(output: unknown): MessageLike {
  return {
    role: "assistant",
    toolCalls: [{ toolName: PROPOSE_CODE_CHANGE_TOOL, output }],
  } as MessageLike;
}

// Dispatch-and-return: `createPr` resolves as soon as the swarm accepts
// the run — the PR itself arrives later on the webhook.
const PR_DISPATCHED = {
  ok: true as const,
  dispatched: true as const,
  requestId: "req-1",
  prBranch: "swarm/swarm-change-abcd1234",
};

const PUBLIC_BASE_URL = "https://hive.example.com";

function approve(messages: MessageLike[], userId = USER_ID) {
  return handleApproval({
    orgId: ORG_ID,
    userId,
    messages,
    intent: { proposalId: PROPOSAL_ID },
    conversationId: CONVERSATION_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
  } as Parameters<typeof handleApproval>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();

  mockValidateWsAccess.mockResolvedValue({ hasAccess: true, canWrite: true });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockCreatePr.mockResolvedValue(PR_DISPATCHED);
  mockAddPrLabels.mockResolvedValue(undefined);

  vi.mocked(db.repository.findFirst).mockResolvedValue({ id: "repo-1" } as never);
  vi.mocked(db.workspace.findFirst).mockResolvedValue({
    sourceControlOrg: { id: ORG_ID },
  } as never);

  // The claim transaction: run the callback against the mocked tx client.
  vi.mocked(db.$transaction).mockImplementation(async (arg: unknown) => {
    if (typeof arg !== "function") return undefined as never;
    const tx = {
      task: {
        create: vi.fn().mockResolvedValue({ id: CLAIM_TASK_ID }),
        update: vi.fn().mockResolvedValue({}),
      },
      chatMessage: { create: vi.fn().mockResolvedValue({ id: SEED_MSG_ID }) },
      artifact: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
    };
    return (arg as (t: unknown) => Promise<unknown>)(tx) as never;
  });
  vi.mocked(db.task.update).mockResolvedValue({} as never);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("approveCodeChange — payload is bound to the stored transcript", () => {
  it("dispatches the STORED diff when the caller's transcript carries a different one", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    // Caller submits a self-consistent but entirely different payload.
    const forged = codeChangeOutput({ diff: FORGED_DIFF, title: "Sneaky" });
    const res = await approve([msg(forged)]);

    expect(res.ok).toBe(true);
    expect(mockCreatePr).toHaveBeenCalledTimes(1);
    const dispatched = mockCreatePr.mock.calls[0][0];
    expect(dispatched.approvedDiff).toBe(APPROVED_DIFF);
    expect(dispatched.diffSha256).toBe(sha(APPROVED_DIFF));
    expect(dispatched.title).toBe("Bump b");
    // The forged bytes never reach the swarm.
    expect(dispatched.approvedDiff).not.toContain("prisma/schema.prisma");
  });

  it("refuses when the proposalId is absent from the stored conversation", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput({ proposalId: "other" }))]);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(403);
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("refuses a stored diff containing a credential, before any claim or dispatch", async () => {
    const secretDiff = [
      "--- a/.env",
      "+++ b/.env",
      "@@ -1 +1,2 @@",
      " X=1",
      "+AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "",
    ].join("\n");
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput({ diff: secretDiff }))]);

    const res = await approve([msg(codeChangeOutput({ diff: secretDiff }))]);

    expect(res.ok).toBe(false);
    expect(mockCreatePr).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a stored diff over the file cap, before any claim or dispatch", async () => {
    const huge = Array.from({ length: 60 }, (_, i) =>
      [`--- a/f${i}.ts`, `+++ b/f${i}.ts`, "@@ -1 +1 @@", "-a", "+b"].join("\n"),
    ).join("\n");
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput({ diff: huge }))]);

    const res = await approve([msg(codeChangeOutput({ diff: huge }))]);

    expect(res.ok).toBe(false);
    expect(mockCreatePr).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("approveCodeChange — originator guard", () => {
  it("refuses a different org member in the same shared room", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    const res = await approve([msg(codeChangeOutput())], OTHER_USER_ID);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(403);
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("ignores an originatorUserId forged onto the caller's transcript", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    // Caller claims to be the originator in their own copy.
    const res = await approve(
      [msg(codeChangeOutput({ originatorUserId: OTHER_USER_ID }))],
      OTHER_USER_ID,
    );

    expect(res.ok).toBe(false);
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("fails closed when the stored proposal has no originatorUserId", async () => {
    const legacy = codeChangeOutput();
    delete (legacy as Record<string, unknown>).originatorUserId;
    mockFetchStored.mockResolvedValue([msg(legacy)]);

    const res = await approve([msg(legacy)]);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(403);
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("allows the originator", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    expect(mockCreatePr).toHaveBeenCalledTimes(1);
  });
});

describe("approveCodeChange — dispatch receipt", () => {
  it("writes the claim onto the Task via onDispatch, enriched with conversation/proposal ids", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    let receiptWrittenBeforeReturn = false;
    mockCreatePr.mockImplementation(async (p: Record<string, unknown>) => {
      const onDispatch = p.onDispatch as (c: unknown) => Promise<void>;
      await onDispatch({
        requestId: "req-1",
        repositoryUrl: REPO_URL,
        userId: USER_ID,
        workspaceSlug: WS_SLUG,
        prBranch: "swarm/swarm-change-abcd1234",
        approvedPaths: ["src/a.ts"],
      });
      receiptWrittenBeforeReturn = vi.mocked(db.task.update).mock.calls.length > 0;
      return PR_DISPATCHED;
    });

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    expect(receiptWrittenBeforeReturn).toBe(true);
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CLAIM_TASK_ID },
        data: expect.objectContaining({
          codeChangeClaim: expect.objectContaining({
            requestId: "req-1",
            prBranch: "swarm/swarm-change-abcd1234",
            // The webhook path resolves the stored approvalResult row by
            // these two — they must ride the persisted claim.
            conversationId: CONVERSATION_ID,
            proposalId: PROPOSAL_ID,
          }),
        }),
      }),
    );
  });

  it("dispatches with a webhook URL built on the route-captured base URL", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    const dispatched = mockCreatePr.mock.calls[0][0] as Record<string, unknown>;
    expect(String(dispatched.webhookUrl)).toMatch(
      new RegExp(`^${PUBLIC_BASE_URL}/api/code-change/webhook\\?token=.+`),
    );
  });

  it("returns prPending (no PR data) on a successful dispatch", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.codeChange?.prPending).toBe(true);
      expect(res.result.codeChange?.prUrl).toBeUndefined();
    }
  });

  it("refuses before creating any claim when no publicBaseUrl was captured", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    const res = await handleApproval({
      orgId: ORG_ID,
      userId: USER_ID,
      messages: [msg(codeChangeOutput())],
      intent: { proposalId: PROPOSAL_ID },
      conversationId: CONVERSATION_ID,
      // no publicBaseUrl
    } as Parameters<typeof handleApproval>[0]);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(500);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("stores an encrypted per-claim webhook secret on the claim Task", async () => {
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);

    let createdData: Record<string, unknown> | null = null;
    vi.mocked(db.$transaction).mockImplementation(async (arg: unknown) => {
      if (typeof arg !== "function") return undefined as never;
      const tx = {
        task: {
          create: vi.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
            createdData = a.data;
            return Promise.resolve({ id: CLAIM_TASK_ID });
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        chatMessage: { create: vi.fn().mockResolvedValue({ id: SEED_MSG_ID }) },
        artifact: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
      };
      return (arg as (t: unknown) => Promise<unknown>)(tx) as never;
    });

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    expect(createdData).not.toBeNull();
    expect(typeof createdData!.codeChangeWebhookSecret).toBe("string");
    expect(String(createdData!.codeChangeWebhookSecret)).toContain("enc:");
  });
});

describe("approveCodeChange — reconcile on retry", () => {
  const P2002 = Object.assign(
    new Error("Unique constraint failed"),
    { code: "P2002", clientVersion: "x" },
  );

  beforeEach(async () => {
    const { Prisma } = await import("@prisma/client");
    Object.setPrototypeOf(P2002, Prisma.PrismaClientKnownRequestError.prototype);
    mockFetchStored.mockResolvedValue([msg(codeChangeOutput())]);
    vi.mocked(db.$transaction).mockRejectedValue(P2002);
  });

  it("recovers a PR that landed after the original request died", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue({
      id: CLAIM_TASK_ID,
      createdById: USER_ID,
      workspaceId: WS_ID,
      branch: null,
      codeChangeClaim: {
        requestId: "req-1",
        repositoryUrl: REPO_URL,
        userId: USER_ID,
        workspaceSlug: WS_SLUG,
        runIdPrefix: "req-1",
      },
      chatMessages: [{ artifacts: [] }],
    } as never);
    mockReconcilePr.mockResolvedValue({
      outcome: "landed",
      prUrl: "https://github.com/acme/widgets/pull/9",
      prNumber: 9,
    });
    vi.mocked(db.chatMessage.findFirst).mockResolvedValue({
      id: SEED_MSG_ID,
      artifacts: [],
    } as never);
    vi.mocked(db.artifact.create).mockResolvedValue({} as never);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(true);
    expect(res.ok === true && res.result.codeChange?.prUrl).toBe(
      "https://github.com/acme/widgets/pull/9",
    );
    expect(db.artifact.create).toHaveBeenCalled();
    // Recovery must never open a second PR.
    expect(mockCreatePr).not.toHaveBeenCalled();
  });

  it("returns 409 without re-dispatching when the outcome stays unknown", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue({
      id: CLAIM_TASK_ID,
      createdById: USER_ID,
      workspaceId: WS_ID,
      branch: null,
      codeChangeClaim: {
        requestId: "req-1",
        repositoryUrl: REPO_URL,
        userId: USER_ID,
        workspaceSlug: WS_SLUG,
        runIdPrefix: "req-1",
      },
      chatMessages: [{ artifacts: [] }],
    } as never);
    mockReconcilePr.mockResolvedValue({ outcome: "unknown" });

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(409);
    expect(mockCreatePr).not.toHaveBeenCalled();
    expect(db.task.delete).not.toHaveBeenCalled();
  });

  it("does not attempt reconciliation when the claim carries no receipt", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue({
      id: CLAIM_TASK_ID,
      createdById: USER_ID,
      workspaceId: WS_ID,
      branch: null,
      codeChangeClaim: null,
      chatMessages: [{ artifacts: [] }],
    } as never);

    const res = await approve([msg(codeChangeOutput())]);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.status).toBe(409);
    expect(mockReconcilePr).not.toHaveBeenCalled();
  });
});

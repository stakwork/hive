/**
 * Unit tests for `buildCodeChangeTools` — the `propose_code_change` tool.
 *
 * Two paths share the validation up front (workspace, membership, org,
 * repository):
 *
 *   - the STRUT path (default): dispatch the `code-change-propose` workflow
 *     with the user's token as an actor secret (never in the input), and
 *     return the card PENDING — no diff, no polling, a link to the run in
 *     the org strut view (never strut's own URL);
 *   - the legacy synchronous path (`CODE_CHANGE_VIA_STRUT=false`, kept for
 *     one release): which repository the tool accepts, which single
 *     `repo_url` it forwards to the swarm, and how it reads the diff.
 *
 * The tool used to refuse any workspace owning more than one repository, which
 * made it unreachable in most workspaces. `repositoryUrl` is a required input
 * that is validated against the workspace, and it is the one explicit
 * `repo_url` that reaches the swarm — so the count was never what the swarm
 * contract required (`LAND_CHANGE_ERR_MULTI_REPO` refuses a comma-separated or
 * omitted `repo_url`, not a workspace with several repos).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockRepoAgent,
  mockGetPat,
  mockGetBifrost,
  mockDispatchStrutRun,
  mockCancelStrutRun,
  mockResolveConversation,
  mockSetActiveRun,
  mockNotifyRunActive,
  MockStrutDispatchError,
} = vi.hoisted(() => ({
  mockRepoAgent: vi.fn(),
  mockGetPat: vi.fn(),
  mockGetBifrost: vi.fn(),
  mockDispatchStrutRun: vi.fn(),
  mockCancelStrutRun: vi.fn(),
  mockResolveConversation: vi.fn(),
  mockSetActiveRun: vi.fn(),
  mockNotifyRunActive: vi.fn(),
  MockStrutDispatchError: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findUnique: vi.fn() },
    repository: { findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/ai/askTools", () => ({
  repoAgent: mockRepoAgent,
  REPO_AGENT_CANCELLED_MARKER: "__CANCELLED__",
}));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: mockGetPat }));
vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: mockGetBifrost,
}));
vi.mock("@/services/strut-runs", () => ({
  dispatchStrutRun: mockDispatchStrutRun,
  cancelStrutRun: mockCancelStrutRun,
  StrutDispatchError: MockStrutDispatchError,
}));
vi.mock("@/services/org-canvas-conversation", () => ({ resolveOrgConversationRowId: mockResolveConversation }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  setActiveRun: mockSetActiveRun,
  notifyRunActive: mockNotifyRunActive,
  // The legacy path's poll hooks.
  isAbortRequestedForRun: vi.fn().mockResolvedValue(false),
  clearActiveRun: vi.fn().mockResolvedValue({ wasLast: true }),
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({ decryptField: () => "swarm-api-key" }),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { buildCodeChangeTools } from "@/lib/ai/codeChangeTools";
import { PROPOSE_CODE_CHANGE_TOOL } from "@/lib/proposals/types";
import { db } from "@/lib/db";

// ── Fixtures ───────────────────────────────────────────────────────────────
const ORG_ID = "org-1";
const ORG_LOGIN = "stakwork";
const USER_ID = "user-1";
const WS_ID = "ws-1";
const WS_SLUG = "hive";

const TARGET_REPO = "https://github.com/stakwork/hive";
const OTHER_REPO = "https://github.com/stakwork/sphinx-tribes";
const FOREIGN_REPO = "https://github.com/someone/else";

const DIFF = [
  "--- a/src/app/auth/signin/page.tsx",
  "+++ b/src/app/auth/signin/page.tsx",
  "@@ -1,3 +1,3 @@",
  " <button",
  '-  className="bg-orange-500 hover:bg-orange-600"',
  '+  className="bg-blue-500 hover:bg-blue-600"',
  "",
].join("\n");

function ctx(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    userId: USER_ID,
    currentCanvasConversationId: "conv-1",
    publicBaseUrl: "https://hive.example.com",
    capturedWebSearchResults: [],
    ...over,
  } as unknown as Parameters<typeof buildCodeChangeTools>[0];
}

function run(args: Record<string, unknown> = {}, c = ctx()) {
  const tools = buildCodeChangeTools(c);
  const tool = tools[PROPOSE_CODE_CHANGE_TOOL] as {
    execute: (a: unknown, o?: unknown) => Promise<Record<string, unknown>>;
  };
  return tool.execute(
    {
      workspaceSlug: WS_SLUG,
      repositoryUrl: TARGET_REPO,
      title: "Use blue for the sign-in button",
      body: "Swaps the raw orange Tailwind classes for blue.",
      prompt: "Change bg-orange-500/hover:bg-orange-600 to blue in signin page.",
      ...args,
    },
    {},
  );
}

/** A workspace owning `repoCount` repositories, all members present. */
function mockWorkspace(repoCount: number) {
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    id: WS_ID,
    slug: WS_SLUG,
    name: "Hive",
    members: [{ userId: USER_ID }],
    sourceControlOrg: { id: ORG_ID, githubLogin: ORG_LOGIN },
    swarm: { swarmUrl: "https://swarm.example.com:8444", swarmApiKey: "enc" },
  } as never);
  vi.mocked(db.repository.count).mockResolvedValue(repoCount as never);
}

const ORIGINAL_SWITCH = process.env.CODE_CHANGE_VIA_STRUT;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPat.mockResolvedValue({ username: "evanfeenstra", token: "ghp_x" });
  mockResolveConversation.mockResolvedValue("conv-1");
  mockSetActiveRun.mockResolvedValue({ abortSelf: false });
  mockNotifyRunActive.mockResolvedValue(undefined);
  mockCancelStrutRun.mockResolvedValue(true);
  mockDispatchStrutRun.mockResolvedValue({
    runId: "row-1",
    strutRunId: "1790000000000",
    swarmId: "swarm-1",
  });
  mockGetBifrost.mockResolvedValue(undefined);
  mockRepoAgent.mockResolvedValue({ content: DIFF });
  // fetchDefaultBranch — non-fatal, display only.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ default_branch: "master" }),
    }),
  );
  vi.mocked(db.repository.findFirst).mockImplementation((async (a: { where: { repositoryUrl: string } }) =>
    a.where.repositoryUrl === TARGET_REPO || a.where.repositoryUrl === OTHER_REPO
      ? { id: "repo-1", name: "hive", repositoryUrl: a.where.repositoryUrl }
      : null) as never);
});

afterEach(() => {
  if (ORIGINAL_SWITCH === undefined) delete process.env.CODE_CHANGE_VIA_STRUT;
  else process.env.CODE_CHANGE_VIA_STRUT = ORIGINAL_SWITCH;
});

// ── Strut path (default) ───────────────────────────────────────────────────

describe("propose_code_change — strut path (default)", () => {
  beforeEach(() => {
    delete process.env.CODE_CHANGE_VIA_STRUT;
    mockWorkspace(4);
  });

  it("dispatches the code-change-propose workflow and returns the card PENDING", async () => {
    const out = await run();

    expect(out.error).toBeUndefined();
    expect(mockRepoAgent).not.toHaveBeenCalled();
    expect(mockDispatchStrutRun).toHaveBeenCalledTimes(1);
    const args = mockDispatchStrutRun.mock.calls[0][0];
    expect(args).toMatchObject({
      workspaceId: WS_ID,
      userId: USER_ID,
      kind: "code_change_propose",
      workflow: "code-change-propose",
      purpose: "code_change",
      publicBaseUrl: "https://hive.example.com",
      conversationId: "conv-1",
      proposalId: out.proposalId,
      actorSecrets: { GITHUB_TOKEN: "ghp_x" },
    });
    expect(args.input.repo).toBe(TARGET_REPO);
    // The prompt says how to work, not how to report: no diff printing, no commit/push.
    expect(args.input.prompt).toContain("Change bg-orange-500");
    expect(args.input.prompt).toMatch(/Do not commit, do not push/);
    expect(args.input.prompt).toMatch(/do not print a diff/);
    expect(args.input.prompt).not.toContain("git diff");
    // The token rides ONLY as an actor secret — never in the workflow input.
    expect(JSON.stringify(args.input)).not.toContain("ghp_x");

    expect(out.kind).toBe("codeChange");
    expect(out.originatorUserId).toBe(USER_ID);
    expect(out.payload).toEqual({
      workspaceId: WS_ID,
      workspaceSlug: WS_SLUG,
      repositoryUrl: TARGET_REPO,
      title: "Use blue for the sign-in button",
      body: "Swaps the raw orange Tailwind classes for blue.",
      diff: "",
      diffSha256: "",
      filesChanged: 0,
      preview: "pending",
      pending: {
        runId: "row-1",
        strutRunId: "1790000000000",
        swarmId: "swarm-1",
        // The org strut view on this run — strut's `wf`/`run` packed as the
        // one `?strut=` param `StrutView` reads. A Hive path, never the lab.
        runUrl: `/org/${ORG_LOGIN}/strut?strut=wf%3Dcode-change-propose%26run%3D1790000000000`,
      },
    });
    expect(out.meta).toMatchObject({ repoName: "stakwork/hive", workspaceSlug: WS_SLUG });
  });

  it("links the run through Hive's org strut view, never strut's own origin", async () => {
    const out = await run();
    const pending = (out.payload as { pending: { runUrl?: string } }).pending;
    expect(pending.runUrl).toMatch(/^\/org\/stakwork\/strut\?strut=/);
    expect(JSON.stringify(out)).not.toContain("3355");
    expect(JSON.stringify(out)).not.toContain("/lab");
    // The packed link is exactly strut's own query for the run.
    const packed = new URL(pending.runUrl!, "https://hive.test").searchParams.get("strut");
    expect(Object.fromEntries(new URLSearchParams(packed!))).toEqual({
      wf: "code-change-propose",
      run: "1790000000000",
    });
  });

  it("omits the run link when the workspace has no org to host the strut view", async () => {
    // Cannot happen after a successful dispatch (the resolver refuses a
    // workspace without an org), but the card must not get a broken link.
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: WS_ID,
      slug: WS_SLUG,
      name: "Hive",
      members: [{ userId: USER_ID }],
      sourceControlOrg: null,
      swarm: { swarmUrl: "https://swarm.example.com:8444", swarmApiKey: "enc" },
    } as never);
    const out = await run();
    expect(out.error).toBeUndefined();
    expect((out.payload as { pending: Record<string, unknown> }).pending).not.toHaveProperty("runUrl");
  });

  it("registers the run for the Stop button, keyed by the StrutRun id", async () => {
    await run();
    expect(mockSetActiveRun).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ requestId: "row-1", workspaceId: WS_ID }),
      "row-1",
    );
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", true);
    expect(mockCancelStrutRun).not.toHaveBeenCalled();
  });

  it("a Stop that landed before the dispatch cancels the run at once", async () => {
    mockSetActiveRun.mockResolvedValue({ abortSelf: true });
    await run();
    expect(mockCancelStrutRun).toHaveBeenCalledWith({
      id: "row-1",
      swarmId: "swarm-1",
      workflow: "code-change-propose",
      strutRunId: "1790000000000",
    });
  });

  it("skips the GitHub default-branch fetch and the swarm poll entirely", async () => {
    await run();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockGetBifrost).not.toHaveBeenCalled();
  });

  it("a user with no GitHub token still dispatches (strut's clone fails honestly)", async () => {
    mockGetPat.mockResolvedValue(null);
    const out = await run();
    expect(out.error).toBeUndefined();
    expect(mockDispatchStrutRun.mock.calls[0][0].actorSecrets).toEqual({ GITHUB_TOKEN: null });
  });

  it("surfaces a dispatch refusal as the tool's error", async () => {
    mockDispatchStrutRun.mockRejectedValue(new MockStrutDispatchError("workflow_missing", "Strut has no workflow."));
    const out = await run();
    expect(out.kind).toBeUndefined();
    expect(out.error).toContain("Strut has no workflow.");
    expect(mockSetActiveRun).not.toHaveBeenCalled();
  });

  it("refuses without a public base URL or a canvas conversation, before dispatching", async () => {
    expect((await run({}, ctx({ publicBaseUrl: undefined }))).error).toContain("public URL");
    mockResolveConversation.mockResolvedValue(null);
    expect((await run()).error).toContain("canvas conversation");
    expect(mockDispatchStrutRun).not.toHaveBeenCalled();
  });

  it("still validates the repository and membership first", async () => {
    expect((await run({ repositoryUrl: FOREIGN_REPO })).error).toContain("not registered in");
    expect(mockDispatchStrutRun).not.toHaveBeenCalled();
  });
});

// ── Legacy synchronous path (CODE_CHANGE_VIA_STRUT=false) ──────────────────

describe("propose_code_change — repository selection", () => {
  beforeEach(() => {
    process.env.CODE_CHANGE_VIA_STRUT = "false";
  });

  it("proposes in a workspace that owns several repositories", async () => {
    mockWorkspace(4);

    const out = await run();

    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("codeChange");
    expect((out.payload as { repositoryUrl: string }).repositoryUrl).toBe(TARGET_REPO);
  });

  it("forwards exactly one explicit repo_url to the swarm", async () => {
    mockWorkspace(4);

    await run();

    expect(mockRepoAgent).toHaveBeenCalledTimes(1);
    const params = mockRepoAgent.mock.calls[0][2];
    expect(params.repo_url).toBe(TARGET_REPO);
    // The swarm contract refuses a comma-separated list or an omission.
    expect(params.repo_url).not.toContain(",");
    // Preview must never carry the write tool.
    expect(params.toolsConfig?.create_pr).toBeUndefined();
  });

  it("still proposes in a single-repo workspace", async () => {
    mockWorkspace(1);

    const out = await run();

    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("codeChange");
  });

  it("never consults the workspace repository count", async () => {
    mockWorkspace(9);

    await run();

    expect(db.repository.count).not.toHaveBeenCalled();
  });

  it("refuses a repository that is not registered in the workspace", async () => {
    mockWorkspace(4);

    const out = await run({ repositoryUrl: FOREIGN_REPO });

    expect(out.error).toContain("not registered in");
    expect(mockRepoAgent).not.toHaveBeenCalled();
  });

  it("targets the named repo, not the workspace's first one", async () => {
    mockWorkspace(4);

    await run({ repositoryUrl: OTHER_REPO });

    expect(mockRepoAgent.mock.calls[0][2].repo_url).toBe(OTHER_REPO);
  });
});

describe("propose_code_change — authorization is unchanged", () => {
  beforeEach(() => {
    process.env.CODE_CHANGE_VIA_STRUT = "false";
  });

  it("refuses a non-member of the workspace", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: WS_ID,
      slug: WS_SLUG,
      name: "Hive",
      members: [],
      sourceControlOrg: { id: ORG_ID },
      swarm: { swarmUrl: "https://swarm.example.com:8444", swarmApiKey: "enc" },
    } as never);

    const out = await run();

    expect(out.error).toContain("do not have access");
    expect(mockRepoAgent).not.toHaveBeenCalled();
  });

  it("refuses a workspace belonging to another org", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: WS_ID,
      slug: WS_SLUG,
      name: "Hive",
      members: [{ userId: USER_ID }],
      sourceControlOrg: { id: "org-other" },
      swarm: { swarmUrl: "https://swarm.example.com:8444", swarmApiKey: "enc" },
    } as never);

    const out = await run();

    expect(out.error).toContain("does not belong to the active org");
    expect(mockRepoAgent).not.toHaveBeenCalled();
  });
});

// ── Diff source ─────────────────────────────────────────────────────────────
//
// Newer swarms read the diff from the ephemeral worktree after the run and
// return it as `preview` (same `ok` / `failure` / `error` shape as `pr`),
// plus `incomplete` when the run never reached a proper termination.
// Older swarms return only the model's text. The tool must prefer the
// worktree, believe the swarm's reasons, and refuse unfinished runs.

const WORKTREE_DIFF = [
  "diff --git a/src/lib/ai/canvasTools.ts b/src/lib/ai/canvasTools.ts",
  "index 1111111..2222222 100644",
  "--- a/src/lib/ai/canvasTools.ts",
  "+++ b/src/lib/ai/canvasTools.ts",
  "@@ -1,3 +1,4 @@",
  " function compactNode(n: CanvasNode) {",
  "+  // captured from the worktree",
  "   const out = {};",
  " }",
  "diff --git a/src/tests/new.test.ts b/src/tests/new.test.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/tests/new.test.ts",
  "@@ -0,0 +1 @@",
  "+export const x = 1;",
  "",
].join("\n");

describe("propose_code_change — diff source", () => {
  beforeEach(() => {
    process.env.CODE_CHANGE_VIA_STRUT = "false";
    mockWorkspace(2);
  });

  it("prefers the swarm's worktree diff over anything in the model's text", async () => {
    mockRepoAgent.mockResolvedValue({
      content: "Done. Here is what I changed:\n" + DIFF,
      preview: { ok: true, diff: WORKTREE_DIFF + "\n\n", filesChanged: 2 },
    });

    const out = await run();

    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("codeChange");
    const payload = out.payload as { diff: string; filesChanged: number };
    expect(payload.diff).toBe(WORKTREE_DIFF.trimEnd());
    expect(payload.filesChanged).toBe(2);
    expect(payload.diff).not.toContain("bg-blue-500");
  });

  it("falls back to the model's text when the swarm sends no preview", async () => {
    mockRepoAgent.mockResolvedValue({ content: "Applied.\n" + DIFF });

    const out = await run();

    expect(out.error).toBeUndefined();
    expect((out.payload as { diff: string }).diff).toBe(DIFF.trimEnd());
  });

  it("refuses a run the swarm flags as incomplete, even if the text holds a diff", async () => {
    mockRepoAgent.mockResolvedValue({
      content: DIFF,
      incomplete: { reason: "stall" },
    });

    const out = await run();

    expect(out.kind).toBeUndefined();
    expect(out.error).toContain("stopped before finishing");
    expect(out.error).toContain("stall");
  });

  it("believes the swarm's no_changes over a diff pasted by the model", async () => {
    mockRepoAgent.mockResolvedValue({
      content: DIFF,
      preview: {
        ok: false,
        failure: "no_changes",
        error: "No changes in the worktree after the run",
      },
    });

    const out = await run();

    expect(out.kind).toBeUndefined();
    expect(out.error).toContain("without changing any files");
  });

  it("maps the swarm's secret scan to the credentials refusal", async () => {
    mockRepoAgent.mockResolvedValue({
      content: "",
      preview: {
        ok: false,
        failure: "secrets_detected",
        error: "Secret scan found 1 finding(s)",
      },
    });

    const out = await run();

    expect(out.error).toContain("known credentials");
  });

  it("surfaces the swarm's error text when the run fails", async () => {
    mockRepoAgent.mockRejectedValue(new Error("Run ended on a tool call that could not be resolved: code_execution."));

    const out = await run();

    expect(out.error).toContain("could not be resolved: code_execution");
  });

  it("tells the agent to stage before diffing so new files are not lost", async () => {
    await run();

    const params = mockRepoAgent.mock.calls[0][2];
    expect(params.prompt).toContain("git add -A && git diff --cached");
    expect(params.prompt).not.toContain("git diff HEAD");
    expect(params.ephemeral).toBe(true);
  });
});

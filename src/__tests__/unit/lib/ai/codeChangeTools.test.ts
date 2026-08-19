/**
 * Unit tests for `buildCodeChangeTools` — the `propose_code_change` tool.
 *
 * Focus: which repository the tool accepts, and which single `repo_url` it
 * forwards to the swarm.
 *
 * The tool used to refuse any workspace owning more than one repository, which
 * made it unreachable in most workspaces. `repositoryUrl` is a required input
 * that is validated against the workspace, and it is the one explicit
 * `repo_url` that reaches the swarm — so the count was never what the swarm
 * contract required (`LAND_CHANGE_ERR_MULTI_REPO` refuses a comma-separated or
 * omitted `repo_url`, not a workspace with several repos).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockRepoAgent, mockGetPat, mockGetBifrost } = vi.hoisted(() => ({
  mockRepoAgent: vi.fn(),
  mockGetPat: vi.fn(),
  mockGetBifrost: vi.fn(),
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

function ctx() {
  return {
    orgId: ORG_ID,
    userId: USER_ID,
    capturedWebSearchResults: [],
  } as Parameters<typeof buildCodeChangeTools>[0];
}

function run(args: Record<string, unknown> = {}) {
  const tools = buildCodeChangeTools(ctx());
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
    sourceControlOrg: { id: ORG_ID },
    swarm: { swarmUrl: "https://swarm.example.com:8444", swarmApiKey: "enc" },
  } as never);
  vi.mocked(db.repository.count).mockResolvedValue(repoCount as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPat.mockResolvedValue({ username: "evanfeenstra", token: "ghp_x" });
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
  vi.mocked(db.repository.findFirst).mockImplementation((async (a: {
    where: { repositoryUrl: string };
  }) =>
    a.where.repositoryUrl === TARGET_REPO || a.where.repositoryUrl === OTHER_REPO
      ? { id: "repo-1", name: "hive", repositoryUrl: a.where.repositoryUrl }
      : null) as never);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("propose_code_change — repository selection", () => {
  it("proposes in a workspace that owns several repositories", async () => {
    mockWorkspace(4);

    const out = await run();

    expect(out.error).toBeUndefined();
    expect(out.kind).toBe("codeChange");
    expect((out.payload as { repositoryUrl: string }).repositoryUrl).toBe(
      TARGET_REPO,
    );
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

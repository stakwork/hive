import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockValidateWorkspaceAccess,
  mockDbSwarmFindFirst,
  mockDbRepositoryFindMany,
  mockDbWorkspaceMemberFindMany,
  mockDbWorkspaceFindFirst,
  mockGetGithubUsernameAndPAT,
  mockResolveGithubIdentity,
  mockDecryptField,
} = vi.hoisted(() => ({
  mockValidateWorkspaceAccess: vi.fn(),
  mockDbSwarmFindFirst: vi.fn(),
  mockDbRepositoryFindMany: vi.fn(),
  mockDbWorkspaceMemberFindMany: vi.fn(),
  mockDbWorkspaceFindFirst: vi.fn(),
  mockGetGithubUsernameAndPAT: vi.fn(),
  mockResolveGithubIdentity: vi.fn(),
  mockDecryptField: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findFirst: mockDbSwarmFindFirst },
    repository: { findMany: mockDbRepositoryFindMany },
    workspaceMember: { findMany: mockDbWorkspaceMemberFindMany },
    workspace: { findFirst: mockDbWorkspaceFindFirst },
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
  resolveGithubIdentity: mockResolveGithubIdentity,
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));

vi.mock("@/lib/ai/askTools", () => ({
  listConcepts: vi.fn().mockResolvedValue({ concepts: [] }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { buildWorkspaceConfigs, buildPublicWorkspaceConfig } from "@/lib/ai/workspaceConfig";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SLUG = "my-workspace";
const USER_ID = "user-123";
const WORKSPACE_ID = "ws-cuid-001";

function setupDefaultMocks(githubUsername = "alice", swarmName: string | null = "swarm38") {
  mockValidateWorkspaceAccess.mockResolvedValue({
    hasAccess: true,
    workspace: { id: WORKSPACE_ID, name: "My Workspace", description: null },
  });

  mockDbSwarmFindFirst.mockResolvedValue({
    swarmUrl: "https://swarm.example.com:3333",
    swarmApiKey: "encrypted-key",
    name: swarmName,
  });

  mockDbRepositoryFindMany.mockResolvedValue([
    { repositoryUrl: "https://github.com/owner/repo" },
  ]);

  mockDbWorkspaceMemberFindMany.mockResolvedValue([]);

  mockResolveGithubIdentity.mockResolvedValue({ username: githubUsername });

  mockGetGithubUsernameAndPAT.mockResolvedValue({
    token: "ghp_test",
    username: githubUsername,
  });

  mockDecryptField.mockReturnValue("decrypted-key");
}

function setupPublicMocks(swarmName: string | null = "swarm38") {
  mockDbWorkspaceFindFirst.mockResolvedValue({
    id: WORKSPACE_ID,
    name: "My Workspace",
    slug: SLUG,
    ownerId: "owner-123",
    description: null,
  });

  mockDbSwarmFindFirst.mockResolvedValue({
    swarmUrl: "https://swarm.example.com:3333",
    swarmApiKey: "encrypted-key",
    name: swarmName,
  });

  mockDbRepositoryFindMany.mockResolvedValue([
    { repositoryUrl: "https://github.com/owner/repo" },
  ]);

  mockDbWorkspaceMemberFindMany.mockResolvedValue([]);

  mockGetGithubUsernameAndPAT.mockResolvedValue({
    token: "ghp_test",
    username: "alice",
  });

  mockDecryptField.mockReturnValue("decrypted-key");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildWorkspaceConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates currentUserGithubUsername from getGithubUsernameAndPAT", async () => {
    setupDefaultMocks("alice");

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(configs).toHaveLength(1);
    expect(configs[0].currentUserGithubUsername).toBe("alice");
  });

  it("sets currentUserGithubUsername to undefined when username is null", async () => {
    setupDefaultMocks();
    // Override: username is null (GitHub profile found but no username)
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      token: "ghp_test",
      username: null,
    });

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(configs[0].currentUserGithubUsername).toBeUndefined();
  });

  it("stores the PAT alongside the username", async () => {
    setupDefaultMocks("bob");

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(configs[0].pat).toBe("ghp_test");
    expect(configs[0].currentUserGithubUsername).toBe("bob");
  });

  it("populates swarmDomain from swarm.name via getSwarmVanityAddress", async () => {
    setupDefaultMocks("alice", "swarm38");

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(configs[0].swarmDomain).toBe("swarm38.sphinx.chat");
  });

  it("sets swarmDomain to undefined when swarm.name is null", async () => {
    setupDefaultMocks("alice", null);

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(configs[0].swarmDomain).toBeUndefined();
  });
});

describe("buildWorkspaceConfigs — multi-slug concurrency", () => {
  const SLUGS = ["alpha", "beta", "gamma"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves all slugs concurrently rather than one after another", async () => {
    setupDefaultMocks();

    // Barrier: each call parks until all three have *started*. Under the
    // old serial loop slug 2 never starts, so this would never settle and
    // the test times out — which is exactly the regression we're locking.
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;

    mockValidateWorkspaceAccess.mockImplementation(async (slug: string) => {
      if (++started === SLUGS.length) release();
      await allStarted;
      return {
        hasAccess: true,
        workspace: { id: `ws-${slug}`, name: slug, description: null },
      };
    });

    const configs = await buildWorkspaceConfigs(SLUGS, USER_ID);

    expect(started).toBe(SLUGS.length);
    expect(configs).toHaveLength(SLUGS.length);
  });

  it("returns configs in slug order, not completion order", async () => {
    setupDefaultMocks();

    // Invert the timing: the last slug resolves first.
    mockValidateWorkspaceAccess.mockImplementation(async (slug: string) => {
      const delay = (SLUGS.length - SLUGS.indexOf(slug)) * 5;
      await new Promise((r) => setTimeout(r, delay));
      return {
        hasAccess: true,
        workspace: { id: `ws-${slug}`, name: slug, description: null },
      };
    });

    const configs = await buildWorkspaceConfigs(SLUGS, USER_ID);

    expect(configs.map((c) => c.slug)).toEqual(SLUGS);
    expect(configs.map((c) => c.workspaceId)).toEqual(["ws-alpha", "ws-beta", "ws-gamma"]);
  });

  it("surfaces the first failure in slug order even when a later slug fails sooner", async () => {
    setupDefaultMocks();

    // "alpha" (first in order) fails slowly; "beta" fails immediately.
    // Plain `Promise.all` would surface beta's error; we want alpha's, to
    // match what the original serial loop reported.
    mockValidateWorkspaceAccess.mockImplementation(async (slug: string) => {
      if (slug === "alpha") {
        await new Promise((r) => setTimeout(r, 20));
        return { hasAccess: false, workspace: null };
      }
      if (slug === "beta") {
        return { hasAccess: false, workspace: null };
      }
      return {
        hasAccess: true,
        workspace: { id: `ws-${slug}`, name: slug, description: null },
      };
    });

    await expect(buildWorkspaceConfigs(SLUGS, USER_ID)).rejects.toMatchObject({
      kind: "forbidden",
      message: "Access denied for workspace: alpha",
    });
  });

  it("resolves the user's GitHub identity once for the whole batch", async () => {
    setupDefaultMocks();

    await buildWorkspaceConfigs(SLUGS, USER_ID);

    // The identity does not vary by workspace; re-reading it per slug was
    // 2 redundant round-trips each.
    expect(mockResolveGithubIdentity).toHaveBeenCalledTimes(1);
    expect(mockResolveGithubIdentity).toHaveBeenCalledWith(USER_ID);

    // ...and it's handed to each per-workspace PAT lookup so those skip
    // the re-read.
    expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledTimes(SLUGS.length);
    for (const slug of SLUGS) {
      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(USER_ID, slug, {
        username: "alice",
      });
    }
  });

  it("issues a workspace's swarm, repo, member and PAT reads concurrently", async () => {
    setupDefaultMocks();

    // Same barrier idea as above, but within a *single* workspace: each of
    // the four reads parks until all four have started. Serially chained,
    // only the first ever starts and this times out.
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const gate = async <T>(value: T): Promise<T> => {
      if (++started === 4) release();
      await allStarted;
      return value;
    };

    mockDbSwarmFindFirst.mockImplementation(() =>
      gate({ swarmUrl: "https://swarm.example.com:3333", swarmApiKey: "k", name: "swarm38" })
    );
    mockDbRepositoryFindMany.mockImplementation(() =>
      gate([{ repositoryUrl: "https://github.com/owner/repo" }])
    );
    mockDbWorkspaceMemberFindMany.mockImplementation(() => gate([]));
    mockGetGithubUsernameAndPAT.mockImplementation(() =>
      gate({ token: "ghp_test", username: "alice" })
    );

    const configs = await buildWorkspaceConfigs([SLUG], USER_ID);

    expect(started).toBe(4);
    expect(configs).toHaveLength(1);
  });

  it("skips the PAT lookup entirely when the user has no GitHub identity", async () => {
    setupDefaultMocks();
    mockResolveGithubIdentity.mockResolvedValue(null);

    await expect(buildWorkspaceConfigs([SLUG], USER_ID)).rejects.toMatchObject({
      kind: "not_found",
      message: `GitHub PAT not found for workspace: ${SLUG}`,
    });
    expect(mockGetGithubUsernameAndPAT).not.toHaveBeenCalled();
  });
});

describe("buildPublicWorkspaceConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates swarmDomain from swarm.name via getSwarmVanityAddress", async () => {
    setupPublicMocks("swarm38");

    const config = await buildPublicWorkspaceConfig(SLUG);

    expect(config.swarmDomain).toBe("swarm38.sphinx.chat");
  });

  it("sets swarmDomain to undefined when swarm.name is null", async () => {
    setupPublicMocks(null);

    const config = await buildPublicWorkspaceConfig(SLUG);

    expect(config.swarmDomain).toBeUndefined();
  });
});

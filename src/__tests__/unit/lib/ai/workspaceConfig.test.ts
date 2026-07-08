import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockValidateWorkspaceAccess,
  mockDbSwarmFindFirst,
  mockDbRepositoryFindMany,
  mockDbWorkspaceMemberFindMany,
  mockDbWorkspaceFindFirst,
  mockGetGithubUsernameAndPAT,
  mockDecryptField,
} = vi.hoisted(() => ({
  mockValidateWorkspaceAccess: vi.fn(),
  mockDbSwarmFindFirst: vi.fn(),
  mockDbRepositoryFindMany: vi.fn(),
  mockDbWorkspaceMemberFindMany: vi.fn(),
  mockDbWorkspaceFindFirst: vi.fn(),
  mockGetGithubUsernameAndPAT: vi.fn(),
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

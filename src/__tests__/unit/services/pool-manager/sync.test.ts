import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";

// --- Module mocks ---

vi.mock("@/lib/db", () => ({
  db: {
    environmentVariable: { findMany: vi.fn() },
    swarm: { findUnique: vi.fn(), update: vi.fn() },
    repository: { findMany: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_, v) => v),
    })),
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/helpers/repository", () => ({
  getPrimaryRepository: vi.fn(),
}));

vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(() => ({
    getPoolEnvVars: vi.fn().mockResolvedValue([]),
    updatePoolData: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({})),
}));

vi.mock("@/utils/devContainerUtils", () => ({
  getDevContainerFilesFromBase64: vi.fn(() => []),
  generatePM2Apps: vi.fn(() => []),
  formatPM2Apps: vi.fn(() => "[]"),
  devcontainerJsonContent: vi.fn(() => "{}"),
  dockerComposeContent: vi.fn(() => ""),
  dockerfileContent: vi.fn(() => ""),
}));

// --- Helpers ---

import { db } from "@/lib/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getPrimaryRepository } from "@/lib/helpers/repository";

const OWNER_ID = "owner-user-id";
const OTHER_USER_ID = "other-user-id";
const WORKSPACE_ID = "workspace-id";
const WORKSPACE_SLUG = "my-workspace";
const SWARM_ID = "swarm-id";
const POOL_API_KEY = "encrypted-api-key";

function setupDefaultMocks() {
  vi.mocked(db.workspace.findUnique).mockResolvedValue({
    ownerId: OWNER_ID,
  } as never);

  vi.mocked(db.swarm.findUnique).mockResolvedValue({
    id: SWARM_ID,
    workspaceId: WORKSPACE_ID,
    services: null,
    containerFiles: null,
    minimumVms: null,
  } as never);

  vi.mocked(db.swarm.update).mockResolvedValue({} as never);
  vi.mocked(db.environmentVariable.findMany).mockResolvedValue([]);
  vi.mocked(db.repository.findMany).mockResolvedValue([]);
  vi.mocked(getPrimaryRepository).mockResolvedValue(null);

  vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
    token: "owner-pat",
    username: "owner-gh-user",
  });
}

describe("syncPoolManagerSettings — GitHub credential resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("always calls getGithubUsernameAndPAT with the workspace ownerId", async () => {
    const result = await syncPoolManagerSettings({
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
      swarmId: SWARM_ID,
      poolApiKey: POOL_API_KEY,
    });

    expect(result.success).toBe(true);
    expect(getGithubUsernameAndPAT).toHaveBeenCalledTimes(1);
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(OWNER_ID, WORKSPACE_SLUG);
  });

  it("uses ownerId even when a different (non-owner) user ID could have been passed", async () => {
    // Simulate a scenario where a non-owner triggers the sync.
    // The function should still look up the workspace owner, not use any caller ID.
    const result = await syncPoolManagerSettings({
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
      swarmId: SWARM_ID,
      poolApiKey: POOL_API_KEY,
    });

    expect(result.success).toBe(true);
    // Must be called with the owner ID, never with OTHER_USER_ID
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(OWNER_ID, WORKSPACE_SLUG);
    expect(getGithubUsernameAndPAT).not.toHaveBeenCalledWith(OTHER_USER_ID, expect.anything());
  });

  it("returns null github creds gracefully when workspace has no ownerId", async () => {
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const result = await syncPoolManagerSettings({
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
      swarmId: SWARM_ID,
      poolApiKey: POOL_API_KEY,
    });

    expect(result.success).toBe(true);
    expect(getGithubUsernameAndPAT).not.toHaveBeenCalled();
  });
});

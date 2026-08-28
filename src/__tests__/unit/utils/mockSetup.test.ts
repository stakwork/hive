import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((field: string, value: string) => ({
        data: `encrypted_${value}`,
        iv: "mock_iv",
        tag: "mock_tag",
        version: "v1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

vi.mock("@/utils/mockSeedData", () => ({
  seedMockData: vi.fn(),
  seedPublicMockWorkspace: vi.fn(),
}));

import { deriveMockGitHubUserId, deriveMockInstallationId, resolveMockInstallationId } from "@/utils/mockSetup";

const INT4_MAX = 2_147_483_647;
const MOCK_ORG_INSTALLATION_ID = 999001;

const sampleUsernames = [
  "alice",
  "bob",
  "mock-user",
  "tom-smith",
  "alice-stakwork",
  "bob-stakwork",
  "tom-smith-stakwork",
  ...Array.from({ length: 500 }, (_, i) => `user-${i}`),
];

function fakeTx(orgsByInstallationId: Record<number, { githubLogin: string }>): Prisma.TransactionClient {
  return {
    sourceControlOrg: {
      findUnique: vi.fn(
        async ({ where }: { where: { githubInstallationId: number } }) =>
          orgsByInstallationId[where.githubInstallationId] ?? null,
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("deriveMockInstallationId", () => {
  it("returns the same id for the same username on every call", () => {
    // Regression guard for the original bug: the id used to come from a
    // module-level counter that reset on server restart, so a persisted
    // SourceControlOrg from a previous process collided (P2002) with the
    // create for a new mock username.
    const first = deriveMockInstallationId("alice");
    expect(deriveMockInstallationId("alice")).toBe(first);
    expect(deriveMockInstallationId("alice")).toBe(first);
  });

  it("returns distinct ids for distinct usernames", () => {
    const ids = sampleUsernames.map(deriveMockInstallationId);
    expect(new Set(ids).size).toBe(sampleUsernames.length);
  });

  it("stays within Postgres INT4 range and clear of the fixed mock-org id", () => {
    for (const id of sampleUsernames.map(deriveMockInstallationId)) {
      expect(id).toBeGreaterThanOrEqual(1_000_000_000);
      expect(id).toBeLessThanOrEqual(INT4_MAX);
      expect(id).not.toBe(MOCK_ORG_INSTALLATION_ID);
    }
  });
});

describe("deriveMockGitHubUserId", () => {
  it("returns a stable numeric string per username", () => {
    const first = deriveMockGitHubUserId("alice");
    expect(deriveMockGitHubUserId("alice")).toBe(first);
    expect(first).toMatch(/^\d+$/);
  });

  it("returns distinct ids for distinct usernames", () => {
    const ids = sampleUsernames.map(deriveMockGitHubUserId);
    expect(new Set(ids).size).toBe(sampleUsernames.length);
  });

  it("does not collide with the installation id for the same username", () => {
    for (const name of sampleUsernames) {
      expect(deriveMockGitHubUserId(name)).not.toBe(String(deriveMockInstallationId(name)));
    }
  });
});

describe("resolveMockInstallationId", () => {
  it("returns the derived id when no org holds it", async () => {
    const tx = fakeTx({});
    await expect(resolveMockInstallationId(tx, "alice")).resolves.toBe(deriveMockInstallationId("alice"));
  });

  it("returns the derived id when the same login already holds it (re-seed)", async () => {
    const derived = deriveMockInstallationId("alice");
    const tx = fakeTx({ [derived]: { githubLogin: "alice" } });
    await expect(resolveMockInstallationId(tx, "alice")).resolves.toBe(derived);
  });

  it("probes past an id held by a different login", async () => {
    const derived = deriveMockInstallationId("alice");
    const tx = fakeTx({ [derived]: { githubLogin: "someone-else" } });
    await expect(resolveMockInstallationId(tx, "alice")).resolves.toBe(derived + 1);
  });

  it("keeps probing until it finds a free id", async () => {
    const derived = deriveMockInstallationId("alice");
    const tx = fakeTx({
      [derived]: { githubLogin: "someone-else" },
      [derived + 1]: { githubLogin: "another-login" },
    });
    await expect(resolveMockInstallationId(tx, "alice")).resolves.toBe(derived + 2);
  });
});

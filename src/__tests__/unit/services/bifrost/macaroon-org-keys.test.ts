import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ensureMacaroonOrgKeys,
  MacaroonOrgKeysError,
} from "@/services/bifrost/macaroon-org-keys";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// withLock should just run the fn synchronously in unit tests — Redis
// isn't involved. Same pattern as reconciler.test.ts.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

// Encryption mock — round-trips a JSON envelope. Real implementation
// at `src/lib/encryption/field-encryption.ts`.
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((_field: string, value: string) => ({
        data: value,
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "2026-01-01T00:00:00Z",
      })),
      decryptField: vi.fn((_field: string, input: unknown) => {
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            if (typeof parsed?.data === "string") return parsed.data;
          } catch {
            // fall through
          }
        }
        if (input && typeof input === "object") {
          const v = (input as { data?: unknown }).data;
          if (typeof v === "string") return v;
        }
        throw new Error("Invalid encrypted data format");
      }),
    })),
  },
}));

const ORG_ID = "scorg_1";
const GITHUB_LOGIN = "stakwork";

describe("ensureMacaroonOrgKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached keys when the row already has the triple", async () => {
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValueOnce({
      id: ORG_ID,
      githubLogin: GITHUB_LOGIN,
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "ab".repeat(32),
      macaroonOrgPrivkey: JSON.stringify({ data: "deadbeef" }),
    } as never);

    const result = await ensureMacaroonOrgKeys(ORG_ID);

    expect(result).toEqual({
      sourceControlOrgId: ORG_ID,
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "ab".repeat(32),
      created: false,
    });
    expect(dbMock.sourceControlOrg.update).not.toHaveBeenCalled();
  });

  it("mints fresh keys when the row has none", async () => {
    // findUnique called twice: once on the fast path, once inside the
    // lock for the re-check. Both return the "empty" row.
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValue({
      id: ORG_ID,
      githubLogin: GITHUB_LOGIN,
      macaroonOrgId: null,
      macaroonOrgPubkey: null,
      macaroonOrgPrivkey: null,
    } as never);

    vi.mocked(dbMock.sourceControlOrg.update).mockResolvedValueOnce(
      {} as never,
    );

    const result = await ensureMacaroonOrgKeys(ORG_ID);

    expect(result.sourceControlOrgId).toBe(ORG_ID);
    expect(result.macaroonOrgId).toBe(`gh_${GITHUB_LOGIN}`);
    expect(result.created).toBe(true);
    // 33-byte compressed secp256k1 == 66 hex chars, leading 02 or 03.
    expect(result.macaroonOrgPubkey).toMatch(/^0[23][0-9a-f]{64}$/);

    expect(dbMock.sourceControlOrg.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(dbMock.sourceControlOrg.update).mock
      .calls[0][0];
    expect(updateCall).toMatchObject({
      where: { id: ORG_ID },
      data: {
        macaroonOrgId: `gh_${GITHUB_LOGIN}`,
        macaroonOrgPubkey: result.macaroonOrgPubkey,
      },
    });
    // The privkey was encrypted (JSON-string envelope, not the raw
    // hex).
    expect(updateCall.data.macaroonOrgPrivkey).toEqual(expect.any(String));
    expect(updateCall.data.macaroonOrgPrivkey).not.toMatch(/^[0-9a-f]{64}$/);
    const envelope = JSON.parse(updateCall.data.macaroonOrgPrivkey as string);
    expect(envelope.data).toMatch(/^[0-9a-f]{64}$/); // 32-byte privkey hex
  });

  it("does not re-mint when a concurrent caller wrote keys while we were waiting", async () => {
    // First call (fast path): keys are null → fall through to lock.
    // Second call (re-check inside lock): keys are now populated by
    // a concurrent caller → return without minting.
    vi.mocked(dbMock.sourceControlOrg.findUnique)
      .mockResolvedValueOnce({
        id: ORG_ID,
        githubLogin: GITHUB_LOGIN,
        macaroonOrgId: null,
        macaroonOrgPubkey: null,
        macaroonOrgPrivkey: null,
      } as never)
      .mockResolvedValueOnce({
        id: ORG_ID,
        githubLogin: GITHUB_LOGIN,
        macaroonOrgId: "gh_stakwork",
        macaroonOrgPubkey: "02" + "cd".repeat(32),
        macaroonOrgPrivkey: JSON.stringify({ data: "winner" }),
      } as never);

    const result = await ensureMacaroonOrgKeys(ORG_ID);

    expect(result).toEqual({
      sourceControlOrgId: ORG_ID,
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "cd".repeat(32),
      created: false,
    });
    expect(dbMock.sourceControlOrg.update).not.toHaveBeenCalled();
  });

  it("throws MacaroonOrgKeysError when the org doesn't exist", async () => {
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValueOnce(
      null as never,
    );

    await expect(ensureMacaroonOrgKeys("missing")).rejects.toBeInstanceOf(
      MacaroonOrgKeysError,
    );
    expect(dbMock.sourceControlOrg.update).not.toHaveBeenCalled();
  });

  it("throws MacaroonOrgKeysError when the org has no githubLogin (defensive)", async () => {
    // Phase-1 reality: every real row has one, but the field is
    // nullable in some upstream migrations. Defensive guard.
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValue({
      id: ORG_ID,
      githubLogin: null,
      macaroonOrgId: null,
      macaroonOrgPubkey: null,
      macaroonOrgPrivkey: null,
    } as never);

    await expect(ensureMacaroonOrgKeys(ORG_ID)).rejects.toBeInstanceOf(
      MacaroonOrgKeysError,
    );
  });

  it("re-mints if only partial keys are present (defensive)", async () => {
    // Pubkey set but privkey null — treat as "incomplete, regenerate"
    // so we never end up with a pubkey we can't sign with.
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValue({
      id: ORG_ID,
      githubLogin: GITHUB_LOGIN,
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "ab".repeat(32),
      macaroonOrgPrivkey: null,
    } as never);

    vi.mocked(dbMock.sourceControlOrg.update).mockResolvedValueOnce(
      {} as never,
    );

    const result = await ensureMacaroonOrgKeys(ORG_ID);

    expect(result.created).toBe(true);
    // Newly minted pubkey is different from the stale one.
    expect(result.macaroonOrgPubkey).not.toBe("02" + "ab".repeat(32));
    expect(dbMock.sourceControlOrg.update).toHaveBeenCalledTimes(1);
  });

  it("generates distinct keypairs for distinct orgs", async () => {
    // Two cold-cache orgs in sequence should each get fresh keys.
    vi.mocked(dbMock.sourceControlOrg.findUnique).mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        ({
          id: where.id,
          githubLogin: `login_${where.id}`,
          macaroonOrgId: null,
          macaroonOrgPubkey: null,
          macaroonOrgPrivkey: null,
        }) as never,
    );
    vi.mocked(dbMock.sourceControlOrg.update).mockResolvedValue({} as never);

    const a = await ensureMacaroonOrgKeys("org-a");
    const b = await ensureMacaroonOrgKeys("org-b");

    expect(a.macaroonOrgPubkey).not.toBe(b.macaroonOrgPubkey);
    expect(a.macaroonOrgId).toBe("gh_login_org-a");
    expect(b.macaroonOrgId).toBe("gh_login_org-b");
  });
});

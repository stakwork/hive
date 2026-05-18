import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ensureMacaroonUserKeys,
  MacaroonUserKeysError,
} from "@/services/bifrost/macaroon-user-keys";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Bypass Redis in unit tests — same pattern the org-keys test uses.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

// Encryption mock — round-trips a JSON envelope so the stored value
// is shaped like production state but the test asserts on the
// payload contents directly.
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

const USER_ID = "user_1";

// 32-byte ed25519 seed (any 32 random bytes is valid). Hex for the
// stored-encrypted value.
const STORED_PRIVKEY_HEX = "a1".repeat(32);

// 32-byte pubkey hex (the actual value computed from STORED_PRIVKEY_HEX
// is derived from gatekey's ed25519PublicKey — we don't assert on the
// exact pubkey here, just its shape).
const STORED_PUBKEY_HEX = "b2".repeat(32);

describe("ensureMacaroonUserKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached keys when the row already has the pair", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValueOnce({
      id: USER_ID,
      macaroonUserPubkey: STORED_PUBKEY_HEX,
      macaroonUserPrivkey: JSON.stringify({ data: STORED_PRIVKEY_HEX }),
    } as never);

    const result = await ensureMacaroonUserKeys(USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.userPubkey).toBe(STORED_PUBKEY_HEX);
    expect(result.created).toBe(false);
    // Decrypted privkey came back as bytes matching the stored hex.
    expect(Buffer.from(result.userPrivkey).toString("hex")).toBe(
      STORED_PRIVKEY_HEX,
    );
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("mints fresh keys when the row has none", async () => {
    // Both the fast-path read and the in-lock re-check return empty.
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      macaroonUserPubkey: null,
      macaroonUserPrivkey: null,
    } as never);

    vi.mocked(dbMock.user.update).mockResolvedValueOnce({} as never);

    const result = await ensureMacaroonUserKeys(USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.created).toBe(true);
    // 32-byte ed25519 pubkey == 64 hex chars.
    expect(result.userPubkey).toMatch(/^[0-9a-f]{64}$/);
    // 32-byte ed25519 seed exposed to the caller.
    expect(result.userPrivkey).toHaveLength(32);

    expect(dbMock.user.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(dbMock.user.update).mock.calls[0][0];
    expect(updateCall).toMatchObject({
      where: { id: USER_ID },
      data: {
        macaroonUserPubkey: result.userPubkey,
      },
    });
    // The privkey was encrypted (JSON-string envelope, not raw hex).
    expect(updateCall.data.macaroonUserPrivkey).toEqual(expect.any(String));
    expect(updateCall.data.macaroonUserPrivkey).not.toMatch(/^[0-9a-f]+$/);
    const envelope = JSON.parse(updateCall.data.macaroonUserPrivkey as string);
    expect(envelope.data).toMatch(/^[0-9a-f]{64}$/); // 32-byte seed hex
  });

  it("does not re-mint when a concurrent caller wrote keys while we were waiting", async () => {
    // First read (fast path): keys are null → fall through to lock.
    // Second read (re-check inside lock): a concurrent caller has
    // populated them → return without re-minting.
    vi.mocked(dbMock.user.findUnique)
      .mockResolvedValueOnce({
        id: USER_ID,
        macaroonUserPubkey: null,
        macaroonUserPrivkey: null,
      } as never)
      .mockResolvedValueOnce({
        id: USER_ID,
        macaroonUserPubkey: STORED_PUBKEY_HEX,
        macaroonUserPrivkey: JSON.stringify({ data: STORED_PRIVKEY_HEX }),
      } as never);

    const result = await ensureMacaroonUserKeys(USER_ID);

    expect(result).toEqual({
      userId: USER_ID,
      userPubkey: STORED_PUBKEY_HEX,
      userPrivkey: expect.any(Uint8Array),
      created: false,
    });
    expect(result.userPrivkey).toHaveLength(32);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("throws MacaroonUserKeysError when the user doesn't exist", async () => {
    vi.mocked(dbMock.user.findUnique).mockResolvedValueOnce(null as never);

    await expect(ensureMacaroonUserKeys("missing")).rejects.toBeInstanceOf(
      MacaroonUserKeysError,
    );
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("re-mints if only partial keys are present (defensive)", async () => {
    // Pubkey set but privkey null — treat as incomplete and regenerate
    // both, so we never end up with a pubkey we can't sign with.
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      macaroonUserPubkey: STORED_PUBKEY_HEX,
      macaroonUserPrivkey: null,
    } as never);

    vi.mocked(dbMock.user.update).mockResolvedValueOnce({} as never);

    const result = await ensureMacaroonUserKeys(USER_ID);

    expect(result.created).toBe(true);
    // The freshly minted pubkey is distinct from the stale stored one.
    expect(result.userPubkey).not.toBe(STORED_PUBKEY_HEX);
    expect(dbMock.user.update).toHaveBeenCalledTimes(1);
  });

  it("generates distinct keypairs for distinct users", async () => {
    vi.mocked(dbMock.user.findUnique).mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        ({
          id: where.id,
          macaroonUserPubkey: null,
          macaroonUserPrivkey: null,
        }) as never,
    );
    vi.mocked(dbMock.user.update).mockResolvedValue({} as never);

    const a = await ensureMacaroonUserKeys("user-a");
    const b = await ensureMacaroonUserKeys("user-b");

    expect(a.userPubkey).not.toBe(b.userPubkey);
    expect(Buffer.from(a.userPrivkey).toString("hex")).not.toBe(
      Buffer.from(b.userPrivkey).toString("hex"),
    );
  });

  it("the public key it returns matches the one derived from the privkey it returns", async () => {
    // Cross-check: round-trip the minted pair through gatekey's own
    // derive function, asserting the pubkey we hand back is the
    // matching half of the privkey we hand back. Catches any future
    // bug where the autogen flow mixes up keys between insertions.
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      macaroonUserPubkey: null,
      macaroonUserPrivkey: null,
    } as never);
    vi.mocked(dbMock.user.update).mockResolvedValueOnce({} as never);

    const { ed25519PublicKey, bytesToHex } = await import("gatekey");

    const result = await ensureMacaroonUserKeys(USER_ID);
    const derivedPub = bytesToHex(ed25519PublicKey(result.userPrivkey));

    expect(derivedPub).toBe(result.userPubkey);
  });
});

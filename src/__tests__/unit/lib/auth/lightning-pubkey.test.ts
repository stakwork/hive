/**
 * A Sphinx pubkey's lookup (`lib/auth/lightning-pubkey.ts`): the HMAC hash
 * beside the encrypted pubkey, the one indexed read that finds a user by it,
 * the decrypt scan over rows written before the hash, and the backfill.
 */
import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  backfillLightningPubkeyHashes,
  lightningPubkeyFields,
  lightningPubkeyHash,
  normalizeLightningPubkey,
  userByLightningPubkey,
} from "@/lib/auth/lightning-pubkey";

const ALICE = "02" + "a1".repeat(32);
const BOB = "03" + "b2".repeat(32);
const encrypted = (pubkey: string) =>
  JSON.stringify(EncryptionService.getInstance().encryptField("lightningPubkey", pubkey));

describe("normalizeLightningPubkey", () => {
  it("takes 66 hex characters in any case, trimmed, and nothing else", () => {
    expect(normalizeLightningPubkey(` ${ALICE.toUpperCase()} `)).toBe(ALICE);
    expect(normalizeLightningPubkey(ALICE.slice(2))).toBeNull();
    expect(normalizeLightningPubkey(ALICE.slice(0, 65) + "z")).toBeNull();
    expect(normalizeLightningPubkey(42)).toBeNull();
  });
});

describe("lightningPubkeyHash", () => {
  it("is the same for the same pubkey in any case, another for another, and not the plain SHA-256", () => {
    const hash = lightningPubkeyHash(ALICE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(lightningPubkeyHash(ALICE.toUpperCase())).toBe(hash);
    expect(lightningPubkeyHash(BOB)).not.toBe(hash);
    expect(hash).not.toBe(createHash("sha256").update(ALICE).digest("hex"));
  });

  it("a row's fields: the ciphertext of the pubkey, and its hash", () => {
    const fields = lightningPubkeyFields(ALICE);
    expect(EncryptionService.getInstance().decryptField("lightningPubkey", fields.lightningPubkey)).toBe(ALICE);
    expect(fields.lightningPubkeyHash).toBe(lightningPubkeyHash(ALICE));
  });
});

describe("userByLightningPubkey", () => {
  it("finds a user by the hash, in one read", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "u-alice" } as never);
    expect(await userByLightningPubkey(ALICE.toUpperCase())).toEqual({ id: "u-alice" });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { lightningPubkeyHash: lightningPubkeyHash(ALICE) },
      select: { id: true },
    });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("a row from before the hash: found among the unhashed rows, and hashed", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: "u-bob", lightningPubkey: encrypted(BOB) },
      { id: "u-alice", lightningPubkey: encrypted(ALICE) },
    ] as never);
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);

    expect(await userByLightningPubkey(ALICE)).toEqual({ id: "u-alice" });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { lightningPubkey: { not: null }, lightningPubkeyHash: null },
      select: { id: true, lightningPubkey: true },
    });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u-alice", lightningPubkeyHash: null },
      data: { lightningPubkeyHash: lightningPubkeyHash(ALICE) },
    });
  });

  it("a pubkey nobody holds is null; one that is not a pubkey reads nothing", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "u-bob", lightningPubkey: encrypted(BOB) }] as never);
    expect(await userByLightningPubkey(ALICE)).toBeNull();
    expect(db.user.updateMany).not.toHaveBeenCalled();

    vi.mocked(db.user.findUnique).mockClear();
    expect(await userByLightningPubkey("not-a-pubkey")).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("backfillLightningPubkeyHashes", () => {
  const rows = () => [
    { id: "u-alice", lightningPubkey: encrypted(ALICE), lightningPubkeyHash: null },
    { id: "u-bob", lightningPubkey: encrypted(BOB), lightningPubkeyHash: lightningPubkeyHash(BOB) },
    { id: "u-alice-2", lightningPubkey: encrypted(ALICE), lightningPubkeyHash: null },
    { id: "u-broken", lightningPubkey: '{"data":"x","iv":"y","tag":"z","encryptedAt":"w"}', lightningPubkeyHash: null },
  ];

  it("hashes each unhashed pubkey once, leaves a second holder and an unreadable row, and writes nothing on a dry run", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue(rows() as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    // The scripts hand it their own client; the mocked one stands in.
    const prisma = db as unknown as PrismaClient;
    const dry = await backfillLightningPubkeyHashes(prisma, { dryRun: true, all: true });
    expect(dry).toEqual({ scanned: 4, hashed: 1, current: 1, unreadable: 1, conflicts: ["u-alice-2"] });
    expect(db.user.update).not.toHaveBeenCalled();

    const applied = await backfillLightningPubkeyHashes(prisma, { dryRun: false });
    expect(applied.hashed).toBe(1);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u-alice" },
      data: { lightningPubkeyHash: lightningPubkeyHash(ALICE) },
    });
    expect(vi.mocked(db.user.findMany).mock.calls[1][0]).toMatchObject({
      where: { lightningPubkey: { not: null }, lightningPubkeyHash: null },
    });
  });
});

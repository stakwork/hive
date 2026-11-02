import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/person/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { EncryptionService } from "@/lib/encryption";
import { lightningPubkeyFields, lightningPubkeyHash } from "@/lib/auth/lightning-pubkey";

const encryptionService = EncryptionService.getInstance();

const TEST_PUBKEY = "03b1c2d3e4f5a67890123456789012345678901234567890123456789012345678";

describe("POST /person", () => {
  let testUserId: string;

  beforeEach(async () => {
    const encryptedPubkey = encryptionService.encryptField("lightningPubkey", TEST_PUBKEY);
    const user = await createTestUser({
      lightningPubkey: JSON.stringify(encryptedPubkey),
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    if (testUserId) {
      await db.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
  });

  it("updates sphinxAlias and sphinxRouteHint and returns { success: true }", async () => {
    const result = await invokeRoute(POST, {
      method: "POST",
      url: "http://localhost/person",
      body: {
        owner_pubkey: TEST_PUBKEY,
        owner_alias: "alice",
        owner_route_hint: "hint:abc123",
      },
      session: null,
    });

    expect(result.status).toBe(200);
    const data = await result.json<{ success: boolean }>();
    expect(data).toEqual({ success: true });

    const updated = await db.user.findUnique({ where: { id: testUserId } });
    expect(updated?.sphinxAlias).toBe("alice");
    expect(updated?.sphinxRouteHint).toBe("hint:abc123");
  });

  it("finds a user written before the lookup hash, and gives the row its hash", async () => {
    const pubkey = "02c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4";
    const user = await db.user.create({
      data: {
        email: `person-prehash-${Date.now()}@example.com`,
        lightningPubkey: JSON.stringify(encryptionService.encryptField("lightningPubkey", pubkey)),
        lightningPubkeyHash: null,
      },
    });
    try {
      const result = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/person",
        body: { owner_pubkey: pubkey, owner_alias: "bob", owner_route_hint: "hint:def456" },
        session: null,
      });

      expect(result.status).toBe(200);
      const row = await db.user.findUnique({ where: { id: user.id } });
      expect(row?.sphinxAlias).toBe("bob");
      expect(row?.sphinxRouteHint).toBe("hint:def456");
      expect(row?.lightningPubkeyHash).toBe(lightningPubkeyHash(pubkey));
    } finally {
      await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("finds a user by the lookup hash", async () => {
    const pubkey = "03d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";
    const user = await db.user.create({
      data: { email: `person-hashed-${Date.now()}@example.com`, ...lightningPubkeyFields(pubkey) },
    });
    try {
      const result = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/person",
        body: { owner_pubkey: pubkey, owner_alias: "carol" },
        session: null,
      });

      expect(result.status).toBe(200);
      const row = await db.user.findUnique({ where: { id: user.id } });
      expect(row?.sphinxAlias).toBe("carol");
    } finally {
      await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("returns 404 for an unknown pubkey", async () => {
    const result = await invokeRoute(POST, {
      method: "POST",
      url: "http://localhost/person",
      body: { owner_pubkey: "unknown-pubkey-that-does-not-exist" },
      session: null,
    });

    expect(result.status).toBe(404);
    const data = await result.json<{ error: string }>();
    expect(data.error).toBe("User not found");
  });

  it("returns 400 when owner_pubkey is missing", async () => {
    const result = await invokeRoute(POST, {
      method: "POST",
      url: "http://localhost/person",
      body: { owner_alias: "alice" },
      session: null,
    });

    expect(result.status).toBe(400);
    const data = await result.json<{ error: string }>();
    expect(data.error).toBeDefined();
  });
});

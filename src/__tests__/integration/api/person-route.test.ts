import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/person/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

const TEST_PUBKEY = "03b1c2d3e4f5a6789012345678901234567890123456789012345678901234567891";

describe("POST /person", () => {
  let testUserId: string;

  beforeEach(async () => {
    const encryptedPubkey = encryptionService.encryptField("lightningPubkey", TEST_PUBKEY);
    const user = await createTestUser({lightning_pubkey: JSON.stringify(encryptedPubkey),
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    if (testUserId) {
      await db.users.delete({ where: { id: testUserId } }).catch(() => {});
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

    const updated = await db.users.findUnique({ where: { id: testUserId } });
    expect(updated?.sphinxAlias).toBe("alice");
    expect(updated?.sphinxRouteHint).toBe("hint:abc123");
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

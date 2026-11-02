import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks (hoisted) ---

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockDecryptField = vi.fn();
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({ decryptField: mockDecryptField, lookupHash: vi.fn(() => "hash") })),
  },
}));

const mockSendDirectMessage = vi.fn().mockResolvedValue({ success: true });
const mockIsDirectMessageConfigured = vi.fn().mockReturnValue(true);
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: (...args: unknown[]) => mockSendDirectMessage(...args),
  isDirectMessageConfigured: () => mockIsDirectMessageConfigured(),
}));

// --- Imports (after mocks) ---

import { POST } from "@/app/person/route";
import { db } from "@/lib/db";

// --- Helpers ---

const TEST_PUBKEY = "02a1b2c3d4e5f67890123456789012345678901234567890123456789012345678";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/person", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Tests ---

describe("POST /person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No row holds the pubkey's hash yet, so the lookup falls back to the unhashed rows.
    (db.user.findUnique as Mock).mockResolvedValue(undefined);
    (db.user.updateMany as Mock).mockResolvedValue({ count: 1 });
  });

  it("returns 400 when owner_pubkey is missing", async () => {
    const res = await POST(makeRequest({ owner_alias: "alice" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 400 when owner_pubkey is not a string", async () => {
    const res = await POST(makeRequest({ owner_pubkey: 12345 }));
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 404 when no user matches the pubkey", async () => {
    (db.user.findMany as Mock).mockResolvedValue([
      { id: "user-1", lightningPubkey: JSON.stringify({ data: "enc" }) },
    ]);
    mockDecryptField.mockReturnValue("other-pubkey");

    const res = await POST(makeRequest({ owner_pubkey: TEST_PUBKEY }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("User not found");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns { success: true } and updates sphinxAlias + sphinxRouteHint on match", async () => {
    (db.user.findMany as Mock).mockResolvedValue([
      { id: "user-1", lightningPubkey: JSON.stringify({ data: "enc" }) },
    ]);
    mockDecryptField.mockReturnValue(TEST_PUBKEY);
    (db.user.update as Mock).mockResolvedValue({});

    const res = await POST(
      makeRequest({ owner_pubkey: TEST_PUBKEY, owner_alias: "alice", owner_route_hint: "hint123" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { sphinxAlias: "alice", sphinxRouteHint: "hint123" },
    });
    // The row found by the fallback is given its hash.
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", lightningPubkeyHash: null },
      data: { lightningPubkeyHash: "hash" },
    });
  });

  it("finds a user through the hash read, without reading the unhashed rows", async () => {
    (db.user.findUnique as Mock).mockResolvedValue({ id: "user-hashed" });
    (db.user.update as Mock).mockResolvedValue({});

    const res = await POST(makeRequest({ owner_pubkey: TEST_PUBKEY, owner_alias: "bob", owner_route_hint: "hint456" }));

    expect(res.status).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { lightningPubkeyHash: "hash" }, select: { id: true } });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-hashed" },
      data: { sphinxAlias: "bob", sphinxRouteHint: "hint456" },
    });
  });

  it("handles partial body — only owner_pubkey provided, alias and route_hint are undefined", async () => {
    (db.user.findMany as Mock).mockResolvedValue([
      { id: "user-1", lightningPubkey: JSON.stringify({ data: "enc" }) },
    ]);
    mockDecryptField.mockReturnValue(TEST_PUBKEY);
    (db.user.update as Mock).mockResolvedValue({});

    const res = await POST(makeRequest({ owner_pubkey: TEST_PUBKEY }));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { sphinxAlias: undefined, sphinxRouteHint: undefined },
    });
  });

  it("skips users whose pubkey fails to decrypt and continues checking others", async () => {
    (db.user.findMany as Mock).mockResolvedValue([
      { id: "user-bad", lightningPubkey: '{"bad":"data"}' },
      { id: "user-good", lightningPubkey: JSON.stringify({ data: "enc" }) },
    ]);
    mockDecryptField
      .mockImplementationOnce(() => { throw new Error("decrypt error"); })
      .mockReturnValueOnce(TEST_PUBKEY);
    (db.user.update as Mock).mockResolvedValue({});

    const res = await POST(makeRequest({ owner_pubkey: TEST_PUBKEY }));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-good" } })
    );
  });
});

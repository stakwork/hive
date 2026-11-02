/**
 * POST /api/strut-devices/calls/ticket — a paired device's LiveKit ticket
 * for a Hive call, under an identity Hive records against its person
 * (`docs/plans/call-speaker-identity.md`). Against the real database; Redis
 * is an in-memory stand-in; the token is minted for real and read back.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestUser, createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";
import { generateDeviceCredential } from "@/lib/strut-devices";

const { store, hashes, expiries } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  hashes: new Map<string, Map<string, string>>(),
  expiries: new Map<string, number>(),
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      store.set(key, value);
      expiries.set(key, ttl);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hashes.set(key, hash);
      hash.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field) ?? null),
    expire: vi.fn(async (key: string, ttl: number) => {
      expiries.set(key, ttl);
      return 1;
    }),
  },
}));

import { POST } from "@/app/api/strut-devices/calls/ticket/route";
import { CALL_RECORD_MAX_AGE_SECONDS, callMemberOf, storeCallRecord, storeCallRoom } from "@/lib/calls/callRecord";

const ROOM = "sphinx.call.-swarm38.sphinx.chat-.1793600000";
const CALL_KEY = "abc123def456abc123def456";

async function createOrgWorkspaceScenario() {
  const org = await db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("ticket-org"),
      githubLogin: `org-${generateUniqueId()}`,
      githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
      type: "ORG",
    },
  });
  const scenario = await createTestWorkspaceScenario({ memberCount: 1, workspace: { sourceControlOrgId: org.id } });
  return { ...scenario, org };
}

async function createDevice(userId: string, revoked = false) {
  const credential = generateDeviceCredential();
  await db.strutDevice.create({
    data: {
      userId,
      name: "Peel",
      credentialPrefix: credential.slice(0, 12),
      credentialHash: hashApiKey(credential),
      revokedAt: revoked ? new Date() : null,
    },
  });
  return credential;
}

/** The call Tom started, as `startCall` writes it. */
async function createCall(starterId: string, workspaceSlug: string, orgId: string) {
  await storeCallRecord(CALL_KEY, { userId: starterId, orgId, workspaceSlug, roomName: ROOM });
  await storeCallRoom(ROOM, CALL_KEY);
}

function ticketRequest(credential: string | null, body?: unknown, raw?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (credential) headers.Authorization = `Bearer ${credential}`;
  return new NextRequest("http://localhost:3000/api/strut-devices/calls/ticket", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(body ?? {}),
  });
}

/** A JWT's claims, unchecked: the signature is LiveKit's to check. */
function claims(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

const ENV_KEYS = ["LIVEKIT_PUBLIC_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

describe("POST /api/strut-devices/calls/ticket", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    hashes.clear();
    expiries.clear();
    process.env.LIVEKIT_PUBLIC_URL = "wss://livekit.example.com";
    process.env.LIVEKIT_API_KEY = "test-livekit-key";
    process.env.LIVEKIT_API_SECRET = "test-livekit-secret-that-is-long-enough";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("401 without a credential, for an unknown one, and for a revoked one", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const revoked = await createDevice(owner.id, true);
    const body = { room: ROOM, participantName: "Evan" };

    expect((await POST(ticketRequest(null, body))).status).toBe(401);
    expect((await POST(ticketRequest("hivedev_notarealcredential", body))).status).toBe(401);
    expect((await POST(ticketRequest(revoked, body))).status).toBe(401);
    expect(hashes.size).toBe(0);
  });

  test("200: meet's shape, a token for the room under a Hive identity, recorded against the device's person", async () => {
    const { owner, members, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const evan = members[0];
    const credential = await createDevice(evan.id);
    const metadata = JSON.stringify({ profilePictureUrl: "https://example.com/evan.png" });

    const res = await POST(ticketRequest(credential, { room: ROOM, participantName: "  Evan \n F ", metadata }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["participantName", "participantToken", "roomName", "serverUrl"]);
    expect(data).toMatchObject({ serverUrl: "wss://livekit.example.com", roomName: ROOM, participantName: "Evan F" });

    const jwt = claims(data.participantToken);
    expect(jwt.sub).toMatch(/^hive_[0-9a-f]{32}$/);
    // Meet's identities always contain `__`: no name typed there makes this one.
    expect(jwt.sub).not.toContain("__");
    expect(jwt.iss).toBe("test-livekit-key");
    expect(jwt.name).toBe("Evan F");
    expect(jwt.metadata).toBe(metadata);
    expect(jwt.video).toEqual({ room: ROOM, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });
    expect(jwt.video.roomAdmin).toBeUndefined();
    // Meet's 5 minutes: a ticket only has to last until the join.
    const left = jwt.exp - Math.floor(Date.now() / 1000);
    expect(left).toBeGreaterThan(290);
    expect(left).toBeLessThanOrEqual(300);

    expect(await callMemberOf(CALL_KEY, jwt.sub)).toBe(evan.id);
    // The members live as long as the call may, not on the record's sliding 4 h.
    const ttl = expiries.get(`call-members:${CALL_KEY}`)!;
    expect(ttl).toBeGreaterThan(CALL_RECORD_MAX_AGE_SECONDS - 60);
    expect(ttl).toBeLessThanOrEqual(CALL_RECORD_MAX_AGE_SECONDS);
  });

  test("each ticket is a new identity, and a join does not extend the call", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const credential = await createDevice(owner.id);
    const recordTtl = expiries.get(`call:${CALL_KEY}`);

    const a = claims((await (await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }))).json()).participantToken);
    const b = claims((await (await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }))).json()).participantToken);

    expect(a.sub).not.toBe(b.sub);
    expect(await callMemberOf(CALL_KEY, a.sub)).toBe(owner.id);
    expect(await callMemberOf(CALL_KEY, b.sub)).toBe(owner.id);
    expect(expiries.get(`call:${CALL_KEY}`)).toBe(recordTtl);
  });

  test("404 for a room Hive made no call in, or whose call is over", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    const credential = await createDevice(owner.id);

    let res = await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }));
    expect(res.status).toBe(404);

    // The room still names the call, but its record is gone.
    await storeCallRoom(ROOM, CALL_KEY);
    res = await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }));
    expect(res.status).toBe(404);

    // A record past its 12 h.
    store.set(
      `call:${CALL_KEY}`,
      JSON.stringify({
        userId: owner.id,
        orgId: org.id,
        workspaceSlug: workspace.slug,
        roomName: ROOM,
        conversationId: null,
        createdAt: new Date(Date.now() - 13 * 3600_000).toISOString(),
      }),
    );
    res = await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }));
    expect(res.status).toBe(404);
    expect(hashes.size).toBe(0);
  });

  test("403 for a person who cannot use the call's workspace", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const stranger = await createTestUser();
    const credential = await createDevice(stranger.id);

    const res = await POST(ticketRequest(credential, { room: ROOM, participantName: "Mallory" }));

    expect(res.status).toBe(403);
    expect(hashes.size).toBe(0);
  });

  test("400 for a body that is not a ticket request", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const credential = await createDevice(owner.id);

    for (const body of [
      { participantName: "Tom" },
      { room: ROOM },
      { room: ROOM, participantName: "   " },
      { room: "r".repeat(257), participantName: "Tom" },
      { room: ROOM, participantName: "Tom", metadata: "not json" },
      { room: ROOM, participantName: "Tom", metadata: "[1,2]" },
      { room: ROOM, participantName: "Tom", metadata: { profilePictureUrl: "x" } },
      { room: ROOM, participantName: "Tom", metadata: JSON.stringify({ x: "y".repeat(5000) }) },
    ]) {
      const res = await POST(ticketRequest(credential, body));
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    expect((await POST(ticketRequest(credential, undefined, "not json"))).status).toBe(400);
    expect(hashes.size).toBe(0);
  });

  test("503 when LiveKit is not configured for minting, and nothing recorded", async () => {
    const { owner, workspace, org } = await createOrgWorkspaceScenario();
    await createCall(owner.id, workspace.slug, org.id);
    const credential = await createDevice(owner.id);
    delete process.env.LIVEKIT_PUBLIC_URL;

    const res = await POST(ticketRequest(credential, { room: ROOM, participantName: "Tom" }));

    expect(res.status).toBe(503);
    expect(hashes.size).toBe(0);
  });
});

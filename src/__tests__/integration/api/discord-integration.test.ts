import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestMembership } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarmWithEncryptedApiKey } from "@/__tests__/support/factories/swarm.factory";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { EncryptionService } from "@/lib/encryption";
import { invokeRoute } from "@/__tests__/harness/route";
import {
  GET as discordIntegrationGET,
  PUT as discordIntegrationPUT,
} from "@/app/api/workspaces/[slug]/settings/discord-integration/route";
import { POST as discordValidatePOST } from "@/app/api/workspaces/[slug]/settings/discord-integration/validate/route";

import {
  GET as discordChannelsGET,
  PUT as discordChannelsPUT,
} from "@/app/api/workspaces/[slug]/settings/discord-channels/route";
import { GET as discordCronGET } from "@/app/api/cron/discord-sync/route";
import { POST as discordWorkerPOST } from "@/app/api/workers/discord-channel-sync/route";

/**
 * Integration tests for Discord integration API routes and worker.
 */

// --------------------------------------------------------------------------
// after() mock — use vi.hoisted() so the variable is available before
// vi.mock() factories run (Vitest hoists mock calls above imports).
// --------------------------------------------------------------------------
const afterState = vi.hoisted(() => ({ pending: Promise.resolve() as Promise<void> }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      afterState.pending = Promise.resolve(cb());
    },
  };
});

/** Reset the captured promise and await any leftover task from a prior test. */
async function flushAfter() {
  await afterState.pending;
  afterState.pending = Promise.resolve();
}

// --------------------------------------------------------------------------
// Mock discord utility — use vi.hoisted() so these fns are available when the
// vi.mock factory runs (static imports cause factories to execute before
// module-level const declarations are initialised).
// --------------------------------------------------------------------------
const {
  mockValidateBotToken,
  mockGetBotGuilds,
  mockGetGuildChannels,
  mockGetChannelMessages,
} = vi.hoisted(() => ({
  mockValidateBotToken: vi.fn(),
  mockGetBotGuilds: vi.fn(),
  mockGetGuildChannels: vi.fn(),
  mockGetChannelMessages: vi.fn(),
}));

vi.mock("@/lib/discord", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discord")>();
  return {
    ...actual,
    discordUtil: {
      validateBotToken: mockValidateBotToken,
      getBotGuilds: mockGetBotGuilds,
      getGuildChannels: mockGetGuildChannels,
      getChannelMessages: mockGetChannelMessages,
      generateInviteUrl: actual.discordUtil.generateInviteUrl,
    },
  };
});

// --------------------------------------------------------------------------
// Capture / restore global.fetch for external calls
// --------------------------------------------------------------------------
const originalFetch = global.fetch;
let mockSwarmFetch: ReturnType<typeof vi.fn>;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function makeRequest(
  method: string,
  url: string,
  body?: unknown,
  authHeader?: string,
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function session(userId: string, email: string | null | undefined, name?: string | null | undefined) {
  return { user: { id: userId, email: email ?? "test@example.com", name: name ?? "Test User" }, expires: "" };
}

const PLAIN_TOKEN = "Bot.test.token12345";

let ownerId: string;
let workspaceId: string;
let workspaceSlug: string;

async function seedDiscordWorkspace() {
  const owner = await createTestUser({ idempotent: false });
  ownerId = owner.id;

  const enc = EncryptionService.getInstance().encryptField("discordBotToken", PLAIN_TOKEN);
  const uid = generateUniqueId("discord");
  const ws = await db.workspace.create({
    data: {
      name: `Discord WS ${uid}`,
      slug: `discord-ws-${uid}`,
      ownerId: owner.id,
      discordEnabled: true,
      discordBotToken: JSON.stringify(enc),
      discordClientId: "1234567890",
    },
  });
  workspaceId = ws.id;
  workspaceSlug = ws.slug;
}

async function cleanupDiscordWorkspace() {
  await db.discordChannel.deleteMany({ where: { workspaceId } });
  await db.swarm.deleteMany({ where: { workspaceId } });
  await db.workspaceMember.deleteMany({ where: { workspaceId } });
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: ownerId } });
}

// ==========================================================================
// GET /api/workspaces/[slug]/settings/discord-integration
// ==========================================================================
describe("GET /api/workspaces/[slug]/settings/discord-integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    await seedDiscordWorkspace();
  });

  afterEach(cleanupDiscordWorkspace);

  it("returns 401 for unauthenticated requests", async () => {
        const result = await invokeRoute(discordIntegrationGET as never, {
      session: null,
      params: { slug: workspaceSlug },
    });
    expect(result.status).toBe(401);
  });

  it("returns 403 for non-admin member", async () => {
        const dev = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId, userId: dev.id, role: "DEVELOPER" });

    const result = await invokeRoute(discordIntegrationGET as never, {
      session: session(dev.id, dev.email, dev.name),
      params: { slug: workspaceSlug },
    });
    expect(result.status).toBe(403);

    await db.workspaceMember.deleteMany({ where: { userId: dev.id } });
    await db.user.delete({ where: { id: dev.id } });
  });

  it("returns discord settings without raw token for admin/owner", async () => {
        const result = await invokeRoute(discordIntegrationGET as never, {
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({
      discordEnabled: true,
      discordClientId: "1234567890",
      hasToken: true,
    });
    expect(data).not.toHaveProperty("discordBotToken");
  });
});

// ==========================================================================
// discordIntegrationPUT /api/workspaces/[slug]/settings/discord-integration
// ==========================================================================
describe("PUT /api/workspaces/[slug]/settings/discord-integration", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    await seedDiscordWorkspace();
  });

  afterEach(cleanupDiscordWorkspace);

  it("returns 403 for non-admin", async () => {
        const viewer = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId, userId: viewer.id, role: "VIEWER" });

    const result = await invokeRoute(discordIntegrationPUT as never, {
      method: "PUT",
      session: session(viewer.id, viewer.email, viewer.name),
      params: { slug: workspaceSlug },
      body: { discordEnabled: false },
    });
    expect(result.status).toBe(403);

    await db.workspaceMember.deleteMany({ where: { userId: viewer.id } });
    await db.user.delete({ where: { id: viewer.id } });
  });

  it("updates discordEnabled for admin", async () => {
        const result = await invokeRoute(discordIntegrationPUT as never, {
      method: "PUT",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: { discordEnabled: false },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({ discordEnabled: false });

    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { discordEnabled: true },
    });
    expect(ws?.discordEnabled).toBe(false);
  });

  it("encrypts new token and stores it (not plaintext)", async () => {
        const result = await invokeRoute(discordIntegrationPUT as never, {
      method: "PUT",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: { discordEnabled: true, discordBotToken: "MTIzNDU2Nzg5.rest.ofsecret" },
    });

    expect(result.status).toBe(200);
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { discordBotToken: true },
    });
    expect(ws?.discordBotToken).not.toBeNull();
    expect(ws?.discordBotToken).not.toBe("MTIzNDU2Nzg5.rest.ofsecret");
    const parsed = JSON.parse(ws!.discordBotToken!);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
  });
});

// ==========================================================================
// POST /api/workspaces/[slug]/settings/discord-integration/validate
// ==========================================================================
describe("POST /api/workspaces/[slug]/settings/discord-integration/validate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    await seedDiscordWorkspace();
  });

  afterEach(cleanupDiscordWorkspace);

  it("returns 401 for unauthenticated", async () => {
        const result = await invokeRoute(discordValidatePOST as never, {
      method: "POST",
      session: null,
      params: { slug: workspaceSlug },
    });
    expect(result.status).toBe(401);
  });

  it("returns valid=true with bot username on success", async () => {
        mockValidateBotToken.mockResolvedValueOnce({
      id: "123",
      username: "HiveBot",
      discriminator: "0000",
    });

    const result = await invokeRoute(discordValidatePOST as never, {
      method: "POST",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: { token: PLAIN_TOKEN },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({ valid: true, botUsername: "HiveBot" });
  });

  it("returns valid=false on Discord API error", async () => {
        mockValidateBotToken.mockRejectedValueOnce(new Error("401 Unauthorized"));

    const result = await invokeRoute(discordValidatePOST as never, {
      method: "POST",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: { token: "bad-token" },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({ valid: false });
  });

  it("uses stored encrypted token when none provided in body", async () => {
        mockValidateBotToken.mockResolvedValueOnce({
      id: "123",
      username: "StoredBot",
      discriminator: "0000",
    });

    const result = await invokeRoute(discordValidatePOST as never, {
      method: "POST",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: {},
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({ valid: true, botUsername: "StoredBot" });
    expect(mockValidateBotToken).toHaveBeenCalledWith(PLAIN_TOKEN);
  });
});

// ==========================================================================
// discordIntegrationGET + discordIntegrationPUT /api/workspaces/[slug]/settings/discord-channels
// ==========================================================================
describe("GET + PUT /api/workspaces/[slug]/settings/discord-channels", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    await seedDiscordWorkspace();
  });

  afterEach(cleanupDiscordWorkspace);

  it("discordChannelsGET returns 401 for unauthenticated", async () => {
        const result = await invokeRoute(discordChannelsGET as never, {
      session: null,
      params: { slug: workspaceSlug },
    });
    expect(result.status).toBe(401);
  });

  it("discordChannelsGET returns 403 for non-admin", async () => {
        const dev = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId, userId: dev.id, role: "DEVELOPER" });

    const result = await invokeRoute(discordChannelsGET as never, {
      session: session(dev.id, dev.email, dev.name),
      params: { slug: workspaceSlug },
    });
    expect(result.status).toBe(403);

    await db.workspaceMember.deleteMany({ where: { userId: dev.id } });
    await db.user.delete({ where: { id: dev.id } });
  });

  it("discordChannelsPUT upserts channels and removes deselected ones", async () => {
        await db.discordChannel.create({
      data: {
        workspaceId,
        guildId: "111",
        guildName: "Old Guild",
        channelId: "old-channel",
        channelName: "old-general",
        channelType: 0,
      },
    });

    const result = await invokeRoute(discordChannelsPUT as never, {
      method: "PUT",
      session: session(ownerId, "owner@test.com", "Owner"),
      params: { slug: workspaceSlug },
      body: {
        channels: [
          { guildId: "111", guildName: "Hive Dev Server", channelId: "222", channelName: "general", channelType: 0 },
          { guildId: "111", guildName: "Hive Dev Server", channelId: "333", channelName: "engineering", channelType: 0 },
        ],
      },
    });

    expect(result.status).toBe(200);
    const data = await result.json<{ channels: unknown[] }>();
    expect(data.channels).toHaveLength(2);

    const old = await db.discordChannel.findFirst({ where: { workspaceId, channelId: "old-channel" } });
    expect(old).toBeNull();

    const remaining = await db.discordChannel.findMany({ where: { workspaceId } });
    expect(remaining.map((c) => c.channelId).sort()).toEqual(["222", "333"]);
  });

  it("discordChannelsPUT returns 403 for non-admin", async () => {
        const viewer = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId, userId: viewer.id, role: "VIEWER" });

    const result = await invokeRoute(discordChannelsPUT as never, {
      method: "PUT",
      session: session(viewer.id, viewer.email, viewer.name),
      params: { slug: workspaceSlug },
      body: { channels: [] },
    });
    expect(result.status).toBe(403);

    await db.workspaceMember.deleteMany({ where: { userId: viewer.id } });
    await db.user.delete({ where: { id: viewer.id } });
  });
});

// ==========================================================================
// discordChannelsGET /api/cron/discord-sync — auth + dispatch count
// ==========================================================================
describe("GET /api/cron/discord-sync", () => {
  let cronOwnerId: string;
  let cronWorkspaceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    

    const owner = await createTestUser({ idempotent: false });
    cronOwnerId = owner.id;

    const enc = EncryptionService.getInstance().encryptField("discordBotToken", "test-token");
    const uid = generateUniqueId("cron");
    const ws = await db.workspace.create({
      data: {
        name: `Cron WS ${uid}`,
        slug: `cron-ws-${uid}`,
        ownerId: owner.id,
        discordEnabled: true,
        discordBotToken: JSON.stringify(enc),
      },
    });
    cronWorkspaceId = ws.id;

    await db.discordChannel.create({
      data: {
        workspaceId: cronWorkspaceId,
        guildId: "111",
        guildName: "Test Guild",
        channelId: "chan-1",
        channelName: "general",
        channelType: 0,
        enabled: true,
        status: "ACTIVE",
      },
    });

    process.env.CRON_SECRET = "test-cron-secret";
    process.env.DISCORD_SYNC_CRON_ENABLED = "true";
    process.env.INTERNAL_WORKER_SECRET = "test-worker-secret";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    mockSwarmFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    global.fetch = mockSwarmFetch;
  });

  afterEach(async () => {
    await flushAfter();
    global.fetch = originalFetch;
    delete process.env.DISCORD_SYNC_CRON_ENABLED;
    await db.discordChannel.deleteMany({ where: { workspaceId: cronWorkspaceId } });
    await db.workspace.deleteMany({ where: { id: cronWorkspaceId } });
    await db.user.deleteMany({ where: { id: cronOwnerId } });
  });

  it("returns 401 without valid CRON_SECRET", async () => {
        const req = makeRequest("GET", "http://localhost/api/cron/discord-sync", undefined, "Bearer wrong-secret");
    const res = await discordCronGET(req);
    expect(res.status).toBe(401);
  });

  it("returns disabled message when DISCORD_SYNC_CRON_ENABLED is not true", async () => {
    process.env.DISCORD_SYNC_CRON_ENABLED = "false";
        const req = makeRequest("GET", "http://localhost/api/cron/discord-sync", undefined, "Bearer test-cron-secret");
    const res = await discordCronGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ message: "Discord sync cron disabled" });
  });

  it("returns dispatched count ≥ 1 with correct secret and enabled flag", async () => {
        const req = makeRequest("GET", "http://localhost/api/cron/discord-sync", undefined, "Bearer test-cron-secret");
    const res = await discordCronGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.dispatched).toBe("number");
    expect(data.dispatched).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// POST /api/workers/discord-channel-sync — circuit breaker + atomic checkpoint
// ==========================================================================
describe("POST /api/workers/discord-channel-sync", () => {
  let workerOwnerId: string;
  let workerWorkspaceId: string;
  let workerChannelId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    

    const owner = await createTestUser({ idempotent: false });
    workerOwnerId = owner.id;

    const enc = EncryptionService.getInstance().encryptField("discordBotToken", PLAIN_TOKEN);
    const uid = generateUniqueId("worker");
    const ws = await db.workspace.create({
      data: {
        name: `Worker WS ${uid}`,
        slug: `worker-ws-${uid}`,
        ownerId: owner.id,
        discordEnabled: true,
        discordBotToken: JSON.stringify(enc),
      },
    });
    workerWorkspaceId = ws.id;

    await createTestSwarmWithEncryptedApiKey(workerWorkspaceId, {
      swarmUrl: "https://test-swarm.sphinx.chat",
      apiKey: "test-swarm-api-key",
    });

    const channel = await db.discordChannel.create({
      data: {
        workspaceId: workerWorkspaceId,
        guildId: "111",
        guildName: "Test Guild",
        channelId: "chan-worker",
        channelName: "general",
        channelType: 0,
        enabled: true,
        status: "ACTIVE",
        consecutiveFailures: 0,
      },
    });
    workerChannelId = channel.id;

    process.env.INTERNAL_WORKER_SECRET = "test-worker-secret";

    mockSwarmFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = mockSwarmFetch;
  });

  afterEach(async () => {
    await flushAfter();
    global.fetch = originalFetch;
    await db.discordChannel.deleteMany({ where: { workspaceId: workerWorkspaceId } });
    await db.swarm.deleteMany({ where: { workspaceId: workerWorkspaceId } });
    await db.workspace.deleteMany({ where: { id: workerWorkspaceId } });
    await db.user.deleteMany({ where: { id: workerOwnerId } });
  });

  it("returns 401 with wrong worker secret", async () => {
        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer wrong-secret"
    );
    const res = await discordWorkerPOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 202 with correct secret", async () => {
    mockGetChannelMessages.mockResolvedValueOnce([]);

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    const res = await discordWorkerPOST(req);
    await flushAfter();

    expect(res.status).toBe(202);
  });

  it("circuit breaker: 403 from Discord disables channel immediately", async () => {
    mockGetChannelMessages.mockRejectedValueOnce({ status: 403, message: "Missing Access" });

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    expect(updated?.status).toBe("DISABLED_BY_SYSTEM");
    expect(updated?.enabled).toBe(false);
    expect(updated?.syncError).toBe("Missing Access");
  });

  it("circuit breaker: 404 from Discord disables channel immediately", async () => {
    mockGetChannelMessages.mockRejectedValueOnce({ status: 404, message: "Unknown Channel" });

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    expect(updated?.status).toBe("DISABLED_BY_SYSTEM");
    expect(updated?.enabled).toBe(false);
  });

  it("circuit breaker: 5 consecutive failures disables channel", async () => {
    await db.discordChannel.update({
      where: { id: workerChannelId },
      data: { consecutiveFailures: 4 },
    });

    mockGetChannelMessages.mockRejectedValueOnce(new Error("timeout"));

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    expect(updated?.status).toBe("DISABLED_BY_SYSTEM");
    expect(updated?.enabled).toBe(false);
    expect(updated?.consecutiveFailures).toBe(5);
  });

  it("non-fatal error increments failures and sets ERRORED (not disabled)", async () => {
    mockGetChannelMessages.mockRejectedValueOnce(new Error("network error"));

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    expect(updated?.status).toBe("ERRORED");
    expect(updated?.enabled).toBe(true);
    expect(updated?.consecutiveFailures).toBe(1);
  });

  it("atomic checkpoint: failure on page 3 keeps lastMessageId at end of page 2", async () => {
    // Discord returns messages newest-first (descending ID order).
    // makeMsgs(start, count) produces IDs [start+count-1 ... start] descending.
    const makeMsgs = (start: number, count = 100) =>
      Array.from({ length: count }, (_, i) => ({
        id: String(start + count - 1 - i), // newest-first: e.g. 100, 99, ..., 1
        content: `msg ${start + count - 1 - i}`,
        timestamp: new Date().toISOString(),
        author: { id: "u1", username: "User" },
      }));

    const page1 = makeMsgs(1);    // IDs 100, 99, ..., 1  (newest-first)
    const page2 = makeMsgs(101);  // IDs 200, 199, ..., 101 (newest-first)

    mockGetChannelMessages
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockRejectedValueOnce(new Error("timeout"));

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    // lastMessageId must be the last message of page 2 (highest ID in chronological order)
    expect(updated?.lastMessageId).toBe("200");
    // Status ERRORED (1 failure < 5, not a 403/404)
    expect(updated?.status).toBe("ERRORED");
    expect(updated?.lastSyncedAt).not.toBeNull();
  });

  it("successful sync resets failure counters to zero", async () => {
    await db.discordChannel.update({
      where: { id: workerChannelId },
      data: { consecutiveFailures: 2, status: "ERRORED" },
    });

    const msgs = [
      {
        id: "msg-42",
        content: "hello",
        timestamp: new Date().toISOString(),
        author: { id: "u1", username: "User" },
      },
    ];
    // Single batch < 100 messages → loop exits after first fetch
    mockGetChannelMessages.mockResolvedValueOnce(msgs);

        const req = makeRequest(
      "POST",
      "http://localhost/api/workers/discord-channel-sync",
      { channelId: workerChannelId },
      "Bearer test-worker-secret"
    );
    await discordWorkerPOST(req);
    await flushAfter();

    const updated = await db.discordChannel.findUnique({ where: { id: workerChannelId } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.consecutiveFailures).toBe(0);
    expect(updated?.syncError).toBeNull();
    expect(updated?.lastMessageId).toBe("msg-42");
  });
});

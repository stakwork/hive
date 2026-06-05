import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractClientIdFromToken, discordUtil } from "@/lib/discord";

// Mock the env config so the utility uses a predictable base URL in tests
vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    DISCORD_API_BASE_URL: "https://discord.com/api/v10",
  },
}));

describe("extractClientIdFromToken", () => {
  it("returns numeric client ID from a valid token prefix", () => {
    // Encode a numeric ID as base64url (simulates a real Discord bot token prefix)
    const clientId = "123456789012345678";
    const encoded = Buffer.from(clientId).toString("base64url");
    const token = `${encoded}.someMiddlePart.someSignature`;

    const result = extractClientIdFromToken(token);
    expect(result).toBe(clientId);
  });

  it("returns null for a malformed token (no segments)", () => {
    expect(extractClientIdFromToken("notavalidtoken")).toBeNull();
  });

  it("returns null when first segment decodes to non-numeric string", () => {
    const encoded = Buffer.from("not-a-snowflake").toString("base64url");
    const token = `${encoded}.middle.sig`;
    expect(extractClientIdFromToken(token)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractClientIdFromToken("")).toBeNull();
  });
});

describe("discordUtil.validateBotToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with bot user object on 200 response", async () => {
    const mockUser = { id: "111", username: "HiveTestBot", discriminator: "0000", bot: true };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockUser), { status: 200 })
    );

    const result = await discordUtil.validateBotToken("valid.token.here");
    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      "https://discord.com/api/v10/users/@me",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bot valid.token.here" }),
      })
    );
  });

  it("throws on 401 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("401: Unauthorized", { status: 401 })
    );

    await expect(discordUtil.validateBotToken("bad.token")).rejects.toThrow(
      /Discord token validation failed \(401\)/
    );
  });
});

describe("fetchWithRetry (via validateBotToken)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries after 429 with Retry-After header and resolves on second attempt", async () => {
    const mockUser = { id: "111", username: "HiveTestBot", discriminator: "0000", bot: true };

    // First call returns 429 with Retry-After: 1
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "1" },
      })
    );
    // Second call returns 200
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockUser), { status: 200 })
    );

    const promise = discordUtil.validateBotToken("token.here");

    // Advance timers past the 1100ms wait (1s Retry-After + 100ms buffer)
    await vi.advanceTimersByTimeAsync(1200);

    const result = await promise;
    expect(result).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits approximately (retryAfterSeconds * 1000) + 100ms before retrying", async () => {
    const mockUser = { id: "222", username: "Bot2", discriminator: "0001", bot: true };
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "1" },
      })
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockUser), { status: 200 })
    );

    const promise = discordUtil.validateBotToken("token.here");
    await vi.advanceTimersByTimeAsync(1200);
    await promise;

    // setTimeout should have been called with ~1100ms
    const waitCall = setTimeoutSpy.mock.calls.find(([, ms]) => typeof ms === "number" && (ms as number) >= 1100);
    expect(waitCall).toBeDefined();
    expect(waitCall![1]).toBe(1100);
  });
});

describe("discordUtil.getChannelMessages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws { status: 403, message } on 403 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Missing Access", { status: 403 })
    );

    await expect(
      discordUtil.getChannelMessages("token", "channel-id")
    ).rejects.toMatchObject({ status: 403 });
  });

  it("throws { status: 404, message } on 404 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unknown Channel", { status: 404 })
    );

    await expect(
      discordUtil.getChannelMessages("token", "channel-id")
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns message array on 200 response", async () => {
    const messages = [
      { id: "msg1", content: "Hello", timestamp: "2024-01-01T00:00:00Z", author: { id: "u1", username: "user1" } },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(messages), { status: 200 })
    );

    const result = await discordUtil.getChannelMessages("token", "channel-id", "prev-id");
    expect(result).toEqual(messages);

    // Verify afterId is included in query params
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("after=prev-id");
    expect(calledUrl).toContain("limit=100");
  });
});

describe("discordUtil.generateInviteUrl", () => {
  it("generates correct OAuth2 authorize URL", () => {
    const url = discordUtil.generateInviteUrl("123456789");
    expect(url).toContain("https://discord.com/oauth2/authorize");
    expect(url).toContain("client_id=123456789");
    expect(url).toContain("permissions=66560");
    expect(url).toContain("scope=bot");
  });
});

describe("discordUtil.getGuildChannels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters channels to types [0, 11, 12, 15] only", async () => {
    const allChannels = [
      { id: "1", name: "general", type: 0 },
      { id: "2", name: "announcements", type: 5 }, // news — should be filtered
      { id: "3", name: "thread", type: 11 },
      { id: "4", name: "priv-thread", type: 12 },
      { id: "5", name: "voice", type: 2 }, // voice — should be filtered
      { id: "6", name: "forum", type: 15 },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(allChannels), { status: 200 })
    );

    const result = await discordUtil.getGuildChannels("token", "guild-id");
    expect(result.map((c) => c.id)).toEqual(["1", "3", "4", "6"]);
  });
});

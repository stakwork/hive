import { optionalEnvVars } from "@/config/env";

const DISCORD_API_BASE = optionalEnvVars.DISCORD_API_BASE_URL;

/**
 * Decodes the first base64url segment of a bot token to extract the numeric
 * Application/Client ID. This is unofficial-but-stable Discord behaviour.
 * Returns null on any decode failure — callers must handle gracefully.
 */
export function extractClientIdFromToken(token: string): string | null {
  try {
    const firstSegment = token.split(".")[0];
    if (!firstSegment) return null;

    // base64url → base64 → decode
    const padded = firstSegment.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf8");

    // Must be a numeric string (Discord snowflake)
    if (/^\d+$/.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch with automatic retry on HTTP 429 (rate limit).
 * Reads the Retry-After header and waits (retryAfterSeconds * 1000 + 100ms).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  const response = await fetch(url, options);

  if (response.status === 429 && retries > 0) {
    const retryAfter = response.headers.get("Retry-After");
    const waitMs = retryAfter ? parseFloat(retryAfter) * 1000 + 100 : 1100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return fetchWithRetry(url, options, retries - 1);
  }

  return response;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  guild_id?: string;
}

export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
  };
}

export const discordUtil = {
  /**
   * Validates a bot token by calling GET /users/@me.
   * Throws on non-2xx response.
   */
  async validateBotToken(token: string): Promise<DiscordUser> {
    const response = await fetchWithRetry(`${DISCORD_API_BASE}/users/@me`, {
      headers: authHeaders(token),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Discord token validation failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<DiscordUser>;
  },

  /**
   * Returns guilds the bot belongs to via GET /users/@me/guilds.
   */
  async getBotGuilds(token: string): Promise<DiscordGuild[]> {
    const response = await fetchWithRetry(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: authHeaders(token),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch guilds (${response.status}): ${text}`);
    }

    return response.json() as Promise<DiscordGuild[]>;
  },

  /**
   * Returns channels for a guild, filtered to types: 0 (text), 11 (public thread),
   * 12 (private thread), 15 (forum).
   */
  async getGuildChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
    const response = await fetchWithRetry(
      `${DISCORD_API_BASE}/guilds/${guildId}/channels`,
      { headers: authHeaders(token) }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch channels for guild ${guildId} (${response.status}): ${text}`);
    }

    const channels = (await response.json()) as DiscordChannel[];
    return channels.filter((ch) => [0, 11, 12, 15].includes(ch.type));
  },

  /**
   * Fetches messages from a channel after a given message ID.
   * Throws { status, message } on 403 or 404 to trigger circuit breaker.
   */
  async getChannelMessages(
    token: string,
    channelId: string,
    afterId?: string,
    limit = 100
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (afterId) params.set("after", afterId);

    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages?${params}`;
    const response = await fetchWithRetry(url, { headers: authHeaders(token) });

    if (response.status === 403 || response.status === 404) {
      const text = await response.text().catch(() => response.statusText);
      throw { status: response.status, message: text };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Failed to fetch messages for channel ${channelId} (${response.status}): ${text}`);
    }

    return response.json() as Promise<DiscordMessage[]>;
  },

  /**
   * Generates a Discord OAuth2 bot invite URL.
   * permissions=66560: VIEW_CHANNEL (1024) + READ_MESSAGE_HISTORY (65536)
   */
  generateInviteUrl(clientId: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      permissions: "66560",
      scope: "bot",
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  },
};

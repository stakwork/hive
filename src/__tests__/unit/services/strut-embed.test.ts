/**
 * Unit tests for `mintStrutEmbedUrl` / `strutTargetErrorResponse`
 * (`services/strut-embed.ts`) — the shared mint path behind both the org
 * and workspace strut embed routes.
 *
 * Coverage:
 *   - Success builds `{mcp}/lab/?key=<jwt>` and runs both `ensure*` calls.
 *   - Client-facing errors are GENERIC: no upstream body, no raw decrypt
 *     text — those only reach server logs.
 *   - `ensure*` calls never run after a failed mint.
 *   - Delegation is skipped (with a warn log) when `target.orgId` is null;
 *     the Hive-key call still runs (it no-ops itself on a null orgId).
 *   - `strutTargetErrorResponse` maps every `StrutTargetError` to its status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockEnsureStrutDelegation, mockEnsureStrutHiveKey, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockEnsureStrutDelegation: vi.fn(),
  mockEnsureStrutHiveKey: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@/services/bifrost/strut-delegation", () => ({
  ensureStrutDelegation: mockEnsureStrutDelegation,
}));
vi.mock("@/services/strut-hive-key", () => ({
  ensureStrutHiveKey: mockEnsureStrutHiveKey,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mockLoggerWarn, error: mockLoggerError, info: vi.fn(), debug: vi.fn() },
}));

import { mintStrutEmbedUrl, strutTargetErrorResponse } from "@/services/strut-embed";
import type { StrutTarget } from "@/services/strut-target";

function target(over: Partial<StrutTarget> = {}): StrutTarget {
  return {
    swarmId: "swarm-1",
    workspaceId: "ws-1",
    workspaceSlug: "acme",
    orgId: "org-1",
    swarmUrl: "https://acme.sphinx.chat/api",
    mcpBase: "https://acme.sphinx.chat:3355",
    labBase: "https://acme.sphinx.chat:3355/lab",
    swarmApiKey: "dec-key",
    actor: "alice-user-1",
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureStrutDelegation.mockResolvedValue({ status: "fresh" });
  mockEnsureStrutHiveKey.mockResolvedValue("present");
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "mock.jwt.token" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mintStrutEmbedUrl", () => {
  it("mints, builds the /lab/?key= URL, and runs both ensure* calls", async () => {
    const t = target();
    const out = await mintStrutEmbedUrl(t, { userId: "user-1", host: "hive.test", ttlSeconds: 3600 });

    expect(out).toEqual({
      ok: true,
      url: "https://acme.sphinx.chat:3355/lab/?key=mock.jwt.token",
      expiresInSeconds: 3600,
    });

    const [mintUrl, init] = fetchMock.mock.calls[0];
    expect(mintUrl).toBe("https://acme.sphinx.chat:3355/mint-token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("dec-key");
    expect(JSON.parse(init.body as string)).toEqual({ expires_in: "1h", sub: "alice-user-1" });

    expect(mockEnsureStrutDelegation).toHaveBeenCalledWith(
      { workspaceId: "ws-1", workspaceSlug: "acme", userId: "user-1" },
      { swarmUrl: "https://acme.sphinx.chat/api", swarmApiKey: "dec-key" },
      { actor: "alice-user-1" },
    );
    expect(mockEnsureStrutHiveKey).toHaveBeenCalledWith(
      {
        swarmId: "swarm-1",
        workspaceId: "ws-1",
        orgId: "org-1",
        lab: { labBase: "https://acme.sphinx.chat:3355/lab", swarmApiKey: "dec-key" },
      },
      { publicBaseUrl: "hive.test", userId: "user-1" },
    );
  });

  it("uses an 8h expires_in string for an 8-hour TTL", async () => {
    await mintStrutEmbedUrl(target(), { userId: "u", host: "h", ttlSeconds: 8 * 3600 });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).expires_in).toBe("8h");
  });

  it("returns a generic error on a non-ok mint response; no upstream body leaks", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
      text: async () => '{"error":"super-secret-detail"}',
    });
    const out = await mintStrutEmbedUrl(target(), { userId: "u", host: "h", ttlSeconds: 3600 });
    expect(out).toEqual({ ok: false, status: 502, error: "Strut token mint failed (401)" });
    expect(JSON.stringify(out)).not.toContain("super-secret-detail");
    // The detail goes to server logs only.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Strut token mint failed",
      "STRUT_EMBED",
      expect.objectContaining({ status: 401, body: expect.stringContaining("super-secret-detail") }),
    );
  });

  it("returns a generic timeout error", async () => {
    fetchMock.mockImplementation(() => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });
    const out = await mintStrutEmbedUrl(target(), { userId: "u", host: "h", ttlSeconds: 3600 });
    expect(out).toEqual({ ok: false, status: 502, error: "Strut token mint timed out" });
  });

  it("does not run ensure* calls after a failed mint", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" });
    await mintStrutEmbedUrl(target(), { userId: "u", host: "h", ttlSeconds: 3600 });
    expect(mockEnsureStrutDelegation).not.toHaveBeenCalled();
    expect(mockEnsureStrutHiveKey).not.toHaveBeenCalled();
  });

  it("does not run ensure* calls when the mint throws", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
    await mintStrutEmbedUrl(target(), { userId: "u", host: "h", ttlSeconds: 3600 });
    expect(mockEnsureStrutDelegation).not.toHaveBeenCalled();
    expect(mockEnsureStrutHiveKey).not.toHaveBeenCalled();
  });

  it("skips the delegation push (with a warn log) when orgId is null; the Hive-key call still runs", async () => {
    const out = await mintStrutEmbedUrl(target({ orgId: null }), { userId: "u", host: "h", ttlSeconds: 3600 });
    expect(out.ok).toBe(true);
    expect(mockEnsureStrutDelegation).not.toHaveBeenCalled();
    expect(mockEnsureStrutHiveKey).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null }),
      expect.anything(),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Skipping strut delegation push: workspace has no sourceControlOrgId",
      "STRUT_EMBED",
      expect.objectContaining({ workspaceSlug: "acme", swarmId: "swarm-1" }),
    );
  });
});

describe("strutTargetErrorResponse", () => {
  it("maps every StrutTargetError to its status and a message with no raw internals", () => {
    expect(strutTargetErrorResponse({ type: "DECRYPT_FAILED", message: "raw decrypt detail" })).toEqual({
      status: 500,
      error: "Failed to decrypt swarm credentials",
    });
    expect(strutTargetErrorResponse({ type: "SWARM_NOT_CONFIGURED" })).toEqual({
      status: 503,
      error: "Swarm is missing swarmUrl or swarmApiKey",
    });
    expect(strutTargetErrorResponse({ type: "SWARM_NOT_ACTIVE", status: "PENDING" })).toEqual({
      status: 409,
      error: "The workspace swarm is not active (PENDING)",
    });
    expect(strutTargetErrorResponse({ type: "WORKSPACE_NOT_FOUND" })).toEqual({
      status: 404,
      error: "Workspace not found or access denied",
    });
    expect(strutTargetErrorResponse({ type: "ACCESS_DENIED" })).toEqual({
      status: 404,
      error: "Workspace not found or access denied",
    });
    expect(strutTargetErrorResponse({ type: "NO_ORG_SWARM" })).toEqual({
      status: 404,
      error: "No swarm configured for any workspace in this org",
    });
  });

  it("never includes the raw decrypt message in the client-facing text", () => {
    const { error } = strutTargetErrorResponse({ type: "DECRYPT_FAILED", message: "raw decrypt detail" });
    expect(error).not.toContain("raw decrypt detail");
  });
});

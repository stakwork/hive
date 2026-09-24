/**
 * Unit tests for the actor-secret push (`services/strut-actor-secret.ts`).
 *
 *   - PUT {lab}/actors/{actor}/secrets/{NAME} with BOTH credentials (mcp's
 *     x-api-token and strut's bearer), the value only in the body.
 *   - No value → skipped, strut never called. 404 → unsupported. Any
 *     failure → `failed`, never a throw. An invalid name is refused.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ensureStrutActorSecret, ensureStrutActorSecrets } from "@/services/strut-actor-secret";

const target = { labBase: "https://acme.sphinx.chat:3355/lab", swarmApiKey: "swarm-key" };
const mockFetch = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("ensureStrutActorSecret", () => {
  it("PUTs the value at the actor's URL with both credentials", async () => {
    mockFetch.mockResolvedValue(json(200, { ok: true }));
    const out = await ensureStrutActorSecret(target, "alice-user 1", "GITHUB_TOKEN", "ghp_secret");
    expect(out).toBe("pushed");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.sphinx.chat:3355/lab/actors/alice-user%201/secrets/GITHUB_TOKEN");
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-token"]).toBe("swarm-key");
    expect(headers.Authorization).toBe("Bearer swarm-key");
    expect(JSON.parse(init.body as string)).toEqual({ value: "ghp_secret" });
    // The token rides only in the body — never in the URL.
    expect(url).not.toContain("ghp_secret");
  });

  it("skips when there is no value, without calling strut", async () => {
    expect(await ensureStrutActorSecret(target, "a", "GITHUB_TOKEN", null)).toBe("skipped");
    expect(await ensureStrutActorSecret(target, "a", "GITHUB_TOKEN", "")).toBe("skipped");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an invalid secret name", async () => {
    expect(await ensureStrutActorSecret(target, "a", "bad-name", "v")).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("404 → unsupported (older strut); non-2xx → failed; a throw → failed", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { error: "no route" }));
    expect(await ensureStrutActorSecret(target, "a", "GITHUB_TOKEN", "v")).toBe("unsupported");
    mockFetch.mockResolvedValueOnce(json(500, { error: "boom" }));
    expect(await ensureStrutActorSecret(target, "a", "GITHUB_TOKEN", "v")).toBe("failed");
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await ensureStrutActorSecret(target, "a", "GITHUB_TOKEN", "v")).toBe("failed");
  });

  it("ensureStrutActorSecrets pushes each named value and reports per name", async () => {
    mockFetch.mockResolvedValue(json(200, { ok: true }));
    const out = await ensureStrutActorSecrets(target, "a", { GITHUB_TOKEN: "t", OTHER: undefined });
    expect(out).toEqual({ GITHUB_TOKEN: "pushed", OTHER: "skipped" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * Sphinx tokens (`lib/auth/sphinx-verify.ts`, docs/plans/sphinx-token-binding.md):
 * the bare token (a signature over a 4-byte timestamp) as it always was, and
 * the bound one, whose signature also covers Hive's host, the purpose and the
 * challenge — pinned by the plan's test vector.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPHINX_TOKEN_BOUND_TAG,
  sphinxTokenBoundPayload,
  verifySphinxToken,
  verifySphinxTokenBound,
  type SphinxTokenBinding,
} from "@/lib/auth/sphinx-verify";
import {
  bareSphinxToken,
  boundSphinxToken,
  nowSeconds,
  signLightning,
  sphinxKey,
  timestampBytes,
} from "@/__tests__/support/helpers/sphinx-token";

/** The plan's vector: a fixed key, 2026-11-01T00:00:00Z, Hive's production host. */
const VECTOR = {
  privateKey: "11".repeat(32),
  pubkey: "034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
  at: 1793491200,
  login: {
    binding: { host: "hive.sphinx.chat", purpose: "login", challenge: "0123456789abcdef".repeat(4) } as SphinxTokenBinding,
    payload:
      "6869766520737068696e7820746f6b656e2076320a686976652e737068696e782e636861740a6c6f67696e0a" +
      "30313233343536373839616263646566303132333435363738396162636465663031323334353637383961626364" +
      "6566303132333435363738396162636465660a6ae68100",
    token: "auaBABy0tOSbTyQ7W+rXRDmKMgm1Q7VZzll3JGR/VXpAOLkuDQdYEiO1OegJZE+OqQG4xGJOh3dsf0MLz7keru5x8w0d",
  },
  register: {
    binding: { host: "hive.sphinx.chat", purpose: "register", challenge: "" } as SphinxTokenBinding,
    payload: "6869766520737068696e7820746f6b656e2076320a686976652e737068696e782e636861740a72656769737465720a0a6ae68100",
    token: "auaBAByQxtWo/KykbPKNapagyNjEBIc1SZxgmxyTlipNWw/bRSXkC79xHVCbkG1T4y2zQMeisUG506lOyW+RAYgnpd5L",
  },
  bare: "auaBABwRpTmF0GK9FaHq6hkrfMn/z7qfGCEUT6uRyJLzDhcBvTE0AR0yHhK999oJFNzrCEfYdlmFD2FSh7V3UIic2mUH",
};

const HOST = "hive.sphinx.chat";
const K1 = "ab".repeat(32);
const login: SphinxTokenBinding = { host: HOST, purpose: "login", challenge: K1 };

describe("the test vector", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((VECTOR.at + 60) * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("is the fixed key's", () => {
    expect(sphinxKey(VECTOR.privateKey).pubkey).toBe(VECTOR.pubkey);
  });

  it("signs these bytes: the tag, host, purpose and challenge a line each, then the timestamp", () => {
    for (const { binding, payload } of [VECTOR.login, VECTOR.register]) {
      expect(sphinxTokenBoundPayload(binding, timestampBytes(VECTOR.at)).toString("hex")).toBe(payload);
    }
    expect(Buffer.from(VECTOR.login.payload, "hex").subarray(0, -4).toString("utf8")).toBe(
      `hive sphinx token v2\nhive.sphinx.chat\nlogin\n${VECTOR.login.binding.challenge}\n`,
    );
    expect(Buffer.from(VECTOR.login.payload, "hex").subarray(-4).readUInt32BE(0)).toBe(VECTOR.at);
    expect(SPHINX_TOKEN_BOUND_TAG).toBe("hive sphinx token v2");
  });

  it("signs to the pinned tokens (RFC 6979), which verify bound and not bare", async () => {
    const { priv } = sphinxKey(VECTOR.privateKey);
    for (const { binding, token } of [VECTOR.login, VECTOR.register]) {
      expect(await boundSphinxToken(priv, binding, VECTOR.at)).toBe(token);
      expect(verifySphinxTokenBound(token, VECTOR.pubkey, binding)).toEqual({ valid: true });
      expect(verifySphinxToken(token, VECTOR.pubkey)).toEqual({ valid: false, reason: "Invalid signature" });
    }
    expect(verifySphinxTokenBound(VECTOR.login.token, VECTOR.pubkey, VECTOR.register.binding).valid).toBe(false);
  });

  it("the bare vector verifies bare, and not bound", async () => {
    expect(await bareSphinxToken(sphinxKey(VECTOR.privateKey).priv, VECTOR.at)).toBe(VECTOR.bare);
    expect(verifySphinxToken(VECTOR.bare, VECTOR.pubkey)).toEqual({ valid: true });
    expect(verifySphinxTokenBound(VECTOR.bare, VECTOR.pubkey, VECTOR.login.binding)).toEqual({
      valid: false,
      reason: "Invalid signature",
    });
  });
});

describe("verifySphinxToken (bare)", () => {
  it("takes the key's signature over a recent timestamp", async () => {
    const key = sphinxKey();
    expect(verifySphinxToken(await bareSphinxToken(key.priv), key.pubkey)).toEqual({ valid: true });
  });

  it("refuses another key's, a stale or future one, a bound one, and a malformed one", async () => {
    const key = sphinxKey();
    const other = sphinxKey();
    expect(verifySphinxToken(await bareSphinxToken(other.priv), key.pubkey)).toEqual({ valid: false, reason: "Invalid signature" });
    expect(verifySphinxToken(await bareSphinxToken(key.priv, nowSeconds() - 600), key.pubkey)).toEqual({
      valid: false,
      reason: "Token expired",
    });
    expect(verifySphinxToken(await bareSphinxToken(key.priv, nowSeconds() + 600), key.pubkey)).toEqual({
      valid: false,
      reason: "Token timestamp is in the future",
    });
    expect(verifySphinxToken(await boundSphinxToken(key.priv, login), key.pubkey)).toEqual({
      valid: false,
      reason: "Invalid signature",
    });
    expect(verifySphinxToken("not-a-token", key.pubkey)).toEqual({ valid: false, reason: "Invalid token format" });
  });

  it("skips the window when told to, as before", async () => {
    const key = sphinxKey();
    expect(verifySphinxToken(await bareSphinxToken(key.priv, nowSeconds() - 600), key.pubkey, false)).toEqual({ valid: true });
  });
});

describe("verifySphinxTokenBound", () => {
  it("takes the key's signature over this host, purpose and challenge", async () => {
    const key = sphinxKey();
    expect(verifySphinxTokenBound(await boundSphinxToken(key.priv, login), key.pubkey, login)).toEqual({ valid: true });
    const register: SphinxTokenBinding = { host: HOST, purpose: "register", challenge: "" };
    expect(verifySphinxTokenBound(await boundSphinxToken(key.priv, register), key.pubkey, register)).toEqual({ valid: true });
  });

  it("refuses a token signed for another host, purpose or challenge", async () => {
    const key = sphinxKey();
    const token = await boundSphinxToken(key.priv, login);
    for (const binding of [
      { ...login, host: "hive-staging.sphinx.chat" },
      { ...login, host: "hive.sphinx.chat:443" },
      { ...login, purpose: "register" as const },
      { ...login, challenge: "cd".repeat(32) },
      { ...login, challenge: "" },
    ]) {
      expect(verifySphinxTokenBound(token, key.pubkey, binding)).toEqual({ valid: false, reason: "Invalid signature" });
    }
  });

  it("refuses a bare token, another key's, and a signature over the payload without its timestamp", async () => {
    const key = sphinxKey();
    const other = sphinxKey();
    expect(verifySphinxTokenBound(await bareSphinxToken(key.priv), key.pubkey, login)).toEqual({
      valid: false,
      reason: "Invalid signature",
    });
    expect(verifySphinxTokenBound(await boundSphinxToken(other.priv, login), key.pubkey, login)).toEqual({
      valid: false,
      reason: "Invalid signature",
    });
    const stamp = timestampBytes(nowSeconds());
    const lines = sphinxTokenBoundPayload(login, stamp).subarray(0, -4);
    const truncated = Buffer.concat([stamp, await signLightning(key.priv, lines)]).toString("base64");
    expect(verifySphinxTokenBound(truncated, key.pubkey, login).valid).toBe(false);
  });

  it("keeps the bare token's window", async () => {
    const key = sphinxKey();
    expect(verifySphinxTokenBound(await boundSphinxToken(key.priv, login, nowSeconds() - 301), key.pubkey, login)).toEqual({
      valid: false,
      reason: "Token expired",
    });
    expect(verifySphinxTokenBound(await boundSphinxToken(key.priv, login, nowSeconds() + 60), key.pubkey, login)).toEqual({
      valid: false,
      reason: "Token timestamp is in the future",
    });
    expect(verifySphinxTokenBound("not-a-token", key.pubkey, login)).toEqual({ valid: false, reason: "Invalid token format" });
  });

  it("refuses a binding with a field over two lines, no host, or an unknown purpose", async () => {
    const key = sphinxKey();
    const token = await boundSphinxToken(key.priv, login);
    for (const binding of [
      { ...login, challenge: `${K1}\nregister` },
      { ...login, host: "" },
      { ...login, purpose: "logout" as SphinxTokenBinding["purpose"] },
    ]) {
      expect(verifySphinxTokenBound(token, key.pubkey, binding)).toEqual({ valid: false, reason: "Invalid token binding" });
      expect(() => sphinxTokenBoundPayload(binding, timestampBytes(nowSeconds()))).toThrow(/Invalid Sphinx token binding/);
    }
  });
});

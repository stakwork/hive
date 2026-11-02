/**
 * Which Sphinx token a route takes (`lib/auth/sphinx-token-accept.ts`): the
 * bare one or the bound one, the bare one refused once
 * `SPHINX_TOKEN_REQUIRE_BOUND` is on, and the host a bound token names.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { acceptSphinxToken, BARE_TOKEN_REFUSED, sphinxTokenHost } from "@/lib/auth/sphinx-token-accept";
import { bareSphinxToken, boundSphinxToken, nowSeconds, sphinxKey } from "@/__tests__/support/helpers/sphinx-token";

const HOST = "hive.sphinx.chat";
const K1 = "ab".repeat(32);
const context = { host: HOST, purpose: "login" as const, challenge: K1 };

const savedFlag = process.env.SPHINX_TOKEN_REQUIRE_BOUND;
const savedUrl = process.env.NEXTAUTH_URL;
afterEach(() => {
  for (const [name, value] of [
    ["SPHINX_TOKEN_REQUIRE_BOUND", savedFlag],
    ["NEXTAUTH_URL", savedUrl],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("acceptSphinxToken", () => {
  it("takes the bare token and the bound one, and says which", async () => {
    const key = sphinxKey();
    expect(acceptSphinxToken(await bareSphinxToken(key.priv), key.pubkey, context)).toEqual({ valid: true, format: "bare" });
    expect(acceptSphinxToken(await boundSphinxToken(key.priv, context), key.pubkey, context)).toEqual({
      valid: true,
      format: "bound",
    });
  });

  it("takes no bound token where the request names no challenge", async () => {
    const key = sphinxKey();
    const token = await boundSphinxToken(key.priv, { ...context, challenge: "" });
    expect(acceptSphinxToken(token, key.pubkey, { ...context, challenge: null })).toEqual({
      valid: false,
      reason: "Invalid signature",
    });
  });

  it("refuses a bound token for another purpose, challenge or host", async () => {
    const key = sphinxKey();
    const token = await boundSphinxToken(key.priv, context);
    for (const other of [
      { ...context, purpose: "register" as const, challenge: "" },
      { ...context, challenge: "cd".repeat(32) },
      { ...context, host: "localhost:3000" },
    ]) {
      expect(acceptSphinxToken(token, key.pubkey, other).valid).toBe(false);
    }
  });

  it("with SPHINX_TOKEN_REQUIRE_BOUND, refuses the bare token by name and still takes the bound one", async () => {
    process.env.SPHINX_TOKEN_REQUIRE_BOUND = "true";
    const key = sphinxKey();
    expect(acceptSphinxToken(await bareSphinxToken(key.priv), key.pubkey, context)).toEqual({
      valid: false,
      reason: BARE_TOKEN_REFUSED,
    });
    expect(acceptSphinxToken(await bareSphinxToken(key.priv), key.pubkey, { ...context, challenge: null })).toEqual({
      valid: false,
      reason: BARE_TOKEN_REFUSED,
    });
    expect(acceptSphinxToken(await boundSphinxToken(key.priv, context), key.pubkey, context)).toEqual({
      valid: true,
      format: "bound",
    });
    expect(acceptSphinxToken(await boundSphinxToken(key.priv, context, nowSeconds() - 600), key.pubkey, context)).toEqual({
      valid: false,
      reason: "Token expired",
    });
  });

  it("anything but `true` leaves the bare token accepted", async () => {
    const key = sphinxKey();
    for (const value of ["", "false", "1", "yes"]) {
      process.env.SPHINX_TOKEN_REQUIRE_BOUND = value;
      expect(acceptSphinxToken(await bareSphinxToken(key.priv), key.pubkey, context).valid).toBe(true);
    }
    process.env.SPHINX_TOKEN_REQUIRE_BOUND = " TRUE ";
    expect(acceptSphinxToken(await bareSphinxToken(key.priv), key.pubkey, context).valid).toBe(false);
  });
});

describe("sphinxTokenHost", () => {
  const request = new NextRequest("https://hive-preview.example.com/api/auth/sphinx/token", { method: "POST" });

  it("is NEXTAUTH_URL's host, port included — what the sign-in QR names — whatever the request's", () => {
    process.env.NEXTAUTH_URL = "https://hive.sphinx.chat";
    expect(sphinxTokenHost(request)).toBe("hive.sphinx.chat");
    process.env.NEXTAUTH_URL = "http://localhost:3000/";
    expect(sphinxTokenHost(request)).toBe("localhost:3000");
  });

  it("is the request's when NEXTAUTH_URL is unset or not a URL", () => {
    delete process.env.NEXTAUTH_URL;
    expect(sphinxTokenHost(request)).toBe("hive-preview.example.com");
    process.env.NEXTAUTH_URL = "not a url";
    expect(sphinxTokenHost(request)).toBe("hive-preview.example.com");
  });
});

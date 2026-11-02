/**
 * The Sphinx QR sign-in's verify step, on both paths that take it
 * (`/verify/[challenge]?token=`, which the Sphinx apps call, and
 * `/api/auth/sphinx/verify/[challenge]`): the bare token as always, the
 * bound one (docs/plans/sphinx-token-binding.md) signed for the host and k1
 * the challenge's deep link names, and the bare one refused once
 * `SPHINX_TOKEN_REQUIRE_BOUND` is on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createChallenge } from "@/app/api/auth/sphinx/challenge/route";
import { POST as verifyApi } from "@/app/api/auth/sphinx/verify/[challenge]/route";
import { POST as verifyApp } from "@/app/verify/[challenge]/route";
import { invokeRoute } from "@/__tests__/harness/route";
import { BARE_TOKEN_REFUSED } from "@/lib/auth/sphinx-token-accept";
import type { SphinxTokenBinding } from "@/lib/auth/sphinx-verify";
import { db } from "@/lib/db";
import { bareSphinxToken, boundSphinxToken, sphinxKey } from "@/__tests__/support/helpers/sphinx-token";

/** A challenge as the browser gets it: its k1 and the host its deep link hands the Sphinx app. */
async function challenge() {
  const res = await invokeRoute(createChallenge as never, { method: "POST", url: "http://localhost/api/auth/sphinx/challenge" });
  expect(res.status).toBe(200);
  const { challenge: k1, deepLink } = await res.json<{ challenge: string; deepLink: string }>();
  const host = new URLSearchParams(deepLink.split("?")[1]).get("host")!;
  return { k1, login: { host, purpose: "login", challenge: k1 } as SphinxTokenBinding };
}

const routes = [
  {
    name: "/verify/[challenge]",
    verify: (k1: string, token: string, pubkey: string) =>
      invokeRoute(verifyApp as never, {
        method: "POST",
        url: `http://localhost/verify/${k1}?token=${encodeURIComponent(token)}`,
        body: { pubkey, alias: "Alice" },
        params: { challenge: k1 },
      }),
  },
  {
    name: "/api/auth/sphinx/verify/[challenge]",
    verify: (k1: string, token: string, pubkey: string) =>
      invokeRoute(verifyApi as never, {
        method: "POST",
        url: `http://localhost/api/auth/sphinx/verify/${k1}`,
        body: { token, pubkey, alias: "Alice" },
        params: { challenge: k1 },
      }),
  },
];

const stored = (k1: string) => db.sphinxChallenge.findUnique({ where: { k1 }, select: { used: true, pubkey: true } });

const savedFlag = process.env.SPHINX_TOKEN_REQUIRE_BOUND;

beforeEach(async () => {
  await db.sphinxChallenge.deleteMany({});
});

afterEach(async () => {
  if (savedFlag === undefined) delete process.env.SPHINX_TOKEN_REQUIRE_BOUND;
  else process.env.SPHINX_TOKEN_REQUIRE_BOUND = savedFlag;
  await db.sphinxChallenge.deleteMany({});
});

describe.each(routes)("POST $name", ({ verify }) => {
  it("takes the bare token, as the Sphinx apps sign it today", async () => {
    const { k1 } = await challenge();
    const node = sphinxKey();
    const res = await verify(k1, await bareSphinxToken(node.priv), node.pubkey);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, tokenFormat: "bare" });
    expect(await stored(k1)).toEqual({ used: true, pubkey: node.pubkey });
  });

  it("takes a token bound to the host and k1 the deep link named", async () => {
    const { k1, login } = await challenge();
    const node = sphinxKey();
    const res = await verify(k1, await boundSphinxToken(node.priv, login), node.pubkey);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, tokenFormat: "bound" });
    expect(await stored(k1)).toEqual({ used: true, pubkey: node.pubkey });
  });

  it("refuses a bound token for another challenge, another purpose or another host, and the challenge stays open", async () => {
    const { k1, login } = await challenge();
    const other = await challenge();
    const node = sphinxKey();
    for (const binding of [
      other.login,
      { ...login, purpose: "register" as const },
      { ...login, host: "hive-staging.sphinx.chat" },
    ]) {
      const res = await verify(k1, await boundSphinxToken(node.priv, binding), node.pubkey);
      expect(res.status).toBe(401);
      expect((await res.json<{ error: string }>()).error).toBe("Invalid signature");
    }
    expect(await stored(k1)).toEqual({ used: false, pubkey: null });
  });

  it("with SPHINX_TOKEN_REQUIRE_BOUND, refuses the bare token and takes the bound one", async () => {
    process.env.SPHINX_TOKEN_REQUIRE_BOUND = "true";
    const { k1, login } = await challenge();
    const node = sphinxKey();

    const bare = await verify(k1, await bareSphinxToken(node.priv), node.pubkey);
    expect(bare.status).toBe(401);
    expect((await bare.json<{ error: string }>()).error).toBe(BARE_TOKEN_REFUSED);
    expect(await stored(k1)).toEqual({ used: false, pubkey: null });

    const bound = await verify(k1, await boundSphinxToken(node.priv, login), node.pubkey);
    expect(bound.status).toBe(200);
    expect(await bound.json()).toMatchObject({ success: true, tokenFormat: "bound" });
  });
});

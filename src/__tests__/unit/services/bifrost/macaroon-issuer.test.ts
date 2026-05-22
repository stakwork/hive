import { describe, it, expect, vi, beforeEach } from "vitest";
import * as secp from "@noble/secp256k1";

import {
  decodeMacaroon,
  ecdsaPublicKey,
  bytesToHex,
  verify,
  type Policy,
} from "gatekey";

import {
  mintInvocationMacaroon,
  MacaroonIssuerError,
} from "@/services/bifrost/macaroon-issuer";
import {
  MACAROON_DEFAULT_MAX_COST_USD,
  MACAROON_DEFAULT_MAX_STEPS,
} from "@/services/bifrost/constants";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Bypass Redis lock in unit tests.
vi.mock("@/lib/locks/redis-lock", () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  LockAcquireTimeoutError: class LockAcquireTimeoutError extends Error {},
}));

// Encryption mock — round-trips a JSON envelope, identical to the
// pattern used by `macaroon-org-keys.test.ts` / `macaroon-user-keys.test.ts`.
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((_field: string, value: string) => ({
        data: value,
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "2026-01-01T00:00:00Z",
      })),
      decryptField: vi.fn((_field: string, input: unknown) => {
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            if (typeof parsed?.data === "string") return parsed.data;
          } catch {
            // fall through
          }
        }
        if (input && typeof input === "object") {
          const v = (input as { data?: unknown }).data;
          if (typeof v === "string") return v;
        }
        throw new Error("Invalid encrypted data format");
      }),
    })),
  },
}));

const WORKSPACE_ID = "ws_1";
const WORKSPACE_SLUG = "acme-ws";
const USER_ID = "user_1";
const SC_ORG_ID = "scorg_1";
const GITHUB_LOGIN = "acme";

// Pre-computed deterministic key material so we can both sign (via the
// issuer) and verify (here in the test) with the same secret. The
// alternative — generating randomly per-test and parsing it back out
// of the mock — is more fragile and harder to debug when it breaks.
const ORG_PRIV_HEX =
  "1111111111111111111111111111111111111111111111111111111111111111";
const ORG_PUB_HEX = bytesToHex(ecdsaPublicKey(secp.etc.hexToBytes(ORG_PRIV_HEX)));

// User key: any 32 random bytes is a valid ed25519 seed; gatekey
// derives the pubkey on demand inside `signInvocation` so we don't
// need to pre-compute it for the test setup. The autogen path inside
// the issuer will write whatever pubkey it derives back into the
// mocked DB; we read that out of the verify result to assert binding.
const USER_PRIV_HEX =
  "2222222222222222222222222222222222222222222222222222222222222222";

/**
 * Pre-seed the prisma mock with workspace, sourceControlOrg (with
 * pre-minted org keys) and user (with pre-minted user keys) so the
 * issuer's autogen paths short-circuit and we deterministically sign
 * with the fixture keys above.
 */
function seedHappyPath() {
  vi.mocked(dbMock.workspace.findUnique).mockResolvedValue({
    id: WORKSPACE_ID,
    slug: WORKSPACE_SLUG,
    sourceControlOrgId: SC_ORG_ID,
  } as never);

  // org-keys autogen will skip (all three populated)
  vi.mocked(dbMock.sourceControlOrg.findUnique).mockResolvedValue({
    id: SC_ORG_ID,
    githubLogin: GITHUB_LOGIN,
    macaroonOrgId: `gh_${GITHUB_LOGIN}`,
    macaroonOrgPubkey: ORG_PUB_HEX,
    macaroonOrgPrivkey: JSON.stringify({ data: ORG_PRIV_HEX }),
  } as never);

  // user-keys autogen will skip (both populated). We compute the
  // pubkey from USER_PRIV_HEX via gatekey at runtime so it stays in
  // sync if gatekey ever changes derivation.
  return import("gatekey").then(({ ed25519PublicKey, bytesToHex }) => {
    const userPubHex = bytesToHex(
      ed25519PublicKey(secp.etc.hexToBytes(USER_PRIV_HEX)),
    );
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      macaroonUserPubkey: userPubHex,
      macaroonUserPrivkey: JSON.stringify({ data: USER_PRIV_HEX }),
    } as never);
    return { userPubHex };
  });
}

const policy: Policy = {
  type: "single",
  key: { alg: "ecdsa-secp256k1-sha256", key: ORG_PUB_HEX },
};

describe("mintInvocationMacaroon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints a macaroon that round-trips through gatekey's verifier", async () => {
    await seedHappyPath();

    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "ask-repo-agent",
      maxCostUsd: 5,
      maxSteps: 100,
      ttlSeconds: 600,
    });

    // Shape of the returned envelope.
    expect(minted.token).toEqual(expect.any(String));
    expect(minted.token.length).toBeGreaterThan(0);
    expect(minted.orgId).toBe(`gh_${GITHUB_LOGIN}`);
    expect(minted.userId).toBe(USER_ID);
    expect(minted.agentName).toBe("ask-repo-agent");
    expect(minted.runId).toMatch(/^[0-9a-f-]{36}$/i); // UUID
    expect(new Date(minted.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The real test: the macaroon verifies end-to-end with the
    // same policy a real plugin would use. This catches: bad JCS
    // canonicalization, wrong signature scheme, wrong key binding,
    // wrong narrowing between layers — all the cross-language
    // contract issues fixtures catch on the gatekey side.
    //
    // Phase-11 claims surface: `agent_name` is the leaf of
    // `effective_caveats.agents` (here, the single-element invocation
    // list); `realm` is gone — the swarm carries its own self-identity
    // on the trust registry, not on the macaroon.
    const claims = verify(minted.token, policy, new Date());
    expect(claims.org_id).toBe(`gh_${GITHUB_LOGIN}`);
    expect(claims.user_id).toBe(USER_ID);
    expect(claims.agent_name).toBe("ask-repo-agent");
    expect(claims.run_id).toBe(minted.runId);
    expect(claims.effective_caveats.max_cost_usd).toBe(5);
    expect(claims.effective_caveats.max_steps).toBe(100);
    expect(claims.effective_caveats.agents).toEqual(["ask-repo-agent"]);
    // Issuer mints simple-deployment macaroons: no `budget` block,
    // no `realm_budgets`. Permitted-realms passes through as null.
    expect(claims.effective_caveats.budget).toBeNull();
    expect(claims.permitted_realms).toBeNull();
  });

  it("respects a caller-supplied runId", async () => {
    await seedHappyPath();
    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "diagram-creator",
      runId: "run_explicit_xyz",
    });
    expect(minted.runId).toBe("run_explicit_xyz");

    const claims = verify(minted.token, policy, new Date());
    expect(claims.run_id).toBe("run_explicit_xyz");
  });

  it("applies the default budget / ttl when not supplied", async () => {
    await seedHappyPath();
    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "default-agent",
    });
    const claims = verify(minted.token, policy, new Date());
    // Defaults from constants.ts — imported so this test tracks the
    // source of truth instead of asserting magic numbers.
    expect(claims.effective_caveats.max_cost_usd).toBe(
      MACAROON_DEFAULT_MAX_COST_USD,
    );
    expect(claims.effective_caveats.max_steps).toBe(MACAROON_DEFAULT_MAX_STEPS);
    // ~1h from now ±60s (allow for clock skew in CI).
    const expMs = new Date(claims.effective_caveats.exp).getTime();
    const expected = Date.now() + 3600_000;
    expect(Math.abs(expMs - expected)).toBeLessThan(60_000);
  });

  it("emits a parseable, base64url-encoded macaroon envelope", async () => {
    await seedHappyPath();
    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "parse-test",
    });

    // Phase-11 wire shape: `agents` is top-level on the UA (no more
    // `permissions` wrapper), and the invocation no longer carries a
    // singular `realm` field. The issuer omits the optional `budget`
    // block entirely — simple-deployment mode.
    const parsed = decodeMacaroon(minted.token);
    expect(parsed.v).toBe(1);
    expect(parsed.org_id).toBe(`gh_${GITHUB_LOGIN}`);
    expect(parsed.user_authorization.user_id).toBe(USER_ID);
    expect(parsed.user_authorization.user_pubkey.alg).toBe("ed25519");
    expect(parsed.user_authorization.agents).toEqual(["parse-test"]);
    expect(parsed.user_authorization.budget).toBeUndefined();
    expect(parsed.invocation.agents).toEqual(["parse-test"]);
    expect(parsed.invocation.budget).toBeUndefined();
    expect(parsed.invocation.user_sig.alg).toBe("ed25519");
    expect(parsed.attenuations).toEqual([]);
  });

  it("throws MacaroonIssuerError when the workspace doesn't exist", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce(
      null as never,
    );

    await expect(
      mintInvocationMacaroon({
        workspaceId: "missing",
        userId: USER_ID,
        agentName: "x",
      }),
    ).rejects.toBeInstanceOf(MacaroonIssuerError);
  });

  it("throws MacaroonIssuerError when the workspace has no sourceControlOrgId", async () => {
    vi.mocked(dbMock.workspace.findUnique).mockResolvedValueOnce({
      id: WORKSPACE_ID,
      slug: WORKSPACE_SLUG,
      sourceControlOrgId: null,
    } as never);

    await expect(
      mintInvocationMacaroon({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        agentName: "x",
      }),
    ).rejects.toBeInstanceOf(MacaroonIssuerError);
  });

  it("rejects empty required fields", async () => {
    await expect(
      mintInvocationMacaroon({
        workspaceId: "",
        userId: USER_ID,
        agentName: "x",
      }),
    ).rejects.toBeInstanceOf(MacaroonIssuerError);

    await expect(
      mintInvocationMacaroon({
        workspaceId: WORKSPACE_ID,
        userId: "",
        agentName: "x",
      }),
    ).rejects.toBeInstanceOf(MacaroonIssuerError);

    await expect(
      mintInvocationMacaroon({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        agentName: "",
      }),
    ).rejects.toBeInstanceOf(MacaroonIssuerError);
  });

  it("stamps `{githubLogin}-{userId}` as the macaroon user_id when a login is present", async () => {
    await seedHappyPath();
    // Override the default user fixture to include a GitHub login so
    // the issuer's `buildBifrostName` call resolves to the
    // human-readable form. Pubkey/privkey are carried over from the
    // happy-path seed via `mockResolvedValue`'s last-write-wins.
    const { ed25519PublicKey, bytesToHex } = await import("gatekey");
    const userPubHex = bytesToHex(
      ed25519PublicKey(secp.etc.hexToBytes(USER_PRIV_HEX)),
    );
    vi.mocked(dbMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      macaroonUserPubkey: userPubHex,
      macaroonUserPrivkey: JSON.stringify({ data: USER_PRIV_HEX }),
      githubAuth: { githubUsername: "alice" },
    } as never);

    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "ask-repo-agent",
    });

    expect(minted.userId).toBe(USER_ID); // immutable cuid echoed back
    expect(minted.macaroonUserId).toBe(`alice-${USER_ID}`);

    const claims = verify(minted.token, policy, new Date());
    expect(claims.user_id).toBe(`alice-${USER_ID}`);
  });

  it("falls back to bare userId when no GitHub login is on file", async () => {
    await seedHappyPath();
    // Default `seedHappyPath` user fixture omits `githubAuth`, so the
    // optional-chain in the issuer resolves to `null` and
    // `buildBifrostName` returns the bare `userId`.
    const minted = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "ask-repo-agent",
    });
    expect(minted.macaroonUserId).toBe(USER_ID);
    const claims = verify(minted.token, policy, new Date());
    expect(claims.user_id).toBe(USER_ID);
  });

  it("each mint produces a fresh nonce pair", async () => {
    await seedHappyPath();
    const a = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "nonce-test",
    });
    const b = await mintInvocationMacaroon({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      agentName: "nonce-test",
    });
    const aParsed = decodeMacaroon(a.token);
    const bParsed = decodeMacaroon(b.token);
    expect(aParsed.user_authorization.nonce).not.toBe(
      bParsed.user_authorization.nonce,
    );
    expect(aParsed.invocation.nonce).not.toBe(bParsed.invocation.nonce);
    // Same shape (32 hex chars) — matches phase-4 nonce spec.
    expect(aParsed.user_authorization.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(aParsed.invocation.nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

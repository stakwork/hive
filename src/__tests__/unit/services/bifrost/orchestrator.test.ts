import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the per-layer reconcilers BEFORE importing the SUT. The
// orchestrator imports them by their concrete module paths
// (`./reconciler`, `./trust-reconciler`, `./macaroon-issuer`), so we
// mock those — NOT the `@/services/bifrost` barrel — to make sure
// the binding the orchestrator actually uses is the stubbed one.
vi.mock("@/services/bifrost/reconciler", () => ({
  reconcileBifrostVK: vi.fn(),
}));

vi.mock("@/services/bifrost/trust-reconciler", () => ({
  ensureBifrostTrust: vi.fn(async () => ({
    workspaceId: "ws-1",
    status: "cached" as const,
    macaroonOrgId: "gh_stakwork",
    macaroonOrgPubkey: "02" + "ab".repeat(32),
  })),
}));

vi.mock("@/services/bifrost/macaroon-issuer", () => ({
  mintInvocationMacaroon: vi.fn(),
  MacaroonIssuerError: class MacaroonIssuerError extends Error {},
}));

// The rollout gate lives in `isBifrostEnabledForWorkspace`, which
// reads `process.env.BIFROST_ENABLED` directly. Manipulate the env
// var per-test rather than mocking the field on `optionalEnvVars`.

const { getBifrostForLLM } = await import(
  "@/services/bifrost/orchestrator"
);
const reconcilerModule = await import("@/services/bifrost/reconciler");
const trustModule = await import("@/services/bifrost/trust-reconciler");
const issuerModule = await import("@/services/bifrost/macaroon-issuer");

const auth = {
  workspaceId: "ws-1",
  workspaceSlug: "ws-slug",
  userId: "u_alice",
};

// Fixture must be a real `BifrostAgentName` value — the orchestrator
// types `opts.agentName` against the union exported from
// `services/bifrost/orchestrator`. Pick `repo-agent` as a neutral
// placeholder; tests that care about the dim itself opt into other
// values explicitly.
const AGENT = { agentName: "repo-agent" } as const;

const ORIGINAL_BIFROST_ENABLED = process.env.BIFROST_ENABLED;
const ORIGINAL_BIFROST_ENABLED_AGENTS = process.env.BIFROST_ENABLED_AGENTS;

/** Sensible default mint result for the happy path. */
function mockMintOk(runId = "run_fixed_abc") {
  vi.mocked(issuerModule.mintInvocationMacaroon).mockResolvedValueOnce({
    token: "macaroon-token-base64url",
    orgId: "gh_stakwork",
    userId: auth.userId,
    // Default fixture has no GitHub login wired, so the wire-form id
    // falls through to the bare `userId` — same shape as
    // `buildBifrostName(userId, null)`.
    macaroonUserId: auth.userId,
    agentName: AGENT.agentName,
    runId,
    // Realm is the slug now — see macaroon-issuer's `realm` JSDoc.
    realm: auth.workspaceSlug,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

function mockVKOk(overrides: Partial<{ vkValue: string; baseUrl: string }> = {}) {
  vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
    workspaceId: "ws-1",
    userId: "u_alice",
    customerId: "cust-1",
    vkId: "vk-1",
    vkValue: overrides.vkValue ?? "sk-bf-LIVE",
    baseUrl: overrides.baseUrl ?? "http://bifrost.test:8181",
    created: false,
  });
}

describe("getBifrostForLLM (master reconciler)", () => {
  beforeEach(() => {
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockReset();
    vi.mocked(trustModule.ensureBifrostTrust).mockReset();
    vi.mocked(issuerModule.mintInvocationMacaroon).mockReset();
    // Default: trust reconcile succeeds (cache hit). Individual tests
    // override to exercise the failure path.
    vi.mocked(trustModule.ensureBifrostTrust).mockResolvedValue({
      workspaceId: "ws-1",
      status: "cached",
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "ab".repeat(32),
    });
    delete process.env.BIFROST_ENABLED;
    // Agent gate is default-open (empty == allow-all) so leaving it
    // unset matches the prod default for every workspace gate state.
    delete process.env.BIFROST_ENABLED_AGENTS;
  });

  afterEach(() => {
    if (ORIGINAL_BIFROST_ENABLED === undefined) {
      delete process.env.BIFROST_ENABLED;
    } else {
      process.env.BIFROST_ENABLED = ORIGINAL_BIFROST_ENABLED;
    }
    if (ORIGINAL_BIFROST_ENABLED_AGENTS === undefined) {
      delete process.env.BIFROST_ENABLED_AGENTS;
    } else {
      process.env.BIFROST_ENABLED_AGENTS = ORIGINAL_BIFROST_ENABLED_AGENTS;
    }
  });

  // ── Rollout gate ─────────────────────────────────────────────────────

  it("returns undefined and never calls any reconciler when the gate is unset", async () => {
    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it("returns undefined when BIFROST_ENABLED=true but workspaceAuth is missing", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await getBifrostForLLM(undefined, AGENT);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it("returns undefined for the public viewer even when enabled", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await getBifrostForLLM(
      {
        workspaceId: "ws-1",
        workspaceSlug: "ws-slug",
        userId: "__public_viewer__",
      },
      AGENT,
    );
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it("returns undefined when agentName is empty (defensive runtime check)", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Empty string is blocked at compile time by the
    // `BifrostAgentName` union — this test pins the RUNTIME defensive
    // check that catches a future `any`-typed caller bypassing the
    // type. Cast deliberate.
    const result = await getBifrostForLLM(auth, {
      agentName: "" as unknown as (typeof AGENT)["agentName"],
    });
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  // ── Happy path ──────────────────────────────────────────────────────

  it("returns { apiKey, baseUrl, headers, runId, agentName } on success", async () => {
    process.env.BIFROST_ENABLED = "true";
    mockVKOk();
    mockMintOk("run_fixed_abc");

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toEqual({
      apiKey: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
      headers: { "x-macaroon": "macaroon-token-base64url" },
      runId: "run_fixed_abc",
      agentName: "repo-agent",
    });
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: undefined },
    );
    expect(issuerModule.mintInvocationMacaroon).toHaveBeenCalledTimes(1);
  });

  it("forwards the caller's model to the reconciler", async () => {
    process.env.BIFROST_ENABLED = "true";
    mockVKOk({ baseUrl: "http://bifrost.test:8181/openai/v1" });
    mockMintOk();

    const result = await getBifrostForLLM(auth, {
      agentName: "repo-agent",
      model: "gpt-5",
    });
    expect(result?.baseUrl).toBe("http://bifrost.test:8181/openai/v1");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: "gpt-5" },
    );
  });

  it("forwards caller-supplied runId + budget overrides to the issuer", async () => {
    process.env.BIFROST_ENABLED = "true";
    mockVKOk();
    mockMintOk("run_caller_xyz");

    const result = await getBifrostForLLM(auth, {
      agentName: "diagram-agent",
      runId: "run_caller_xyz",
      maxCostUsd: 1.5,
      maxSteps: 50,
      ttlSeconds: 300,
    });
    expect(result?.runId).toBe("run_caller_xyz");
    expect(issuerModule.mintInvocationMacaroon).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u_alice",
      agentName: "diagram-agent",
      runId: "run_caller_xyz",
      maxCostUsd: 1.5,
      maxSteps: 50,
      ttlSeconds: 300,
    });
  });

  it("calls the reconciler when the workspace slug is in the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "other-slug,ws-slug,another";
    mockVKOk({ vkValue: "sk-bf-CSV" });
    mockMintOk();

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result?.apiKey).toBe("sk-bf-CSV");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the reconciler when slug is absent from the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "only-other-slug,yet-another";

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  // ── Agent gate (BIFROST_ENABLED_AGENTS) ──────────────────────────────
  // Second gate, ANDed with the workspace gate. Default-OPEN: empty
  // means "allow every agent," so the workspace gate alone decides.
  // The CSV form narrows which agentNames go through.

  it("default-open: unset BIFROST_ENABLED_AGENTS allows all agents through", async () => {
    process.env.BIFROST_ENABLED = "true";
    delete process.env.BIFROST_ENABLED_AGENTS;
    mockVKOk();
    mockMintOk();

    const result = await getBifrostForLLM(auth, { agentName: "coding-agent" });
    expect(result).toBeDefined();
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("calls the reconciler when agentName is in the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "true";
    process.env.BIFROST_ENABLED_AGENTS =
      "plan-agent,coding-agent,pr-monitor";
    mockVKOk({ vkValue: "sk-bf-AGENT" });
    mockMintOk();

    const result = await getBifrostForLLM(auth, { agentName: "coding-agent" });
    expect(result?.apiKey).toBe("sk-bf-AGENT");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the reconciler when agentName is absent from the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "true";
    process.env.BIFROST_ENABLED_AGENTS = "plan-agent,coding-agent,pr-monitor";
    // `repo-agent` is a chat surface, not in the workflow-only list.
    const result = await getBifrostForLLM(auth, { agentName: "repo-agent" });
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  it('returns undefined when BIFROST_ENABLED_AGENTS="false" even if workspace gate is open', async () => {
    process.env.BIFROST_ENABLED = "true";
    process.env.BIFROST_ENABLED_AGENTS = "false";

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("workspace gate closed + agent gate open → still undefined (AND semantics)", async () => {
    // Agent gate allows everything, but the workspace gate is closed
    // → the orchestrator must NOT call any reconciler. Pins that the
    // two gates are ANDed, not ORed.
    delete process.env.BIFROST_ENABLED;
    process.env.BIFROST_ENABLED_AGENTS = "true";

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  // ── VK reconcile failure handling ────────────────────────────────────

  it("swallows VK reconcile errors and returns undefined (fallback to default LLM key)", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockRejectedValueOnce(
      new Error("bifrost unreachable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    // VK failure short-circuits before we ever attempt to mint —
    // there's nothing to attach the header to.
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });

  // ── Macaroon mint failure handling ───────────────────────────────────
  // Mint failure is non-fatal: the LLM call still proceeds with the
  // VK shape, just without the x-macaroon header (shadow mode — no
  // dim observability for this one call). Auth correctness in the
  // gateway plugin is preserved because `enforce_macaroons=false`
  // means the absent header just falls through.

  it("returns VK shape with empty headers when the mint throws", async () => {
    process.env.BIFROST_ENABLED = "true";
    mockVKOk();
    vi.mocked(issuerModule.mintInvocationMacaroon).mockRejectedValueOnce(
      new Error("user has no macaroonUserPrivkey (mock)"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toEqual({
      apiKey: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
      headers: {},
      runId: "",
      agentName: "repo-agent",
    });
  });

  it("preserves caller-supplied runId even when mint fails (correlation still works)", async () => {
    process.env.BIFROST_ENABLED = "true";
    mockVKOk();
    vi.mocked(issuerModule.mintInvocationMacaroon).mockRejectedValueOnce(
      new Error("redis lock acquire timeout"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getBifrostForLLM(auth, {
      agentName: "repo-agent",
      runId: "run_external_caller_id",
    });
    expect(result?.runId).toBe("run_external_caller_id");
    expect(result?.headers).toEqual({});
  });

  // ── Phase-5 trust reconcile integration ──────────────────────────────
  // The trust reconcile runs ahead of the VK reconcile and is
  // deliberately non-fatal: any failure is logged inside
  // `ensureBifrostTrust` and surfaced via `status: "failed"`, but
  // the VK reconcile still runs. Macaroon enforcement is off through
  // phase 5, so a trust hiccup doesn't break LLM calls.

  it("runs trust reconcile before VK reconcile before mint", async () => {
    process.env.BIFROST_ENABLED = "true";
    const order: string[] = [];
    vi.mocked(trustModule.ensureBifrostTrust).mockImplementation(
      async () => {
        order.push("trust");
        return {
          workspaceId: "ws-1",
          status: "cached",
          macaroonOrgId: "gh_stakwork",
          macaroonOrgPubkey: "02" + "ab".repeat(32),
        };
      },
    );
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockImplementation(
      async () => {
        order.push("vk");
        return {
          workspaceId: "ws-1",
          userId: "u_alice",
          customerId: "cust-1",
          vkId: "vk-1",
          vkValue: "sk-bf-LIVE",
          baseUrl: "http://bifrost.test:8181/anthropic/v1",
          created: false,
        };
      },
    );
    vi.mocked(issuerModule.mintInvocationMacaroon).mockImplementation(
      async () => {
        order.push("mint");
        return {
          token: "tok",
          orgId: "gh_stakwork",
          userId: auth.userId,
          macaroonUserId: auth.userId,
          agentName: "repo-agent",
          runId: "run_x",
          realm: auth.workspaceSlug,
          expiresAt: "2099-01-01T00:00:00Z",
        };
      },
    );

    await getBifrostForLLM(auth, AGENT);
    expect(order).toEqual(["trust", "vk", "mint"]);
  });

  it("still calls the VK reconciler when trust reconcile returns 'failed'", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(trustModule.ensureBifrostTrust).mockResolvedValueOnce({
      workspaceId: "ws-1",
      status: "failed",
      error: new Error("plugin unreachable"),
    });
    mockVKOk({ vkValue: "sk-bf-DEGRADED" });
    mockMintOk();

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result?.apiKey).toBe("sk-bf-DEGRADED");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("still calls the VK reconciler when trust reconcile itself throws", async () => {
    // Defensive: `ensureBifrostTrust` is supposed to catch its own
    // errors and return `failed`, but if it ever throws unexpectedly
    // (e.g. lock-acquire timeout bubbles up), we want VK reconcile
    // to still run.
    process.env.BIFROST_ENABLED = "true";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(trustModule.ensureBifrostTrust).mockRejectedValueOnce(
      new Error("lock acquire timeout"),
    );
    mockVKOk({ vkValue: "sk-bf-DEGRADED" });
    mockMintOk();

    const result = await getBifrostForLLM(auth, AGENT);
    expect(result?.apiKey).toBe("sk-bf-DEGRADED");
  });

  it("skips trust reconcile entirely when the feature flag is off", async () => {
    // No BIFROST_ENABLED set — the flag gate short-circuits before
    // either reconciler runs.
    const result = await getBifrostForLLM(auth, AGENT);
    expect(result).toBeUndefined();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(issuerModule.mintInvocationMacaroon).not.toHaveBeenCalled();
  });
});

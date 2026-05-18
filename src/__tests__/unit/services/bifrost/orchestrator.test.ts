import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the per-layer reconcilers BEFORE importing the SUT. The
// orchestrator imports them by their concrete module paths
// (`./reconciler`, `./trust-reconciler`), so we mock those — NOT
// the `@/services/bifrost` barrel — to make sure the binding the
// orchestrator actually uses is the stubbed one.
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

// The rollout gate lives in `isBifrostEnabledForWorkspace`, which
// reads `process.env.BIFROST_ENABLED` directly. Manipulate the env
// var per-test rather than mocking the field on `optionalEnvVars`.

const { getBifrostForLLM } = await import(
  "@/services/bifrost/orchestrator"
);
const reconcilerModule = await import("@/services/bifrost/reconciler");
const trustModule = await import("@/services/bifrost/trust-reconciler");

const auth = {
  workspaceId: "ws-1",
  workspaceSlug: "ws-slug",
  userId: "u_alice",
};

const ORIGINAL_BIFROST_ENABLED = process.env.BIFROST_ENABLED;

describe("getBifrostForLLM (master reconciler)", () => {
  beforeEach(() => {
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockReset();
    vi.mocked(trustModule.ensureBifrostTrust).mockReset();
    // Default: trust reconcile succeeds (cache hit). Individual tests
    // override to exercise the failure path.
    vi.mocked(trustModule.ensureBifrostTrust).mockResolvedValue({
      workspaceId: "ws-1",
      status: "cached",
      macaroonOrgId: "gh_stakwork",
      macaroonOrgPubkey: "02" + "ab".repeat(32),
    });
    delete process.env.BIFROST_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_BIFROST_ENABLED === undefined) {
      delete process.env.BIFROST_ENABLED;
    } else {
      process.env.BIFROST_ENABLED = ORIGINAL_BIFROST_ENABLED;
    }
  });

  // ── Rollout gate ─────────────────────────────────────────────────────

  it("returns undefined and never calls any reconciler when the gate is unset", async () => {
    const result = await getBifrostForLLM(auth);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
  });

  it("returns undefined when BIFROST_ENABLED=true but workspaceAuth is missing", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await getBifrostForLLM(undefined);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
  });

  it("returns undefined for the public viewer even when enabled", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await getBifrostForLLM({
      workspaceId: "ws-1",
      workspaceSlug: "ws-slug",
      userId: "__public_viewer__",
    });
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
  });

  it("calls the reconciler when BIFROST_ENABLED=true (all workspaces)", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
      created: false,
    });

    const result = await getBifrostForLLM(auth);
    expect(result).toEqual({
      apiKey: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
    });
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: undefined },
    );
  });

  it("forwards the caller's model to the reconciler", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181/openai/v1",
      created: false,
    });

    const result = await getBifrostForLLM(auth, "gpt-5");
    expect(result?.baseUrl).toBe("http://bifrost.test:8181/openai/v1");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: "gpt-5" },
    );
  });

  it("calls the reconciler when the workspace slug is in the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "other-slug,ws-slug,another";
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-CSV",
      baseUrl: "http://bifrost.test:8181",
      created: false,
    });

    const result = await getBifrostForLLM(auth);
    expect(result?.apiKey).toBe("sk-bf-CSV");
    expect(reconcilerModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the reconciler when slug is absent from the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "only-other-slug,yet-another";

    const result = await getBifrostForLLM(auth);
    expect(result).toBeUndefined();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
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

    const result = await getBifrostForLLM(auth);
    expect(result).toBeUndefined();
  });

  // ── Phase-5 trust reconcile integration ──────────────────────────────
  // The trust reconcile runs ahead of the VK reconcile and is
  // deliberately non-fatal: any failure is logged inside
  // `ensureBifrostTrust` and surfaced via `status: "failed"`, but
  // the VK reconcile still runs. Macaroon enforcement is off through
  // phase 5, so a trust hiccup doesn't break LLM calls.

  it("runs trust reconcile before VK reconcile", async () => {
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

    await getBifrostForLLM(auth);
    expect(order).toEqual(["trust", "vk"]);
  });

  it("still calls the VK reconciler when trust reconcile returns 'failed'", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(trustModule.ensureBifrostTrust).mockResolvedValueOnce({
      workspaceId: "ws-1",
      status: "failed",
      error: new Error("plugin unreachable"),
    });
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-DEGRADED",
      baseUrl: "http://bifrost.test:8181/anthropic/v1",
      created: false,
    });

    const result = await getBifrostForLLM(auth);
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
    vi.mocked(reconcilerModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-DEGRADED",
      baseUrl: "http://bifrost.test:8181/anthropic/v1",
      created: false,
    });

    const result = await getBifrostForLLM(auth);
    expect(result?.apiKey).toBe("sk-bf-DEGRADED");
  });

  it("skips trust reconcile entirely when the feature flag is off", async () => {
    // No BIFROST_ENABLED set — the flag gate short-circuits before
    // either reconciler runs.
    const result = await getBifrostForLLM(auth);
    expect(result).toBeUndefined();
    expect(trustModule.ensureBifrostTrust).not.toHaveBeenCalled();
    expect(reconcilerModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });
});

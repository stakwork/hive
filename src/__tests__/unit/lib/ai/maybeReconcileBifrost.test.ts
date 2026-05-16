import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the reconciler BEFORE importing the SUT so the import binding
// picks up the mock.
vi.mock("@/services/bifrost", () => ({
  reconcileBifrostVK: vi.fn(),
}));

// The rollout gate now lives in `isBifrostEnabledForWorkspace`, which
// reads `process.env.BIFROST_ENABLED` directly. Manipulate the env
// var per-test rather than mocking the field on `optionalEnvVars`.

const { maybeReconcileBifrost } = await import("@/lib/ai/askTools");
const bifrostModule = await import("@/services/bifrost");

const auth = {
  workspaceId: "ws-1",
  workspaceSlug: "ws-slug",
  userId: "u_alice",
};

const ORIGINAL_BIFROST_ENABLED = process.env.BIFROST_ENABLED;

describe("maybeReconcileBifrost feature flag", () => {
  beforeEach(() => {
    vi.mocked(bifrostModule.reconcileBifrostVK).mockReset();
    delete process.env.BIFROST_ENABLED;
  });

  afterEach(() => {
    if (ORIGINAL_BIFROST_ENABLED === undefined) {
      delete process.env.BIFROST_ENABLED;
    } else {
      process.env.BIFROST_ENABLED = ORIGINAL_BIFROST_ENABLED;
    }
  });

  it("returns undefined and never calls the reconciler when the gate is unset", async () => {
    const result = await maybeReconcileBifrost(auth);
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("returns undefined when BIFROST_ENABLED=true but workspaceAuth is missing", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await maybeReconcileBifrost(undefined);
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("returns undefined for the public viewer even when enabled", async () => {
    process.env.BIFROST_ENABLED = "true";
    const result = await maybeReconcileBifrost({
      workspaceId: "ws-1",
      workspaceSlug: "ws-slug",
      userId: "__public_viewer__",
    });
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("calls the reconciler when BIFROST_ENABLED=true (all workspaces)", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(bifrostModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
      created: false,
    });

    const result = await maybeReconcileBifrost(auth);
    expect(result).toEqual({
      apiKey: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181",
    });
    expect(bifrostModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: undefined },
    );
  });

  it("forwards the caller's model to the reconciler", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(bifrostModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-LIVE",
      baseUrl: "http://bifrost.test:8181/openai/v1",
      created: false,
    });

    const result = await maybeReconcileBifrost(auth, "gpt-5");
    expect(result?.baseUrl).toBe("http://bifrost.test:8181/openai/v1");
    expect(bifrostModule.reconcileBifrostVK).toHaveBeenCalledWith(
      "ws-1",
      "u_alice",
      { model: "gpt-5" },
    );
  });

  it("calls the reconciler when the workspace slug is in the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "other-slug,ws-slug,another";
    vi.mocked(bifrostModule.reconcileBifrostVK).mockResolvedValueOnce({
      workspaceId: "ws-1",
      userId: "u_alice",
      customerId: "cust-1",
      vkId: "vk-1",
      vkValue: "sk-bf-CSV",
      baseUrl: "http://bifrost.test:8181",
      created: false,
    });

    const result = await maybeReconcileBifrost(auth);
    expect(result?.apiKey).toBe("sk-bf-CSV");
    expect(bifrostModule.reconcileBifrostVK).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the reconciler when slug is absent from the CSV allow-list", async () => {
    process.env.BIFROST_ENABLED = "only-other-slug,yet-another";

    const result = await maybeReconcileBifrost(auth);
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("swallows reconcile errors and returns undefined (fallback to default LLM key)", async () => {
    process.env.BIFROST_ENABLED = "true";
    vi.mocked(bifrostModule.reconcileBifrostVK).mockRejectedValueOnce(
      new Error("bifrost unreachable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await maybeReconcileBifrost(auth);
    expect(result).toBeUndefined();
  });
});

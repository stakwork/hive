import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the reconciler BEFORE importing the SUT so the import binding
// picks up the mock.
vi.mock("@/services/bifrost", () => ({
  reconcileBifrostVK: vi.fn(),
}));

// The flag lives on `optionalEnvVars.BIFROST_ENABLED`. The base test
// env mock (src/__tests__/support/mocks/env.ts) sets it to `false`.
// We override that per-test below.
const envState = { BIFROST_ENABLED: false };
vi.mock("@/config/env", async () => {
  const actual =
    await vi.importActual<typeof import("@/config/env")>("@/config/env");
  return {
    ...actual,
    optionalEnvVars: new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "BIFROST_ENABLED") return envState.BIFROST_ENABLED;
          // Fall through to a safe default for anything else the
          // module-under-test might read.
          return undefined;
        },
      },
    ),
  };
});

const { maybeReconcileBifrost } = await import("@/lib/ai/askTools");
const bifrostModule = await import("@/services/bifrost");

const auth = {
  workspaceId: "ws-1",
  workspaceSlug: "ws-slug",
  userId: "u_alice",
};

describe("maybeReconcileBifrost feature flag", () => {
  beforeEach(() => {
    vi.mocked(bifrostModule.reconcileBifrostVK).mockReset();
  });

  it("returns undefined and never calls the reconciler when BIFROST_ENABLED is false", async () => {
    envState.BIFROST_ENABLED = false;
    const result = await maybeReconcileBifrost(auth);
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("returns undefined when BIFROST_ENABLED is true but workspaceAuth is missing", async () => {
    envState.BIFROST_ENABLED = true;
    const result = await maybeReconcileBifrost(undefined);
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("returns undefined for the public viewer even when enabled", async () => {
    envState.BIFROST_ENABLED = true;
    const result = await maybeReconcileBifrost({
      workspaceId: "ws-1",
      workspaceSlug: "ws-slug",
      userId: "__public_viewer__",
    });
    expect(result).toBeUndefined();
    expect(bifrostModule.reconcileBifrostVK).not.toHaveBeenCalled();
  });

  it("calls the reconciler and forwards { apiKey, baseUrl } when enabled and auth present", async () => {
    envState.BIFROST_ENABLED = true;
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
    );
  });

  it("swallows reconcile errors and returns undefined (fallback to default LLM key)", async () => {
    envState.BIFROST_ENABLED = true;
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

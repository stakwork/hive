import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  swarmFind: vi.fn(),
  podFind: vi.fn(),
  status: vi.fn(),
  revoke: vi.fn(),
  trust: vi.fn(),
  catalog: vi.fn(),
  vk: vi.fn(),
  mint: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { swarm: { findUnique: m.swarmFind }, pod: { findFirst: m.podFind } },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: { getInstance: () => ({ decryptField: () => "token" }) },
}));
vi.mock("@/services/bifrost/BifrostPluginClient", () => ({
  BifrostPluginClient: class {
    getEnforcementStatus = m.status;
    revokeRun = m.revoke;
  },
}));
vi.mock("@/services/bifrost/trust-reconciler", () => ({ ensureBifrostTrust: m.trust }));
vi.mock("@/services/bifrost/agent-catalog-reconciler", () => ({ ensureBifrostAgentCatalog: m.catalog }));
vi.mock("@/services/bifrost/reconciler", () => ({ reconcileBifrostVK: m.vk }));
vi.mock("@/services/bifrost/macaroon-issuer", () => ({ mintInvocationMacaroon: m.mint }));

import {
  acquirePodGatewayCredential,
  acquirePodRepairGatewayCredential,
  revokePodClaimPermission,
  podClaimRunId,
  PodBudgetError,
  POD_BUDGET_DEFAULT_MAX_COST_USD,
  POD_BUDGET_TTL_SECONDS,
} from "@/services/bifrost/pod-budget";
import { BIFROST_AGENT_NAMES } from "@/services/bifrost/agent-names";
import { DEFAULT_AGENT_SPECS } from "@/services/bifrost/agent-catalog";

const principal = { workspaceId: "ws-1", workspaceSlug: "acme", userId: "user-1" };
const claimedAt = new Date("2026-01-01T00:00:00Z");
const enforcing = { macaroon_enforcement: true, budget_enforcement: true, redis_healthy: true };

describe("pod-budget", () => {
  const original = process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    m.swarmFind.mockResolvedValue({ swarmUrl: "https://swarm.test", swarmApiKey: "enc", workspaceId: "ws-1", workspace: { slug: "acme" } });
    m.podFind.mockResolvedValue({ usageStatusMarkedAt: claimedAt });
    m.status.mockResolvedValue(enforcing);
    m.revoke.mockResolvedValue({ ok: true });
    m.vk.mockResolvedValue({ vkValue: "vk-secret", baseUrl: "https://gw/anthropic/v1" });
    m.mint.mockResolvedValue({ token: "mac-token", runId: "run" });
  });
  afterEach(() => {
    if (original !== undefined) process.env.POD_MOTHERSHIP_BUDGET_ENABLED = original;
    else delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
  });

  it("registers the pod agent names in the names list and catalog", () => {
    for (const n of ["pod-agent", "pod-repair-agent"] as const) {
      expect(BIFROST_AGENT_NAMES).toContain(n);
      expect(DEFAULT_AGENT_SPECS[n]).toBeDefined();
    }
  });

  it("mints pod-agent with $10, 4h ttl, claim-derived run id, charged to the user", async () => {
    const cred = await acquirePodGatewayCredential(principal, "pod-9");
    expect(m.mint).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      agentName: "pod-agent",
      runId: podClaimRunId("pod-9", claimedAt),
      maxCostUsd: POD_BUDGET_DEFAULT_MAX_COST_USD,
      ttlSeconds: POD_BUDGET_TTL_SECONDS,
    });
    expect(POD_BUDGET_DEFAULT_MAX_COST_USD).toBe(10);
    expect(m.vk).toHaveBeenCalledWith("ws-1", "user-1", { model: undefined });
    expect(cred).toMatchObject({ apiKey: "vk-secret", baseUrl: "https://gw/anthropic/v1", headers: { "x-macaroon": "mac-token" } });
  });

  it("repair credential uses pod-repair-agent", async () => {
    await acquirePodRepairGatewayCredential(principal, "run-1");
    expect(m.mint).toHaveBeenCalledWith(expect.objectContaining({ agentName: "pod-repair-agent", maxCostUsd: 10, userId: "user-1" }));
  });

  it.each([
    ["macaroon", { ...enforcing, macaroon_enforcement: false }],
    ["budget", { ...enforcing, budget_enforcement: false }],
    ["redis", { ...enforcing, redis_healthy: false }],
    ["unknown shape", {}],
  ])("refuses (fail closed) when gateway not enforcing: %s", async (_n, status) => {
    m.status.mockResolvedValue(status);
    await expect(acquirePodGatewayCredential(principal, "pod-9")).rejects.toBeInstanceOf(PodBudgetError);
    expect(m.vk).not.toHaveBeenCalled();
    expect(m.mint).not.toHaveBeenCalled();
  });

  it("refuses when the status call errors", async () => {
    m.status.mockRejectedValue(new Error("404"));
    await expect(acquirePodGatewayCredential(principal, "pod-9")).rejects.toThrow(/could not verify gateway enforcement/);
    expect(m.mint).not.toHaveBeenCalled();
  });

  it("refuses when there is no user to charge, no claim, or the mint fails", async () => {
    await expect(acquirePodGatewayCredential({ ...principal, userId: null }, "pod-9")).rejects.toThrow(/no user to charge/);
    m.podFind.mockResolvedValue({ usageStatusMarkedAt: null });
    await expect(acquirePodGatewayCredential(principal, "pod-9")).rejects.toThrow(/no active claim/);
    m.podFind.mockResolvedValue({ usageStatusMarkedAt: claimedAt });
    m.mint.mockRejectedValue(new Error("boom"));
    await expect(acquirePodGatewayCredential(principal, "pod-9")).rejects.toThrow(/could not obtain a gateway credential/);
  });

  it("revokes the claim's run id on release", async () => {
    await revokePodClaimPermission("swarm-1", "pod-9", claimedAt);
    expect(m.revoke).toHaveBeenCalledWith(podClaimRunId("pod-9", claimedAt));
  });

  it("revoke is best-effort: never throws", async () => {
    m.revoke.mockRejectedValue(new Error("no route"));
    await expect(revokePodClaimPermission("swarm-1", "pod-9", claimedAt)).resolves.toBeUndefined();
  });

  it("revoke is a no-op when the flag is off for the workspace", async () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "other";
    await revokePodClaimPermission("swarm-1", "pod-9", claimedAt);
    expect(m.revoke).not.toHaveBeenCalled();
  });
});

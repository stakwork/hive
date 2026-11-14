import { vi, describe, beforeEach, afterEach, test, expect } from "vitest";
import { callStakworkAPI } from "@/services/task-workflow";

const m = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock("@/lib/utils", () => ({ getBaseUrl: vi.fn(() => "https://test.example.com") }));
vi.mock("@/services/bifrost/pod-budget", () => ({ acquirePodGatewayCredential: m.acquire }));

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

const params = (overrides = {}) => ({
  taskId: "t1",
  message: "m",
  userName: "u",
  accessToken: "gh",
  swarmUrl: "https://swarm.test.com",
  swarmSecretAlias: "a",
  poolName: "p",
  repo2GraphUrl: "https://r2g.test.com",
  mode: "live",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  userId: "user-1",
  podId: "pod-9",
  podPassword: "pw",
  ...overrides,
});

const sentVars = () => JSON.parse(mockFetch.mock.calls[0][1]?.body as string).workflow_params.set_var.attributes.vars;

describe("callStakworkAPI pod budget flag", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXA_API_KEY = "exa-direct";
    process.env.ANTHROPIC_API_KEY = "anthropic-direct";
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { project_id: 1 } }) } as any);
    m.acquire.mockResolvedValue({ apiKey: "vk", baseUrl: "https://gw", headers: { "x-macaroon": "mac" }, runId: "r" });
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  test("flag off: direct keys still sent, no gateway call", async () => {
    delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
    await callStakworkAPI(params() as any);
    const vars = sentVars();
    expect(vars.searchApiKey).toBe("exa-direct");
    expect(vars.summaryApiKey).toBe("anthropic-direct");
    expect(m.acquire).not.toHaveBeenCalled();
  });

  test("flag on: gateway credential only, no direct provider/search key", async () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    await callStakworkAPI(params() as any);
    const vars = sentVars();
    expect(m.acquire).toHaveBeenCalledWith({ workspaceId: "ws-1", workspaceSlug: "acme", userId: "user-1" }, "pod-9", expect.anything());
    expect(vars.apiKey).toBe("vk");
    expect(vars.baseUrl).toBe("https://gw");
    expect(vars.headers).toEqual({ "x-macaroon": "mac" });
    expect(vars).not.toHaveProperty("searchApiKey");
    expect(vars).not.toHaveProperty("summaryApiKey");
    expect(JSON.stringify(vars)).not.toContain("anthropic-direct");
    expect(JSON.stringify(vars)).not.toContain("exa-direct");
  });

  test("flag on: no gateway credential fails the dispatch (no fallback)", async () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    m.acquire.mockRejectedValue(new Error("gateway is not enforcing"));
    await expect(callStakworkAPI(params() as any)).rejects.toThrow(/not enforcing/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("flag on but no pod: unchanged path", async () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    await callStakworkAPI(params({ podId: null }) as any);
    expect(m.acquire).not.toHaveBeenCalled();
    expect(sentVars().searchApiKey).toBe("exa-direct");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: vi.fn() },
    stakworkRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    repository: { findMany: vi.fn() },
    swarm: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(),
  poolManagerService: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_POD_REPAIR_WORKFLOW_ID: "9999",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => value),
    })),
  },
}));

vi.mock("@/services/swarm/db", () => ({
  getSwarmContainerConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn(() => "HIVE_STAGING"),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { triggerPodRepair, getEligibleWorkspaces } from "@/services/pod-repair-cron";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";

// ── Helpers ────────────────────────────────────────────────────────────────

const mockedDb = vi.mocked(db);
const mockedStakworkService = vi.mocked(stakworkService);

function makeMockStakworkRequest(projectId = 42) {
  return vi.fn().mockResolvedValue({ success: true, data: { project_id: projectId } });
}

const WORKSPACE_ID = "ws-001";
const WORKSPACE_SLUG = "my-workspace";
const POD_ID = "pod-abc";
const POD_PASSWORD = "s3cr3t";
const FAILED_SERVICES = ["backend", "frontend"];

function setupCommonDbMocks(overrides: Record<string, unknown> = {}) {
  // getRepairHistory
  mockedDb.stakworkRun.findMany.mockResolvedValue([]);
  // getRepairAttemptCount → swarm
  mockedDb.swarm.findUnique.mockResolvedValue(null);
  // getRepairAttemptCount → count
  mockedDb.stakworkRun.count.mockResolvedValue(0);
  // repositories
  mockedDb.repository.findMany.mockResolvedValue([]);
  // run create
  mockedDb.stakworkRun.create.mockResolvedValue({
    id: "run-001",
    ...overrides,
  });
  // run update
  mockedDb.stakworkRun.update.mockResolvedValue({});
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("triggerPodRepair", () => {
  let mockStakworkRequest: ReturnType<typeof makeMockStakworkRequest>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest = makeMockStakworkRequest();
    mockedStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as ReturnType<typeof stakworkService>);
    setupCommonDbMocks();
  });

  it("includes swarmUrl and swarmSecretAlias in the set_var payload when provided", async () => {
    await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      FAILED_SERVICES,
      "some message",
      "project description",
      "https://swarm.example.com",
      "my-secret-alias"
    );

    expect(mockStakworkRequest).toHaveBeenCalledOnce();
    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;

    expect(vars.swarmUrl).toBe("https://swarm.example.com");
    expect(vars.swarmSecretAlias).toBe("my-secret-alias");
  });

  it("sets swarmUrl and swarmSecretAlias to null when not provided", async () => {
    await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      FAILED_SERVICES
    );

    expect(mockStakworkRequest).toHaveBeenCalledOnce();
    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;

    expect(vars.swarmUrl).toBeNull();
    expect(vars.swarmSecretAlias).toBeNull();
  });

  it("sets swarmUrl and swarmSecretAlias to null when explicitly passed null", async () => {
    await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      [],
      undefined,
      undefined,
      null,
      null
    );

    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;

    expect(vars.swarmUrl).toBeNull();
    expect(vars.swarmSecretAlias).toBeNull();
  });

  it("still includes all other required vars in the payload", async () => {
    await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      FAILED_SERVICES,
      "msg",
      "desc",
      "https://swarm.example.com",
      "alias"
    );

    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;

    expect(vars.workspaceId).toBe(WORKSPACE_ID);
    expect(vars.workspaceSlug).toBe(WORKSPACE_SLUG);
    expect(vars.podId).toBe(POD_ID);
    expect(vars.podPassword).toBe(POD_PASSWORD);
    expect(vars.failedServices).toEqual(FAILED_SERVICES);
    expect(vars.tokenReference).toBe("HIVE_STAGING");
  });

  it("creates a StakworkRun record of type POD_REPAIR", async () => {
    await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      []
    );

    expect(mockedDb.stakworkRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: StakworkRunType.POD_REPAIR,
          workspaceId: WORKSPACE_ID,
          status: WorkflowStatus.PENDING,
        }),
      })
    );
  });

  it("returns runId and projectId on success", async () => {
    mockedDb.stakworkRun.create.mockResolvedValue({ id: "run-xyz" });

    const result = await triggerPodRepair(
      WORKSPACE_ID,
      WORKSPACE_SLUG,
      POD_ID,
      POD_PASSWORD,
      [],
      undefined,
      undefined,
      "https://swarm.example.com",
      "alias"
    );

    expect(result.runId).toBe("run-xyz");
    expect(result.projectId).toBe(42);
  });
});

// ── getRepairHistory decoding ──────────────────────────────────────────────

describe("getRepairHistory — containerFiles decoding", () => {
  let mockStakworkRequest: ReturnType<typeof makeMockStakworkRequest>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest = makeMockStakworkRequest();
    mockedStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as ReturnType<typeof stakworkService>);
    setupCommonDbMocks();
  });

  it("decodes base64 containerFiles to plain text", async () => {
    const plainContent = "FROM node:18\nRUN npm install";
    const encoded = Buffer.from(plainContent, "utf-8").toString("base64");

    mockedDb.stakworkRun.findMany.mockResolvedValue([
      {
        id: "run-hist-1",
        status: WorkflowStatus.COMPLETED,
        result: JSON.stringify({ containerFiles: { "Dockerfile": encoded } }),
        feedback: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T01:00:00Z"),
      },
    ] as any);

    await triggerPodRepair(WORKSPACE_ID, WORKSPACE_SLUG, POD_ID, POD_PASSWORD, FAILED_SERVICES);

    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;
    const history = vars.history as Array<{ result: { containerFiles: Record<string, string> } }>;

    expect(history[0].result.containerFiles["Dockerfile"]).toBe(plainContent);
  });

  it("handles null result safely without throwing", async () => {
    mockedDb.stakworkRun.findMany.mockResolvedValue([
      {
        id: "run-hist-2",
        status: WorkflowStatus.FAILED,
        result: null,
        feedback: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T01:00:00Z"),
      },
    ] as any);

    await expect(
      triggerPodRepair(WORKSPACE_ID, WORKSPACE_SLUG, POD_ID, POD_PASSWORD, FAILED_SERVICES)
    ).resolves.not.toThrow();

    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;
    const history = vars.history as Array<{ result: unknown }>;

    expect(history[0].result).toBeNull();
  });

  it("returns result unchanged when containerFiles key is absent", async () => {
    const resultWithoutFiles = { summary: "did stuff" };

    mockedDb.stakworkRun.findMany.mockResolvedValue([
      {
        id: "run-hist-3",
        status: WorkflowStatus.COMPLETED,
        result: JSON.stringify(resultWithoutFiles),
        feedback: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T01:00:00Z"),
      },
    ] as any);

    await triggerPodRepair(WORKSPACE_ID, WORKSPACE_SLUG, POD_ID, POD_PASSWORD, FAILED_SERVICES);

    const [, payload] = mockStakworkRequest.mock.calls[0] as [string, Record<string, unknown>];
    const vars = (payload as any).workflow_params.set_var.attributes.vars;
    const history = vars.history as Array<{ result: unknown }>;

    expect(history[0].result).toEqual(resultWithoutFiles);
  });
});

// ── getEligibleWorkspaces ──────────────────────────────────────────────────

describe("getEligibleWorkspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.workspace.findMany.mockResolvedValue([]);
  });

  it("selects swarmUrl and swarmSecretAlias from the swarm relation", async () => {
    await getEligibleWorkspaces();

    expect(mockedDb.workspace.findMany).toHaveBeenCalledOnce();
    const [callArgs] = mockedDb.workspace.findMany.mock.calls[0] as [Record<string, unknown>];
    const swarmSelect = (callArgs as any).select.swarm.select;

    expect(swarmSelect).toHaveProperty("swarmUrl", true);
    expect(swarmSelect).toHaveProperty("swarmSecretAlias", true);
  });

  it("also selects the other required swarm fields", async () => {
    await getEligibleWorkspaces();

    const [callArgs] = mockedDb.workspace.findMany.mock.calls[0] as [Record<string, unknown>];
    const swarmSelect = (callArgs as any).select.swarm.select;

    expect(swarmSelect).toHaveProperty("id", true);
    expect(swarmSelect).toHaveProperty("poolApiKey", true);
    expect(swarmSelect).toHaveProperty("poolState", true);
    expect(swarmSelect).toHaveProperty("podState", true);
    expect(swarmSelect).toHaveProperty("pendingRepairTrigger", true);
    expect(swarmSelect).toHaveProperty("description", true);
  });

  it("passes repairAgentDisabled: false in the swarm where-clause", async () => {
    await getEligibleWorkspaces();

    const [callArgs] = mockedDb.workspace.findMany.mock.calls[0] as [Record<string, unknown>];
    expect((callArgs as any).where.swarm).toHaveProperty("repairAgentDisabled", false);
  });
});

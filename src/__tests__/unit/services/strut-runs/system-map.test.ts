/**
 * Unit tests for `services/strut-runs/system-map.ts`.
 *
 * Coverage:
 *   - launch: dispatches `swarm-systemmap` (default key, no `workspace` input)
 *     or a CWE workflow with purpose `system_map`, the workspace swarm's
 *     stakgraph base as `input.swarm_url` and its secret alias as
 *     `input.swarm_secret_alias`; no swarm / alias → no_target.
 *   - list: rows serialized newest-first with a strut view link; a PENDING
 *     row past the probe age whose run is over on strut is settled through
 *     `completeStrutRun` and re-read; a fresh PENDING row is not probed;
 *     a probe failure leaves the row as is.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun, mockWorkspace, mockDispatch, mockProbe, mockComplete, FakeDispatchError } = vi.hoisted(() => {
  class FakeDispatchError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    mockStrutRun: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    mockWorkspace: { findUnique: vi.fn() },
    mockDispatch: vi.fn(),
    mockProbe: vi.fn(),
    mockComplete: vi.fn(),
    FakeDispatchError,
  };
});

vi.mock("@/lib/db", () => ({
  db: { strutRun: mockStrutRun, workspace: mockWorkspace },
}));
vi.mock("@/services/strut-runs", () => ({
  dispatchStrutRun: mockDispatch,
  probeStrutRun: mockProbe,
  completeStrutRun: mockComplete,
  StrutDispatchError: FakeDispatchError,
  STRUT_RUN_LOG_TAG: "STRUT_RUN",
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { launchSystemMapRun, listSystemMapRuns, parseComponents, parseCweIds } from "@/services/strut-runs/system-map";

const NOW = new Date("2026-09-25T12:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "system_map",
    workflow: "swarm-systemmap-schema-sync",
    strutRunId: "1700000000000",
    status: StrutRunStatus.PENDING,
    input: null,
    output: null,
    error: null,
    durationMs: null,
    conversationId: null,
    proposalId: null,
    createdAt: new Date(NOW.getTime() - 60_000),
    settledAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspace.findUnique.mockResolvedValue({ sourceControlOrg: { githubLogin: "acme" } });
});

describe("launchSystemMapRun", () => {
  it("dispatches swarm-systemmap with the workspace swarm's base URL and secret alias as input, no workspace", async () => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: "{{SWARM_123_API_KEY}}" },
    });
    mockDispatch.mockResolvedValue({ runId: "run-1", strutRunId: "1", swarmId: "swarm-1" });

    const out = await launchSystemMapRun({
      workspaceId: "ws-1",
      workspaceSlug: "acme-ws",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
    });

    expect(out.runId).toBe("run-1");
    expect(mockWorkspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws-1" } }),
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "system_map",
      workflow: "swarm-systemmap",
      purpose: "system_map",
      input: {
        swarm_url: "https://acme.sphinx.chat:3355",
        swarm_secret_alias: "{{SWARM_123_API_KEY}}",
      },
      publicBaseUrl: "https://hive.example",
    });
  });

  it("dispatches the CWE check workflow under its own kind, with the same input", async () => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: "{{SWARM_123_API_KEY}}" },
    });
    mockDispatch.mockResolvedValue({ runId: "run-3", strutRunId: "3", swarmId: "swarm-1" });

    await launchSystemMapRun({
      workspaceId: "ws-1",
      workspaceSlug: "acme-ws",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      key: "cwe_check",
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "system_map_cwe_check",
        workflow: "swarm-systemmap-cwe-check-templates",
        purpose: "system_map",
        input: {
          workspace: "acme-ws",
          swarm_url: "https://acme.sphinx.chat:3355",
          swarm_secret_alias: "{{SWARM_123_API_KEY}}",
        },
      }),
    );
  });

  it.each([
    ["cwe_check", ["CWE-79", "CWE-89"], { cwe_ids: ["CWE-79", "CWE-89"] }],
  ] as const)("scopes %s to the CWEs as cwe_ids", async (key, cweIds, expected) => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: "{{SWARM_123_API_KEY}}" },
    });
    mockDispatch.mockResolvedValue({ runId: "run-5", strutRunId: "5", swarmId: "swarm-1" });

    await launchSystemMapRun({
      workspaceId: "ws-1",
      workspaceSlug: "acme-ws",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      key,
      cweIds: [...cweIds],
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspace: "acme-ws",
          swarm_url: "https://acme.sphinx.chat:3355",
          swarm_secret_alias: "{{SWARM_123_API_KEY}}",
          ...expected,
        },
      }),
    );
  });

  it("scopes the CWE check to components", async () => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: "{{SWARM_123_API_KEY}}" },
    });
    mockDispatch.mockResolvedValue({ runId: "run-7", strutRunId: "7", swarmId: "swarm-1" });

    await launchSystemMapRun({
      workspaceId: "ws-1",
      workspaceSlug: "acme-ws",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      key: "cwe_check",
      cweIds: ["CWE-306"],
      components: ["stakwork/hive"],
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspace: "acme-ws",
          swarm_url: "https://acme.sphinx.chat:3355",
          swarm_secret_alias: "{{SWARM_123_API_KEY}}",
          cwe_ids: ["CWE-306"],
          components: ["stakwork/hive"],
        },
      }),
    );
  });

  it("returns the run's strut view link when the workspace has an org", async () => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: "{{SWARM_123_API_KEY}}" },
      sourceControlOrg: { githubLogin: "acme" },
    });
    mockDispatch.mockResolvedValue({ runId: "run-6", strutRunId: "1700000000000", swarmId: "swarm-1" });

    const out = await launchSystemMapRun({
      workspaceId: "ws-1",
      workspaceSlug: "acme-ws",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      key: "cwe_check",
      cweIds: ["CWE-79"],
    });

    expect(out.strutUrl).toBe("/org/acme/strut?strut=wf%3Dswarm-systemmap-cwe-check-templates%26run%3D1700000000000");
  });

  it("refuses with no_target when the workspace swarm has no secret alias", async () => {
    mockWorkspace.findUnique.mockResolvedValue({
      swarm: { swarmUrl: "https://acme.sphinx.chat/api", swarmSecretAlias: null },
    });

    await expect(
      launchSystemMapRun({ workspaceId: "ws-1", workspaceSlug: "acme-ws", userId: "user-1", publicBaseUrl: "https://h" }),
    ).rejects.toMatchObject({ code: "no_target" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("parseComponents", () => {
  it("passes absent through and trims / dedupes names", () => {
    expect(parseComponents("cwe_check", undefined)).toBeUndefined();
    expect(parseComponents("cwe_check", ["stakwork/hive", " stakwork/hive ", "jarvis"])).toEqual([
      "stakwork/hive",
      "jarvis",
    ]);
  });

  it("rejects bad shapes, empty names, too many, and workflows without CWE scope", () => {
    expect(parseComponents("cwe_check", "stakwork/hive")).toHaveProperty("error");
    expect(parseComponents("cwe_check", [1])).toHaveProperty("error");
    expect(parseComponents("cwe_check", ["  "])).toHaveProperty("error");
    expect(parseComponents("cwe_check", [])).toHaveProperty("error");
    expect(parseComponents("cwe_check", Array.from({ length: 51 }, (_, i) => `c${i}`))).toHaveProperty("error");
    expect(parseComponents("system_map", ["stakwork/hive"])).toEqual({ error: "This workflow does not take components" });
  });
});

describe("parseCweIds", () => {
  it("is undefined when absent and dedupes valid ids", () => {
    expect(parseCweIds("cwe_check", undefined)).toBeUndefined();
    expect(parseCweIds("cwe_check", ["CWE-79", "CWE-79", "CWE-89"])).toEqual(["CWE-79", "CWE-89"]);
  });

  it("rejects malformed ids, empty lists and workflows without CWE scope", () => {
    expect(parseCweIds("cwe_check", ["79"])).toHaveProperty("error");
    expect(parseCweIds("cwe_check", "CWE-79")).toHaveProperty("error");
    expect(parseCweIds("cwe_check", [])).toHaveProperty("error");
    expect(parseCweIds("cwe_check", Array.from({ length: 51 }, (_, i) => `CWE-${i + 1}`))).toHaveProperty("error");
    expect(parseCweIds("system_map", ["CWE-79"])).toEqual({ error: "This workflow does not take cweIds" });
  });
});

describe("listSystemMapRuns", () => {
  it("serializes settled rows with a strut view link and does not probe them", async () => {
    mockStrutRun.findMany.mockResolvedValue([
      row({ status: StrutRunStatus.SUCCESS, output: { summary: "ok" }, durationMs: 1234, settledAt: NOW }),
    ]);

    const runs = await listSystemMapRuns("ws-1", "system_map", { now: NOW });

    expect(mockProbe).not.toHaveBeenCalled();
    expect(runs).toEqual([
      {
        id: "run-1",
        workflow: "swarm-systemmap-schema-sync",
        strutRunId: "1700000000000",
        status: "SUCCESS",
        output: { summary: "ok" },
        error: null,
        durationMs: 1234,
        createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
        settledAt: NOW.toISOString(),
        strutUrl: "/org/acme/strut?strut=wf%3Dswarm-systemmap-schema-sync%26run%3D1700000000000",
        cweIds: null,
        components: null,
      },
    ]);
    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-1", kind: "system_map" }, orderBy: { createdAt: "desc" } }),
    );
  });

  it("reads the CWEs a run was scoped to from its input", async () => {
    mockStrutRun.findMany.mockResolvedValue([
      row({
        id: "a",
        status: StrutRunStatus.SUCCESS,
        settledAt: NOW,
        input: { cwe_ids: ["CWE-79", "CWE-89"], components: ["stakwork/hive"] },
      }),
      row({ id: "c", status: StrutRunStatus.SUCCESS, settledAt: NOW, input: { workspace: "acme-ws" } }),
    ]);

    const runs = await listSystemMapRuns("ws-1", "cwe_check", { now: NOW });

    expect(runs.map((r) => r.cweIds)).toEqual([["CWE-79", "CWE-89"], null]);
    expect(runs.map((r) => r.components)).toEqual([["stakwork/hive"], null]);
  });

  it("lists the CWE check workflow's runs under its own kind", async () => {
    mockStrutRun.findMany.mockResolvedValue([]);
    await listSystemMapRuns("ws-1", "cwe_check", { now: NOW });
    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws-1", kind: "system_map_cwe_check" } }),
    );
  });

  it("settles a pending row from strut's summary when the run is over there", async () => {
    const pending = row();
    const settled = row({ status: StrutRunStatus.SUCCESS, output: "# Map", durationMs: 5000, settledAt: NOW });
    mockStrutRun.findMany.mockResolvedValue([pending]);
    mockProbe.mockResolvedValue({ kind: "settled", completion: { status: "success", output: "# Map", durationMs: 5000 } });
    mockStrutRun.findUnique
      .mockResolvedValueOnce({ id: "run-1", tokenHash: "hash" })
      .mockResolvedValueOnce(settled);
    mockComplete.mockResolvedValue("claimed");

    const runs = await listSystemMapRuns("ws-1", "system_map", { now: NOW });

    expect(mockProbe).toHaveBeenCalledWith(pending);
    expect(mockComplete).toHaveBeenCalledWith(
      { id: "run-1", tokenHash: "hash" },
      { status: "success", output: "# Map", durationMs: 5000 },
    );
    expect(runs[0].status).toBe("SUCCESS");
    expect(runs[0].output).toBe("# Map");
  });

  it("leaves a fresh pending row alone and a still-running one pending", async () => {
    const fresh = row({ id: "fresh", createdAt: new Date(NOW.getTime() - 2_000) });
    const running = row({ id: "running" });
    mockStrutRun.findMany.mockResolvedValue([fresh, running]);
    mockProbe.mockResolvedValue({ kind: "running", status: "running" });

    const runs = await listSystemMapRuns("ws-1", "system_map", { now: NOW });

    expect(mockProbe).toHaveBeenCalledTimes(1);
    expect(mockProbe).toHaveBeenCalledWith(running);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(runs.map((r) => r.status)).toEqual(["PENDING", "PENDING"]);
  });

  it("shows the row as pending when the probe throws", async () => {
    mockStrutRun.findMany.mockResolvedValue([row()]);
    mockProbe.mockRejectedValue(new Error("boom"));

    const runs = await listSystemMapRuns("ws-1", "system_map", { now: NOW });

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PENDING");
    expect(runs[0].strutUrl).toBe("/org/acme/strut?strut=wf%3Dswarm-systemmap-schema-sync%26run%3D1700000000000");
  });

  it("omits the strut link when the workspace has no org", async () => {
    mockWorkspace.findUnique.mockResolvedValue({ sourceControlOrg: null });
    mockStrutRun.findMany.mockResolvedValue([row({ status: StrutRunStatus.ERROR, error: "nope", settledAt: NOW })]);

    const runs = await listSystemMapRuns("ws-1", "system_map", { now: NOW });

    expect(runs[0].strutUrl).toBeNull();
    expect(runs[0].error).toBe("nope");
  });
});

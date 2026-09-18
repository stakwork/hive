import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    protectReviewRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    repository: { findMany: vi.fn() },
    janitorConfig: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return {
    ...actual,
    getDefaultModel: vi.fn(),
    getApiKeyForModel: vi.fn(),
  };
});

vi.mock("@/lib/ai/resolve-model", () => ({
  resolveModelAgainstCatalog: vi.fn(),
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(),
}));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-key",
    STAKWORK_PROTECT_WORKFLOW_ID: "555",
  },
  optionalEnvVars: {
    STAKWORK_PROTECT_WORKFLOW_ID: "555",
  },
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: vi.fn(),
}));

vi.mock("@/lib/protect/findings", () => ({
  listProtectFindings: vi.fn(),
  serializeFindingForWorkflow: vi.fn((finding) => finding),
  applyProtectReviewFindings: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: () => "{{HIVE_STAGING}}",
}));

import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { listProtectFindings, applyProtectReviewFindings } from "@/lib/protect/findings";
import { getApiKeyForModel, getDefaultModel } from "@/lib/ai/models";
import { resolveModelAgainstCatalog } from "@/lib/ai/resolve-model";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import {
  dispatchFullProtectReview,
  dispatchIncrementalProtectReview,
  completeProtectReview,
  PROTECT_ERRORS,
} from "@/services/protect";

function getDispatchedVars(): Record<string, unknown> {
  return (
    mockStakworkRequest.mock.calls[0][1] as {
      workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } };
    }
  ).workflow_params.set_var.attributes.vars;
}

const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 99 } });

describe("dispatchFullProtectReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({ data: { project_id: 99 } });
    vi.mocked(db.repository.findMany).mockResolvedValue([
      { repositoryUrl: "https://github.com/acme/hive" },
    ] as never);
    vi.mocked(db.protectReviewRun.findFirst).mockResolvedValue(null);
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({
      jarvisUrl: "https://jarvis.test",
      apiKey: "key",
    });
    vi.mocked(listProtectFindings).mockResolvedValue({ ok: true, findings: [] });
    vi.mocked(db.protectReviewRun.create).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      mode: "full",
      status: "pending",
      repositoryUrl: null,
    } as never);
    vi.mocked(db.protectReviewRun.update).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      mode: "full",
      status: "running",
      repositoryUrl: null,
      stakworkProjectId: 99,
    } as never);
    vi.mocked(stakworkService).mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as never);
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: null,
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({ value: null, healed: false });
    vi.mocked(getDefaultModel).mockResolvedValue("anthropic/claude-sonnet-4");
    vi.mocked(getApiKeyForModel).mockReturnValue("direct-key");
    vi.mocked(getBifrostForLLM).mockResolvedValue(undefined);
  });

  it("creates a full run and dispatches tokenReference-only vars", async () => {
    const run = await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(run.status).toBe("running");
    expect(mockStakworkRequest).toHaveBeenCalledWith(
      "/projects",
      expect.objectContaining({
        workflow_id: 555,
        workflow_params: expect.objectContaining({
          set_var: expect.objectContaining({
            attributes: expect.objectContaining({
              vars: expect.objectContaining({
                runId: "run-1",
                mode: "full",
                tokenReference: "{{HIVE_STAGING}}",
                repositoryUrls: ["https://github.com/acme/hive"],
              }),
            }),
          }),
        }),
      }),
    );
    const vars = (mockStakworkRequest.mock.calls[0][1] as { workflow_params: { set_var: { attributes: { vars: Record<string, unknown> } } } })
      .workflow_params.set_var.attributes.vars;
    expect(vars).not.toHaveProperty("pat");
    expect(vars).not.toHaveProperty("swarmApiKey");
  });

  it("rejects a second dispatch while a run is in-flight", async () => {
    vi.mocked(db.protectReviewRun.findFirst).mockResolvedValue({ id: "run-open" } as never);
    await expect(
      dispatchFullProtectReview({ workspaceId: "ws-1", workspaceSlug: "acme", userId: "admin-1" }),
    ).rejects.toThrow(PROTECT_ERRORS.RUN_IN_PROGRESS);
  });

  it("never accepts caller-supplied repository URLs — only workspace.repositories", async () => {
    vi.mocked(db.repository.findMany).mockResolvedValue([
      { repositoryUrl: "https://github.com/acme/owned" },
    ] as never);
    await dispatchFullProtectReview({ workspaceId: "ws-1", workspaceSlug: "acme", userId: "admin-1" });
    const vars = (
      mockStakworkRequest.mock.calls[0][1] as {
        workflow_params: { set_var: { attributes: { vars: { repositoryUrls: string[] } } } };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars.repositoryUrls).toEqual(["https://github.com/acme/owned"]);
  });

  it("sends the stored model as vars.model on full dispatch", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: "openai/gpt-4o",
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "openai/gpt-4o",
      healed: false,
    });

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getDispatchedVars().model).toBe("openai/gpt-4o");
    expect(resolveModelAgainstCatalog).toHaveBeenCalledWith("openai/gpt-4o");
  });

  it("falls back to the task default when nothing is stored", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: null,
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({ value: null, healed: false });
    vi.mocked(getDefaultModel).mockResolvedValue("anthropic/claude-sonnet-4");

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getDefaultModel).toHaveBeenCalledWith("task");
    expect(getDispatchedVars().model).toBe("anthropic/claude-sonnet-4");
  });

  it("heals a stale provider prefix via resolveModelAgainstCatalog", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: "other/grok-4",
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "xai/grok-4",
      healed: true,
    });

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getDispatchedVars().model).toBe("xai/grok-4");
  });

  it("falls back to the task default when the catalog no longer has the stored model", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: "anthropic/retired-model",
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({ value: null, healed: false });
    vi.mocked(getDefaultModel).mockResolvedValue("anthropic/claude-sonnet-4");

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getDispatchedVars().model).toBe("anthropic/claude-sonnet-4");
  });

  it("omits vars.model and logs model=unset when the task default is also null", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: null,
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({ value: null, healed: false });
    vi.mocked(getDefaultModel).mockResolvedValue(null);

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getDispatchedVars()).not.toHaveProperty("model");
    expect(logSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("model=unset");
    logSpy.mockRestore();
  });

  it("overlays Bifrost credentials for non-xai models", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: "anthropic/claude-sonnet-4",
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "anthropic/claude-sonnet-4",
      healed: false,
    });
    vi.mocked(getApiKeyForModel).mockReturnValue("direct-key");
    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-key",
      baseUrl: "https://gateway.test/anthropic/v1",
      headers: { "x-macaroon": "secret-macaroon" },
      runId: "run",
      agentName: "security-review-agent",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getBifrostForLLM).toHaveBeenCalledWith(
      { workspaceId: "ws-1", workspaceSlug: "acme", userId: "admin-1" },
      {
        agentName: "security-review-agent",
        model: "anthropic/claude-sonnet-4",
        ttlSeconds: 86400,
      },
    );
    expect(getDispatchedVars()).toMatchObject({
      model: "anthropic/claude-sonnet-4",
      apiKey: "vk-key",
      baseUrl: "https://gateway.test/anthropic/v1",
      headers: { "x-macaroon": "secret-macaroon" },
    });
    const logged = logSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(logged).not.toContain("vk-key");
    expect(logged).not.toContain("secret-macaroon");
    expect(logged).not.toContain("direct-key");
    logSpy.mockRestore();
  });

  it("skips Bifrost for xai/ models and keeps the direct apiKey", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewModel: "xai/grok-4",
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "xai/grok-4",
      healed: false,
    });
    vi.mocked(getApiKeyForModel).mockReturnValue("xai-direct");
    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "should-not-use",
      baseUrl: "https://gateway.test",
      headers: {},
      runId: "run",
      agentName: "security-review-agent",
    });

    await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "admin-1",
    });

    expect(getBifrostForLLM).not.toHaveBeenCalled();
    expect(getDispatchedVars()).toMatchObject({
      model: "xai/grok-4",
      apiKey: "xai-direct",
    });
    expect(getDispatchedVars()).not.toHaveProperty("baseUrl");
  });
});

describe("dispatchIncrementalProtectReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStakworkRequest.mockResolvedValue({ data: { project_id: 99 } });
    vi.mocked(stakworkService).mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as never);
    vi.mocked(db.repository.findMany).mockResolvedValue([
      { repositoryUrl: "https://github.com/acme/hive" },
    ] as never);
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({
      jarvisUrl: "https://jarvis.test",
      apiKey: "key",
    });
    vi.mocked(listProtectFindings).mockResolvedValue({ ok: true, findings: [] });
    vi.mocked(db.protectReviewRun.create).mockResolvedValue({
      id: "inc-1",
      workspaceId: "ws-1",
      mode: "incremental",
      status: "pending",
      repositoryUrl: "https://github.com/acme/hive",
    } as never);
    vi.mocked(db.protectReviewRun.update).mockResolvedValue({
      id: "inc-1",
      workspaceId: "ws-1",
      mode: "incremental",
      status: "running",
      repositoryUrl: "https://github.com/acme/hive",
      stakworkProjectId: 99,
    } as never);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({ value: null, healed: false });
    vi.mocked(getDefaultModel).mockResolvedValue("anthropic/claude-sonnet-4");
    vi.mocked(getApiKeyForModel).mockReturnValue("direct-key");
    vi.mocked(getBifrostForLLM).mockResolvedValue(undefined);
  });

  it("no-ops when security review is disabled", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: false,
    } as never);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "aaa",
      after: "bbb",
      ref: "refs/heads/main",
    });

    expect(result).toEqual({ dispatched: false, reason: "security_review_disabled" });
    expect(db.protectReviewRun.create).not.toHaveBeenCalled();
    expect(mockStakworkRequest).not.toHaveBeenCalled();
  });

  it("no-ops before the first completed full review", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: true,
    } as never);
    vi.mocked(db.protectReviewRun.findFirst).mockResolvedValue(null);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      repositoryUrl: "https://github.com/acme/hive",
      before: "aaa",
      after: "bbb",
      ref: "refs/heads/main",
    });

    expect(result).toEqual({ dispatched: false, reason: "no_completed_full_review" });
    expect(db.protectReviewRun.create).not.toHaveBeenCalled();
    expect(mockStakworkRequest).not.toHaveBeenCalled();
  });

  it("no-ops when the repository is not in workspace.repositories", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: true,
    } as never);
    vi.mocked(db.protectReviewRun.findFirst).mockResolvedValue({
      id: "full-1",
      mode: "full",
      status: "completed",
    } as never);
    vi.mocked(db.repository.findMany).mockResolvedValue([
      { repositoryUrl: "https://github.com/acme/other" },
    ] as never);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "aaa",
      after: "bbb",
      ref: "refs/heads/main",
    });

    expect(result).toEqual({ dispatched: false, reason: "repository_not_in_workspace" });
    expect(db.protectReviewRun.create).not.toHaveBeenCalled();
  });

  it("dispatches after a completed full review with before/after/ref", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: true,
    } as never);
    vi.mocked(db.protectReviewRun.findFirst)
      .mockResolvedValueOnce({ id: "full-1", mode: "full", status: "completed" } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      repositoryUrl: "https://github.com/acme/hive",
      before: "sha-before",
      after: "sha-after",
      ref: "refs/heads/main",
    });

    expect(result.dispatched).toBe(true);
    const vars = (
      mockStakworkRequest.mock.calls[0][1] as {
        workflow_params: {
          set_var: { attributes: { vars: Record<string, unknown> } };
        };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars).toMatchObject({
      runId: "inc-1",
      mode: "incremental",
      tokenReference: "{{HIVE_STAGING}}",
      repositoryUrl: "https://github.com/acme/hive",
      before: "sha-before",
      after: "sha-after",
      ref: "refs/heads/main",
    });
    expect(vars).not.toHaveProperty("pat");
    expect(vars).not.toHaveProperty("swarmApiKey");
    expect(vars.model).toBe("anthropic/claude-sonnet-4");
  });

  it("passes workspace owner userId into Bifrost on incremental dispatch", async () => {
    vi.mocked(db.janitorConfig.findUnique)
      .mockResolvedValueOnce({ securityReviewEnabled: true } as never)
      .mockResolvedValueOnce({ securityReviewModel: "openai/gpt-4o" } as never);
    vi.mocked(db.protectReviewRun.findFirst)
      .mockResolvedValueOnce({ id: "full-1", mode: "full", status: "completed" } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "openai/gpt-4o",
      healed: false,
    });
    vi.mocked(getBifrostForLLM).mockResolvedValue({
      apiKey: "vk-inc",
      baseUrl: "https://gateway.test/openai/v1",
      headers: { "x-macaroon": "inc-mac" },
      runId: "run",
      agentName: "security-review-agent",
    });

    await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      userId: "owner-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "sha-before",
      after: "sha-after",
      ref: "refs/heads/main",
    });

    expect(getBifrostForLLM).toHaveBeenCalledWith(
      { workspaceId: "ws-1", workspaceSlug: "acme", userId: "owner-1" },
      {
        agentName: "security-review-agent",
        model: "openai/gpt-4o",
        ttlSeconds: 86400,
      },
    );
    expect(getDispatchedVars()).toMatchObject({
      model: "openai/gpt-4o",
      apiKey: "vk-inc",
      baseUrl: "https://gateway.test/openai/v1",
    });
  });

  it("skips Bifrost on incremental dispatch when ownerId or slug is missing", async () => {
    vi.mocked(db.janitorConfig.findUnique)
      .mockResolvedValueOnce({ securityReviewEnabled: true } as never)
      .mockResolvedValueOnce({ securityReviewModel: "openai/gpt-4o" } as never);
    vi.mocked(db.protectReviewRun.findFirst)
      .mockResolvedValueOnce({ id: "full-1", mode: "full", status: "completed" } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(resolveModelAgainstCatalog).mockResolvedValue({
      value: "openai/gpt-4o",
      healed: false,
    });
    vi.mocked(getApiKeyForModel).mockReturnValue("direct-key");

    await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "sha-before",
      after: "sha-after",
      ref: "refs/heads/main",
    });

    expect(getBifrostForLLM).not.toHaveBeenCalled();
    expect(getDispatchedVars()).toMatchObject({
      model: "openai/gpt-4o",
      apiKey: "direct-key",
    });
  });

  it("skips when an incremental run for the repo is already in-flight", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: true,
    } as never);
    vi.mocked(db.protectReviewRun.findFirst)
      .mockResolvedValueOnce({ id: "full-1", mode: "full", status: "completed" } as never)
      .mockResolvedValueOnce({ id: "inc-open" } as never);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "aaa",
      after: "bbb",
      ref: "refs/heads/main",
    });

    expect(result).toEqual({ dispatched: false, reason: "in_flight" });
    expect(db.protectReviewRun.create).not.toHaveBeenCalled();
  });

  it("skips when a recent incremental run for the repo exists (debounce)", async () => {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue({
      securityReviewEnabled: true,
    } as never);
    vi.mocked(db.protectReviewRun.findFirst)
      .mockResolvedValueOnce({ id: "full-1", mode: "full", status: "completed" } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "inc-recent" } as never);

    const result = await dispatchIncrementalProtectReview({
      workspaceId: "ws-1",
      repositoryUrl: "https://github.com/acme/hive",
      before: "aaa",
      after: "bbb",
      ref: "refs/heads/main",
    });

    expect(result).toEqual({ dispatched: false, reason: "debounced" });
    expect(db.protectReviewRun.create).not.toHaveBeenCalled();
  });
});

describe("completeProtectReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies findings and marks the run completed", async () => {
    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      mode: "full",
      status: "running",
      repositoryUrl: null,
    } as never);
    vi.mocked(getJarvisConfigForWorkspace).mockResolvedValue({
      jarvisUrl: "https://jarvis.test",
      apiKey: "key",
    });
    vi.mocked(applyProtectReviewFindings).mockResolvedValue({
      counts: { created: 1, updated: 0, skipped: 0, stale: 0 },
      errors: [],
    });
    vi.mocked(db.protectReviewRun.update).mockResolvedValue({
      id: "run-1",
      status: "completed",
    } as never);

    const result = await completeProtectReview({
      runId: "run-1",
      status: "completed",
      findings: [],
    });

    expect(result.counts.created).toBe(1);
    expect(db.protectReviewRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { status: "completed", completedAt: expect.any(Date) },
    });
  });
});

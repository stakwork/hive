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
import {
  dispatchFullProtectReview,
  dispatchIncrementalProtectReview,
  completeProtectReview,
  PROTECT_ERRORS,
} from "@/services/protect";

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
  });

  it("creates a full run and dispatches tokenReference-only vars", async () => {
    const run = await dispatchFullProtectReview({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
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
      dispatchFullProtectReview({ workspaceId: "ws-1", workspaceSlug: "acme" }),
    ).rejects.toThrow(PROTECT_ERRORS.RUN_IN_PROGRESS);
  });

  it("never accepts caller-supplied repository URLs — only workspace.repositories", async () => {
    vi.mocked(db.repository.findMany).mockResolvedValue([
      { repositoryUrl: "https://github.com/acme/owned" },
    ] as never);
    await dispatchFullProtectReview({ workspaceId: "ws-1", workspaceSlug: "acme" });
    const vars = (
      mockStakworkRequest.mock.calls[0][1] as {
        workflow_params: { set_var: { attributes: { vars: { repositoryUrls: string[] } } } };
      }
    ).workflow_params.set_var.attributes.vars;
    expect(vars.repositoryUrls).toEqual(["https://github.com/acme/owned"]);
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

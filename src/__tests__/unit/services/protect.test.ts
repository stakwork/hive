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
import { dispatchFullProtectReview, completeProtectReview, PROTECT_ERRORS } from "@/services/protect";

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

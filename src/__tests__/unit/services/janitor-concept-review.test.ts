// @vitest-environment node
/**
 * Unit tests for CONCEPT_REVIEW janitor functionality:
 * - createConceptReviewJanitorRun (via createJanitorRun)
 * - processJanitorWebhook CONCEPT_REVIEW branch
 * - conceptProposalSchema validation (webhook route)
 * - Webhook route timingSafeEqual auth
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { createJanitorRun, processJanitorWebhook } from "@/services/janitor";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { stakworkService } from "@/lib/service-factory";
import { EncryptionService } from "@/lib/encryption";
import { janitorMocks, janitorMockSetup, TEST_DATE_ISO } from "@/__tests__/support/helpers/service-mocks/janitor-mocks";

vi.mock("@/services/workspace");
vi.mock("@/lib/service-factory");
vi.mock("@/lib/db");
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: { RECOMMENDATIONS_UPDATED: "recommendations-updated" },
}));
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({ username: "test-user", token: "ghp_test" }),
}));
vi.mock("@/lib/encryption");

const mockedDb = vi.mocked(db);
const mockedValidateWorkspaceAccess = vi.mocked(validateWorkspaceAccess);

const mockValidation = {
  hasAccess: true,
  canRead: true,
  canWrite: true,
  canAdmin: false,
  workspace: {
    id: "ws-1",
    name: "Test",
    slug: "test",
    ownerId: "owner-1",
    description: null,
    createdAt: TEST_DATE_ISO,
    updatedAt: TEST_DATE_ISO,
  },
};

// Valid RFC-4122 UUIDs (version digit 1–8, variant bits 8–b)
const UUID_1 = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "123e4567-e89b-42d3-b456-426614174001";

// ── createJanitorRun — CONCEPT_REVIEW ──────────────────────────────────────

describe("createJanitorRun — CONCEPT_REVIEW", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      $transaction: vi.fn((cb: any) => cb(mockedDb)),
      janitorConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      janitorRun: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
      workspace: { findUnique: vi.fn() },
    });

    mockedValidateWorkspaceAccess.mockResolvedValue(mockValidation);
  });

  function mockEnvWithConceptReviewId(workflowId: string | undefined) {
    // We need to mock the envConfig module
    vi.doMock("@/config/env", () => ({
      config: {
        STAKWORK_API_KEY: "test-api-key",
        STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID: workflowId,
        STAKWORK_JANITOR_WORKFLOW_ID: "123",
        STAKWORK_GRAPHMINDSET_WORKFLOW_ID: "999",
      },
      optionalEnvVars: {},
    }));
  }

  function mockConfigWithConceptReview() {
    // conceptReviewEnabled must be true for createJanitorRun to pass the enabled check
    const mockConfig = janitorMocks.createMockConfig({ deduplicationEnabled: true });
    // Extend with conceptReviewEnabled
    const configWithCR = { ...mockConfig, conceptReviewEnabled: true };
    janitorMockSetup.mockConfigExists(mockedDb, configWithCR);
    return configWithCR;
  }

  test("dispatches to workflow_id 56167 and creates run with janitorType CONCEPT_REVIEW", async () => {
    mockConfigWithConceptReview();

    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      slug: "test",
      swarm: {
        swarmUrl: "https://test.sphinx.chat/api",
        swarmSecretAlias: "TRZdJtusiYayzcmqFzWknS3t7aO1W8cs",
      },
    } as any);

    const pendingRun = {
      id: "run-cr-1",
      janitorType: "CONCEPT_REVIEW",
      status: "PENDING",
      janitorConfigId: "config-1",
      stakworkProjectId: null,
    };
    const runningRun = { ...pendingRun, status: "RUNNING", stakworkProjectId: 56167 };

    vi.mocked(db.janitorRun.create).mockResolvedValue(pendingRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(runningRun as any);

    const mockStakworkRequest = vi.fn().mockResolvedValue({
      data: { project_id: 56167 },
    });
    vi.mocked(stakworkService).mockReturnValue({ stakworkRequest: mockStakworkRequest } as any);

    // Mock env to include the workflow ID
    const { config: envConfig } = await import("@/config/env");
    vi.mocked(envConfig as any).STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID = "56167";
    vi.mocked(envConfig as any).STAKWORK_API_KEY = "test-api-key";

    const result = await createJanitorRun("test", "user-1", "CONCEPT_REVIEW");

    // Assert workflow_id: 56167 in Stakwork payload
    expect(mockStakworkRequest).toHaveBeenCalledWith(
      "/projects",
      expect.objectContaining({
        workflow_id: 56167,
      }),
    );

    // Assert run created with janitorType CONCEPT_REVIEW
    expect(db.janitorRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          janitorType: "CONCEPT_REVIEW",
        }),
      }),
    );

    expect(result.status).toBe("RUNNING");
    expect(result.stakworkProjectId).toBe(56167);
  });

  test("throws when STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID is missing", async () => {
    mockConfigWithConceptReview();

    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      slug: "test",
      swarm: {
        swarmUrl: "https://test.sphinx.chat/api",
        swarmSecretAlias: "TRZdJtusiYayzcmqFzWknS3t7aO1W8cs",
      },
    } as any);

    vi.mocked(db.janitorRun.create).mockResolvedValue({
      id: "run-cr-1",
      janitorType: "CONCEPT_REVIEW",
      status: "PENDING",
    } as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue({} as any);

    // Remove workflow ID from env
    const { config: envConfig } = await import("@/config/env");
    vi.mocked(envConfig as any).STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID = undefined;
    vi.mocked(envConfig as any).STAKWORK_API_KEY = "test-api-key";

    await expect(
      createJanitorRun("test", "user-1", "CONCEPT_REVIEW"),
    ).rejects.toThrow("STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID is required");
  });

  test("marks run FAILED and rethrows when Stakwork returns no project_id", async () => {
    mockConfigWithConceptReview();

    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      slug: "test",
      swarm: {
        swarmUrl: "https://test.sphinx.chat/api",
        swarmSecretAlias: "alias",
      },
    } as any);

    vi.mocked(db.janitorRun.create).mockResolvedValue({
      id: "run-cr-fail",
      janitorType: "CONCEPT_REVIEW",
      status: "PENDING",
    } as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue({} as any);

    vi.mocked(stakworkService).mockReturnValue({
      stakworkRequest: vi.fn().mockResolvedValue({ data: {} }), // no project_id
    } as any);

    const { config: envConfig } = await import("@/config/env");
    vi.mocked(envConfig as any).STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID = "56167";
    vi.mocked(envConfig as any).STAKWORK_API_KEY = "test-api-key";

    await expect(
      createJanitorRun("test", "user-1", "CONCEPT_REVIEW"),
    ).rejects.toThrow("Failed to start Concept Review janitor run");

    expect(db.janitorRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  test("includes swarmUrl and swarmSecretAlias in Stakwork vars payload", async () => {
    mockConfigWithConceptReview();

    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      slug: "test",
      swarm: {
        swarmUrl: "https://my.swarm.chat/api",
        swarmSecretAlias: "MY_SECRET_ALIAS",
      },
    } as any);

    vi.mocked(db.janitorRun.create).mockResolvedValue({
      id: "run-cr-2",
      janitorType: "CONCEPT_REVIEW",
      status: "PENDING",
    } as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue({
      id: "run-cr-2",
      janitorType: "CONCEPT_REVIEW",
      status: "RUNNING",
      stakworkProjectId: 56167,
    } as any);

    const mockStakworkRequest = vi.fn().mockResolvedValue({ data: { project_id: 56167 } });
    vi.mocked(stakworkService).mockReturnValue({ stakworkRequest: mockStakworkRequest } as any);

    const { config: envConfig } = await import("@/config/env");
    vi.mocked(envConfig as any).STAKWORK_CONCEPT_REVIEW_WORKFLOW_ID = "56167";
    vi.mocked(envConfig as any).STAKWORK_API_KEY = "test-api-key";

    await createJanitorRun("test", "user-1", "CONCEPT_REVIEW");

    expect(mockStakworkRequest).toHaveBeenCalledWith(
      "/projects",
      expect.objectContaining({
        workflow_params: expect.objectContaining({
          set_var: expect.objectContaining({
            attributes: expect.objectContaining({
              vars: expect.objectContaining({
                swarmUrl: "https://my.swarm.chat/api",
                swarmSecretAlias: "MY_SECRET_ALIAS",
              }),
            }),
          }),
        }),
      }),
    );
  });
});

// ── processJanitorWebhook — CONCEPT_REVIEW branch ────────────────────────────

describe("processJanitorWebhook — CONCEPT_REVIEW", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      $transaction: vi.fn((cb: any) => cb(mockedDb)),
      janitorConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      janitorRun: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
      janitorRecommendation: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        createMany: vi.fn(),
      },
      swarm: { findFirst: vi.fn() },
    });

    mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "ok" });
    vi.stubGlobal("fetch", mockFetch);

    // EncryptionService mock
    const mockInstance = {
      decryptField: vi.fn().mockReturnValue("decrypted-api-key"),
    };
    vi.mocked(EncryptionService).getInstance = vi.fn().mockReturnValue(mockInstance);
  });

  const makeConceptReviewRun = () => ({
    id: "run-cr-1",
    janitorType: "CONCEPT_REVIEW",
    status: "COMPLETED",
    stakworkProjectId: 99001,
    metadata: { triggeredByUserId: "user-1", workspaceId: "ws-1" },
    janitorConfig: {
      id: "config-1",
      workspaceId: "ws-1",
      workspace: {
        id: "ws-1",
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: "owner-1",
        swarm: {
          id: "swarm-1",
          swarmUrl: "https://test.sphinx.chat/api",
          swarmSecretAlias: "alias",
        },
        repositories: [],
      },
    },
    _count: { recommendations: 0 },
  });

  test("POSTs each proposal to swarm:3355/gitree/proposals and returns proposalCount", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    const result = await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [
          { type: "create", conceptId: UUID_1 },
          { type: "update", conceptId: UUID_2 },
        ],
      },
    });

    // 2 proposals POSTed
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.sphinx.chat:3355/gitree/proposals",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-api-token": "decrypted-api-key",
        }),
        body: expect.stringContaining("janitor:concept_review"),
      }),
    );

    expect(result.status).toBe("COMPLETED");
    expect((result as any).proposalCount).toBe(2);
  });

  test("marks run COMPLETED with completedByWebhook: true", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: { proposals: [] },
    });

    expect(db.janitorRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ completedByWebhook: true }),
        }),
      }),
    );
  });

  test("writes no JanitorRecommendation rows for CONCEPT_REVIEW", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [{ type: "create", conceptId: UUID_1 }],
      },
    });

    // Must not write any recommendations
    expect(db.janitorRecommendation.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("returns proposalCount: 0 and COMPLETED when no swarmApiKey", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: null,
    } as any);

    const result = await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [{ type: "create", conceptId: UUID_1 }],
      },
    });

    expect(result.status).toBe("COMPLETED");
    expect((result as any).proposalCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("caps proposals at 100 and returns proposalCount: 100", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    // 110 proposals — service must cap at 100 regardless of schema
    const proposals = Array.from({ length: 110 }, (_, i) => ({
      type: "create" as const,
      conceptId: UUID_1, // reuse valid UUID — service doesn't re-validate
    }));

    const result = await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: { proposals },
    });

    expect(mockFetch).toHaveBeenCalledTimes(100);
    expect((result as any).proposalCount).toBe(100);
  });

  test("counts only successfully forwarded proposals (not failed ones)", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    // First call succeeds, second fails
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: async () => "ok" })
      .mockResolvedValueOnce({ ok: false, text: async () => "Bad Request", statusText: "Bad Request" });

    const result = await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [
          { type: "create", conceptId: UUID_1 },
          { type: "update", conceptId: UUID_2 },
        ],
      },
    });

    expect((result as any).proposalCount).toBe(1);
    expect(result.status).toBe("COMPLETED");
  });

  test("merges source: janitor:concept_review into each forwarded proposal body", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://test.sphinx.chat/api",
      swarmApiKey: "encrypted-key",
    } as any);

    await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [{ type: "create", conceptId: UUID_1 }],
      },
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.source).toBe("janitor:concept_review");
    expect(callBody.type).toBe("create");
    expect(callBody.conceptId).toBe(UUID_1);
  });

  test("uses port 3355 derived from swarmUrl hostname", async () => {
    const mockRun = makeConceptReviewRun();

    vi.mocked(db.janitorRun.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(mockRun as any);
    vi.mocked(db.janitorRun.update).mockResolvedValue(mockRun as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      swarmUrl: "https://myswarm.example.com/api",
      swarmApiKey: "encrypted-key",
    } as any);

    await processJanitorWebhook({
      projectId: 99001,
      status: "completed",
      results: {
        proposals: [{ type: "create", conceptId: UUID_1 }],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://myswarm.example.com:3355/gitree/proposals",
      expect.any(Object),
    );
  });
});

// ── conceptProposalSchema validation ──────────────────────────────────────────

describe("conceptProposalSchema", () => {
  // Import the Zod library directly and reproduce the schema from the webhook route
  // to test it in isolation without module-loading side effects.
  async function makeSchema() {
    const { z } = await import("zod");
    return z
      .object({
        type: z.enum(["create", "update", "merge", "delete"]),
        conceptId: z.string().uuid(),
      })
      .passthrough();
  }

  test("rejects payload missing 'type'", async () => {
    const schema = await makeSchema();
    const result = schema.safeParse({ conceptId: UUID_1 });
    expect(result.success).toBe(false);
  });

  test("rejects payload with non-UUID conceptId", async () => {
    const schema = await makeSchema();
    const result = schema.safeParse({ type: "create", conceptId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  test("rejects payload with invalid type enum value", async () => {
    const schema = await makeSchema();
    const result = schema.safeParse({ type: "replace", conceptId: UUID_1 });
    expect(result.success).toBe(false);
  });

  test("accepts valid proposals for all four type values", async () => {
    const schema = await makeSchema();
    for (const type of ["create", "update", "merge", "delete"] as const) {
      const result = schema.safeParse({ type, conceptId: UUID_1 });
      expect(result.success).toBe(true);
    }
  });

  test("passthrough preserves extra fields", async () => {
    const schema = await makeSchema();
    const result = schema.safeParse({ type: "create", conceptId: UUID_1, extra: "data" });
    expect(result.success).toBe(true);
    expect((result as any).data.extra).toBe("data");
  });

  test("max(100) rejects arrays of 101 proposals", async () => {
    const { z } = await import("zod");
    const schema = await makeSchema();
    const arr101Schema = z.array(schema).max(100);
    const tooMany = Array.from({ length: 101 }, () => ({
      type: "create" as const,
      conceptId: UUID_1,
    }));
    const result = arr101Schema.safeParse(tooMany);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("too_big");
  });

  test("max(100) accepts arrays of exactly 100 proposals", async () => {
    const { z } = await import("zod");
    const schema = await makeSchema();
    const arr100Schema = z.array(schema).max(100);
    const exactly100 = Array.from({ length: 100 }, () => ({
      type: "create" as const,
      conceptId: UUID_1,
    }));
    const result = arr100Schema.safeParse(exactly100);
    expect(result.success).toBe(true);
  });
});

// ── Webhook route — timingSafeEqual token verification ────────────────────────

describe("Webhook route — timingSafeEqual token verification", () => {
  // Tests verify the route returns 401 for invalid/missing tokens.
  // timingSafeEqual requires same-length buffers; the route wraps it in
  // a try/catch so different-length tokens should still return 401 (not 500).

  async function callWebhookRoute(
    tokenHeader: string | null,
    envToken: string,
  ) {
    const originalToken = process.env.API_TOKEN;
    process.env.API_TOKEN = envToken;
    try {
      // Import route fresh each time since vi.resetModules() isn't called here
      const { POST } = await import("@/app/api/janitors/webhook/route");
      const { NextRequest } = await import("next/server");

      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (tokenHeader !== null) {
        (headers as Record<string, string>)["x-api-token"] = tokenHeader;
      }

      const req = new NextRequest("http://localhost/api/janitors/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId: 1, status: "completed" }),
      });

      return await POST(req);
    } finally {
      if (originalToken !== undefined) {
        process.env.API_TOKEN = originalToken;
      } else {
        delete process.env.API_TOKEN;
      }
    }
  }

  test("rejects missing x-api-token header with 401", async () => {
    const response = await callWebhookRoute(null, "correct-token");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("rejects when API_TOKEN env is empty string with 401", async () => {
    const response = await callWebhookRoute("some-token", "");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("rejects matching-length wrong token with 401 via timingSafeEqual", async () => {
    // Same length so timingSafeEqual does not throw — pure crypto comparison
    const response = await callWebhookRoute("AAAAAAAAAAAAA", "BBBBBBBBBBBBB");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });
});

// ── getAllGraphMindsetJanitorItems — CONCEPT_REVIEW present ───────────────────

describe("getAllGraphMindsetJanitorItems — CONCEPT_REVIEW", () => {
  test("returns CONCEPT_REVIEW alongside DEDUPLICATION and LINGO_EXTRACTION", async () => {
    const { getAllGraphMindsetJanitorItems } = await import("@/lib/constants/janitor");
    const { JanitorType } = await import("@prisma/client");

    const items = getAllGraphMindsetJanitorItems();
    const ids = items.map((i) => i.id);

    expect(ids).toContain(JanitorType.CONCEPT_REVIEW);
    expect(ids).toContain(JanitorType.DEDUPLICATION);
    expect(ids).toContain(JanitorType.LINGO_EXTRACTION);
  });

  test("each item has id, name, description, icon, configKey", async () => {
    const { getAllGraphMindsetJanitorItems } = await import("@/lib/constants/janitor");

    const items = getAllGraphMindsetJanitorItems();
    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.description).toBeDefined();
      expect(item.icon).toBeDefined();
      expect(item.configKey).toBeDefined();
    }
  });

  test("CONCEPT_REVIEW item has configKey: conceptReviewEnabled", async () => {
    const { getAllGraphMindsetJanitorItems } = await import("@/lib/constants/janitor");
    const { JanitorType } = await import("@prisma/client");

    const items = getAllGraphMindsetJanitorItems();
    const cr = items.find((i) => i.id === JanitorType.CONCEPT_REVIEW);
    expect(cr).toBeDefined();
    expect(cr?.configKey).toBe("conceptReviewEnabled");
  });
});

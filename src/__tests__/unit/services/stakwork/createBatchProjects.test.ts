import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPost = vi.fn();

vi.mock("@/lib/http-client", () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    post: mockPost,
  })),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: (_field: string, value: string) => value,
    }),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com",
    STAKWORK_API_KEY: "test-api-key",
  },
}));

import { StakworkService } from "@/services/stakwork/index";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeService(): StakworkService {
  return new StakworkService({
    baseURL: "https://api.stakwork.com",
    apiKey: "test-api-key",
  });
}

const sampleProject = {
  name: "daily-recap-user-1",
  workflow_id: 42,
  webhook_url: "https://hive.example.com/api/webhooks/stakwork/daily-recap/run-1",
  workflow_params: {
    set_var: {
      attributes: {
        vars: { user_id: "user-1", activity: "summary text" },
      },
    },
  },
};

const batchResponse = {
  data: {
    ref_id: "ref-abc",
    projects: [{ name: "daily-recap-user-1", project_id: 999 }],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StakworkService.createBatchProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue(batchResponse);
  });

  it("wraps each project item under a `project` key before posting", async () => {
    const service = makeService();
    await service.createBatchProjects([sampleProject]);

    expect(mockPost).toHaveBeenCalledOnce();
    const [, body] = mockPost.mock.calls[0];
    expect(body).toEqual({
      projects: [{ project: sampleProject }],
    });
  });

  it("wraps multiple items individually under separate `project` keys", async () => {
    const second = { ...sampleProject, name: "daily-recap-user-2", workflow_id: 43 };
    const service = makeService();

    mockPost.mockResolvedValue({
      data: {
        ref_id: "ref-xyz",
        projects: [
          { name: "daily-recap-user-1", project_id: 1 },
          { name: "daily-recap-user-2", project_id: 2 },
        ],
      },
    });

    await service.createBatchProjects([sampleProject, second]);

    const [, body] = mockPost.mock.calls[0];
    expect(body).toEqual({
      projects: [{ project: sampleProject }, { project: second }],
    });
  });

  it("posts to /projects/batch", async () => {
    const service = makeService();
    await service.createBatchProjects([sampleProject]);

    const [endpoint] = mockPost.mock.calls[0];
    expect(endpoint).toBe("/projects/batch");
  });

  it("returns the service response data as-is", async () => {
    const service = makeService();
    const result = await service.createBatchProjects([sampleProject]);

    expect(result).toEqual(batchResponse);
  });

  it("includes an Authorization header with the API key", async () => {
    const service = makeService();
    await service.createBatchProjects([sampleProject]);

    const [, , headers] = mockPost.mock.calls[0];
    expect(headers).toMatchObject({
      Authorization: "Token token=test-api-key",
      "Content-Type": "application/json",
    });
  });
});

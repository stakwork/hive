/**
 * Unit tests for GET /api/workflow/prompts/[id]/versions?fields=state
 *
 * Covers:
 *  - Lean projection: omits value, description, whodunnit, published_by, run_count
 *  - Includes id, version_number, published, created_at, source
 *  - Returns published_version_id from Prompt model
 *  - Does NOT execute the promptDailyRun aggregate queries
 *  - Full response is unchanged when ?fields=state is absent
 *  - Membership gate still enforced before the lean branch
 *  - 401/403 still returned before any DB reads
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockWorkspaceFindFirst,
  mockPromptFindUnique,
  mockPromptVersionFindMany,
  mockPromptDailyRunGroupBy,
  mockPromptDailyRunAggregate,
  mockUserFindMany,
} = vi.hoisted(() => ({
  mockWorkspaceFindFirst: vi.fn(),
  mockPromptFindUnique: vi.fn(),
  mockPromptVersionFindMany: vi.fn(),
  mockPromptDailyRunGroupBy: vi.fn(),
  mockPromptDailyRunAggregate: vi.fn(),
  mockUserFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: mockWorkspaceFindFirst },
    prompt: { findUnique: mockPromptFindUnique },
    promptVersion: { findMany: mockPromptVersionFindMany },
    promptDailyRun: {
      groupBy: mockPromptDailyRunGroupBy,
      aggregate: mockPromptDailyRunAggregate,
    },
    user: { findMany: mockUserFindMany },
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

import { getServerSession } from "next-auth/next";

import type { NextRequest as NextRequestType } from "next/server";

const PROMPT_ID = "prompt-abc";
const API_TOKEN = "test-token-xyz";

const MOCK_PROMPT = {
  id: PROMPT_ID,
  name: "MY_PROMPT",
  publishedVersionId: "v1",
};

const MOCK_VERSIONS = [
  {
    id: "v3",
    versionNumber: 3,
    value: "secret body v3",
    description: "v3 desc",
    whodunnit: "user-1",
    whodunnit_display: null,
    published: false,
    publishedBy: null,
    publishedAt: null,
    source: "MCP",
    createdAt: new Date("2025-06-01T13:00:00Z"),
  },
  {
    id: "v2",
    versionNumber: 2,
    value: "secret body v2",
    description: "v2 desc",
    whodunnit: "user-1",
    whodunnit_display: null,
    published: false,
    publishedBy: null,
    publishedAt: null,
    source: "MCP",
    createdAt: new Date("2025-06-01T12:00:00Z"),
  },
  {
    id: "v1",
    versionNumber: 1,
    value: "secret body v1",
    description: "v1 desc",
    whodunnit: "user-2",
    whodunnit_display: null,
    published: true,
    publishedBy: "user-2",
    publishedAt: new Date("2025-06-01T11:00:00Z"),
    source: "UI",
    createdAt: new Date("2025-06-01T11:00:00Z"),
  },
];

function makeRequest(
  url: string,
  options: { apiToken?: string; sessionUserId?: string } = {},
): NextRequestType {
  const headers: Record<string, string> = {};
  if (options.apiToken) {
    headers["x-api-token"] = options.apiToken;
    process.env.API_TOKEN = options.apiToken;
  }
  if (options.sessionUserId) {
    headers["x-middleware-auth-status"] = "authenticated";
    headers["x-middleware-user-id"] = options.sessionUserId;
    headers["x-middleware-user-email"] = "user@example.com";
    headers["x-middleware-user-name"] = "Test User";
  }
  return new NextRequest(`http://localhost${url}`, { method: "GET", headers });
}

const PARAMS = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/workflow/prompts/[id]/versions?fields=state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_TOKEN;
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws-1", slug: "stakwork" });
    mockPromptFindUnique.mockResolvedValue(MOCK_PROMPT);
    mockPromptVersionFindMany.mockResolvedValue(MOCK_VERSIONS);
    mockPromptDailyRunGroupBy.mockResolvedValue([]);
    mockPromptDailyRunAggregate.mockResolvedValue({ _sum: { runCount: 0 } });
    mockUserFindMany.mockResolvedValue([]);
  });

  it("returns lean projection with id, version_number, published, created_at, source", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS(PROMPT_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const v = body.data.versions[0];
    expect(v).toHaveProperty("id");
    expect(v).toHaveProperty("version_number");
    expect(v).toHaveProperty("published");
    expect(v).toHaveProperty("created_at");
    expect(v).toHaveProperty("source");
  });

  it("omits value (prompt body) from the lean response", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS(PROMPT_ID));
    const body = await res.json();

    for (const v of body.data.versions) {
      expect(v).not.toHaveProperty("value");
      expect(v).not.toHaveProperty("description");
      expect(v).not.toHaveProperty("whodunnit");
      expect(v).not.toHaveProperty("whodunnit_display");
      expect(v).not.toHaveProperty("published_by");
      expect(v).not.toHaveProperty("published_by_display");
      expect(v).not.toHaveProperty("published_at");
      expect(v).not.toHaveProperty("run_count");
    }
  });

  it("includes published_version_id from the Prompt model", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS(PROMPT_ID));
    const body = await res.json();

    expect(body.data.published_version_id).toBe("v1");
  });

  it("includes current_version_id (latest version id)", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS(PROMPT_ID));
    const body = await res.json();

    // current_version_id is the first item in the desc-ordered versions list
    expect(body.data.current_version_id).toBe("v3");
  });

  it("does NOT execute the promptDailyRun aggregate queries", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    await GET(req, PARAMS(PROMPT_ID));

    expect(mockPromptDailyRunGroupBy).not.toHaveBeenCalled();
    expect(mockPromptDailyRunAggregate).not.toHaveBeenCalled();
  });

  it("does NOT execute the user.findMany email-lookup query", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    await GET(req, PARAMS(PROMPT_ID));

    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("full response is unchanged when ?fields=state is absent", async () => {
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS(PROMPT_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Full response has these extra top-level fields
    expect(body.data).toHaveProperty("prompt_name");
    expect(body.data).toHaveProperty("version_count");
    expect(body.data).toHaveProperty("total_run_count");
    // Full versions include value and run_count
    const v = body.data.versions[0];
    expect(v).toHaveProperty("value");
    expect(v).toHaveProperty("run_count");
    // Queries ran
    expect(mockPromptDailyRunGroupBy).toHaveBeenCalled();
    expect(mockUserFindMany).toHaveBeenCalled();
  });

  it("membership gate still enforced — returns 403 before lean branch", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(null);
    // Provide a real session so the route passes auth and reaches the membership check.
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: "user-1", name: "Test User", email: "user@example.com" },
    } as never);

    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    // No API token — session path so membership gate runs
    const url = `/api/workflow/prompts/${PROMPT_ID}/versions?fields=state`;
    const req = makeRequest(url);
    const res = await GET(req, PARAMS(PROMPT_ID));

    expect(res.status).toBe(403);
    expect(mockPromptVersionFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 when prompt does not exist", async () => {
    mockPromptFindUnique.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/workflow/prompts/[id]/versions/route"
    );
    const url = `/api/workflow/prompts/nonexistent/versions?fields=state`;
    const req = makeRequest(url, { apiToken: "tok" });
    const res = await GET(req, PARAMS("nonexistent"));

    expect(res.status).toBe(404);
  });
});

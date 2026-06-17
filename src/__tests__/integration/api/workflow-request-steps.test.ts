/**
 * Integration tests for GET /api/workspaces/[slug]/workflows/[workflowId]/runs/[runId]/request-steps
 *
 * Covers:
 * - 401 for unauthenticated requests
 * - 404 IDOR guard for non-member user
 * - 404 for non-existent workspace slug
 * - 400 for non-numeric workflowId or runId
 * - Dev mode → delegates to mock endpoint → returns steps array
 * - 200 with steps: [] for a run with no LLM steps
 * - 200 with correctly shaped steps for a mocked LLM run
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createGetRequest,
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockIsDevelopmentMode = vi.fn().mockReturnValue(false);

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => mockIsDevelopmentMode(),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

const mockFetch = vi.fn();

import { GET } from "@/app/api/workspaces/[slug]/workflows/[workflowId]/runs/[runId]/request-steps/route";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

async function createTestFixtures() {
  const user = await createTestUser({
    id: generateUniqueId("rs-user"),
    email: `rs-${Date.now()}@example.com`,
  });
  createdUserIds.push(user.id);

  const workspace = await createTestWorkspace({
    id: generateUniqueId("rs-ws"),
    name: "Request Steps Test Workspace",
    slug: `rs-ws-${Date.now()}`,
    ownerId: user.id,
  });
  createdWorkspaceIds.push(workspace.id);

  await db.workspaceMember.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: "OWNER",
    },
  });

  return { user, workspace };
}

function makeRequest(slug: string, workflowId: string, runId: string) {
  return createGetRequest(
    `http://localhost/api/workspaces/${slug}/workflows/${workflowId}/runs/${runId}/request-steps`,
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch;
});

afterEach(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.workspaceMember.deleteMany({
      where: { workspaceId: { in: createdWorkspaceIds } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: createdWorkspaceIds } },
    });
    createdWorkspaceIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

// ── Auth tests ────────────────────────────────────────────────────────────────

describe("GET .../runs/[runId]/request-steps", () => {
  describe("Authentication", () => {
    test("returns 401 for unauthenticated requests", async () => {
      const { workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    test("returns 404 IDOR for non-member authenticated user", async () => {
      const { workspace } = await createTestFixtures();
      const nonMember = await createTestUser({
        id: generateUniqueId("rs-nonmember"),
        email: `rs-nonmember-${Date.now()}@example.com`,
      });
      createdUserIds.push(nonMember.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error ?? data.success).toBeDefined();
      // upstream fetch must NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 for non-existent workspace slug", async () => {
      const user = await createTestUser({
        id: generateUniqueId("rs-user2"),
        email: `rs2-${Date.now()}@example.com`,
      });
      createdUserIds.push(user.id);
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRequest("no-such-workspace-slug", "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: "no-such-workspace-slug", workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Input validation", () => {
    test("returns 400 for non-numeric workflowId", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRequest(workspace.slug, "not-a-number", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "not-a-number", runId: "1001" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/invalid workflow id/i);
    });

    test("returns 400 for non-numeric runId", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = makeRequest(workspace.slug, "42", "not-a-number");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "not-a-number" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/invalid run id/i);
    });
  });

  describe("Dev mode", () => {
    test("delegates to mock endpoint and returns steps in dev mode", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(true);

      const mockSteps = [
        {
          stepId: "llm_generate_title",
          name: "Generate Title",
          model: "gpt-4o-mini",
          provider: "openai",
          endpoint_url: "https://api.openai.com/v1/chat/completions",
          preview: "SKIP",
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { steps: mockSteps } }),
      });

      const request = makeRequest(workspace.slug, "99", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "99", runId: "1001" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.steps).toHaveLength(1);
      expect(data.data.steps[0].stepId).toBe("llm_generate_title");
    });
  });

  describe("Prod mode — step filtering", () => {
    test("returns steps: [] for a run with no LLM transitions", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      // Real Stakwork shape: { success, data: { transitions } } with only non-LLM transitions
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: {
              t1: { id: "t1", name: "fetch_data", attributes: { url: "https://internal.example.com/api" } },
              t2: { id: "t2", name: "store_result", attributes: {} },
            },
            connections: [],
          },
        }),
      });

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.steps).toEqual([]);
    });

    test("REGRESSION: real data.transitions wrapper — returns LLM steps (guards the empty-steps bug)", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      // This is the exact shape returned by real Stakwork /projects/{id}.json
      // Previously normalizeTransitions never unwrapped data.transitions → always empty
      const realStakworkShape = {
        success: true,
        data: {
          transitions: {
            request_openai: {
              unique_id: "request_openai",
              display_name: "Request skill to OpenAI",
              url: "https://api.openai.com/v1/chat/completions",
              method: "post",
              attributes: {
                raw_input_params: {
                  model: "gpt-4o",
                  messages: [{ role: "user", content: "Summarise this" }],
                },
              },
              output: {
                response: {
                  choices: [{ message: { content: "Summary here" }, finish_reason: "stop" }],
                },
              },
            },
            set_var: {
              unique_id: "set_var",
              display_name: "Set Variable",
              attributes: { url: null },
            },
          },
          connections: [],
          project: { id: 146887244 },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => realStakworkShape,
      });

      const request = makeRequest(workspace.slug, "55177", "146887244");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "55177", runId: "146887244" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      // Must NOT be empty — regression guard for the data-wrapper bug
      expect(data.data.steps).toHaveLength(1);
      expect(data.data.steps[0].stepId).toBe("request_openai");
      expect(data.data.steps[0].model).toBe("gpt-4o");
      expect(data.data.steps[0].provider).toBe("openai");
      expect(data.data.steps[0].endpoint_url).toBe("https://api.openai.com/v1/chat/completions");
    });

    test("returns correctly shaped steps for a run with LLM transitions", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      // Real Stakwork shape: { success, data: { transitions } }
      const projectJson = {
        success: true,
        data: {
          transitions: {
            llm_generate_title: {
              unique_id: "llm_generate_title",
              display_name: "Generate Title",
              url: "https://api.openai.com/v1/chat/completions",
              method: "post",
              attributes: {
                raw_input_params: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
              },
              output: {
                response: {
                  choices: [{ message: { content: "Great title!" }, finish_reason: "stop" }],
                },
              },
            },
            llm_evaluate: {
              unique_id: "llm_evaluate",
              display_name: "Evaluate Quality",
              step: {
                attributes: {
                  url: "https://api.anthropic.com/v1/messages",
                  raw_input_params: { model: "claude-3-5-sonnet-20241022", messages: [] },
                },
              },
              output: {
                response: {
                  content: [{ text: "The output looks correct." }],
                },
              },
            },
            non_llm_step: {
              unique_id: "non_llm_step",
              name: "some_other_step",
              attributes: { url: "https://internal.example.com/transform" },
            },
          },
          connections: [],
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => projectJson,
      });

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.steps).toHaveLength(2);

      const [step1, step2] = data.data.steps;

      expect(step1.stepId).toBe("llm_generate_title");
      expect(step1.name).toBe("Generate Title");
      expect(step1.model).toBe("gpt-4o-mini");
      expect(step1.provider).toBe("openai");
      expect(step1.endpoint_url).toBe("https://api.openai.com/v1/chat/completions");
      expect(step1.preview).toBe("Great title!");

      expect(step2.stepId).toBe("llm_evaluate");
      expect(step2.provider).toBe("anthropic");
      expect(step2.preview).toBe("The output looks correct.");
    });

    test("truncates preview to 120 chars", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const longContent = "X".repeat(200);
      // Use real Stakwork shape
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: {
              llm_step: {
                unique_id: "llm_step",
                name: "LLM Step",
                url: "https://api.openai.com/v1/chat/completions",
                output: {
                  response: {
                    choices: [{ message: { content: longContent }, finish_reason: "stop" }],
                  },
                },
              },
            },
          },
        }),
      });

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      const data = await response.json();
      expect(data.data.steps[0].preview).toHaveLength(120);
    });

    test("returns steps: [] when upstream returns non-200 (does not 5xx)", async () => {
      const { user, workspace } = await createTestFixtures();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
      mockIsDevelopmentMode.mockReturnValue(false);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "err",
      });

      const request = makeRequest(workspace.slug, "42", "1001");
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug, workflowId: "42", runId: "1001" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.steps).toEqual([]);
      consoleErrorSpy.mockRestore();
    });
  });
});

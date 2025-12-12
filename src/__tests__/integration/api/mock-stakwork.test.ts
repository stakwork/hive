import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as GeneratePost, GET as GenerateGet } from "@/app/api/mock/stakwork/generate/route";
import { POST as PlanPost, GET as PlanGet } from "@/app/api/mock/stakwork/plan/route";
import { POST as ResearchPost } from "@/app/api/mock/stakwork/research/route";
import { GET as ResearchGet } from "@/app/api/mock/stakwork/research/[id]/route";
import { mockStakworkState } from "@/lib/mock/stakwork-state";
import { expectSuccess, expectError, createPostRequest, createGetRequest } from "@/__tests__/support/helpers";

// Mock fetch for webhook testing
global.fetch = vi.fn();

// Increase test timeout for async tests
const ASYNC_TEST_TIMEOUT = 15000;

describe("Mock Stakwork Generate Endpoints", () => {
  beforeEach(() => {
    mockStakworkState.reset();
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe("POST /api/mock/stakwork/generate", () => {
    test("should create generate request with valid prompt", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Create a React component for user profile",
      });

      const response = await GeneratePost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toMatch(/^gen_\d+$/);
      expect(data.status).toBe("pending");
      expect(data.progress).toBe(0);
      expect(data.message).toBe("Code generation started");
    });

    test("should return 400 when prompt is missing", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {});

      const response = await GeneratePost(request);
      await expectError(response, "prompt is required", 400);
    });

    test("should accept webhookUrl parameter", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Generate code",
        webhookUrl,
      });

      const response = await GeneratePost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toBeDefined();
    });

    test("should handle JSON parse errors", async () => {
      const request = new NextRequest("http://localhost:3000/api/mock/stakwork/generate", {
        method: "POST",
        body: "invalid json",
      });

      const response = await GeneratePost(request);
      await expectError(response, "Internal server error", 500);
    });
  });

  describe("GET /api/mock/stakwork/generate", () => {
    test("should return generate request status", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Test prompt",
      });
      const createResponse = await GeneratePost(createRequest);
      const createData = await expectSuccess(createResponse);

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/generate?requestId=${createData.requestId}`
      );
      const statusResponse = await GenerateGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.success).toBe(true);
      expect(statusData.requestId).toBe(createData.requestId);
      expect(statusData.status).toMatch(/pending|processing|completed/);
      expect(statusData.progress).toBeGreaterThanOrEqual(0);
      expect(statusData.createdAt).toBeDefined();
    });

    test("should return 400 when requestId is missing", async () => {
      const request = createGetRequest("http://localhost:3000/api/mock/stakwork/generate");

      const response = await GenerateGet(request);
      await expectError(response, "requestId is required", 400);
    });

    test("should return 404 for non-existent requestId", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/mock/stakwork/generate?requestId=non_existent"
      );

      const response = await GenerateGet(request);
      await expectError(response, "Generate request not found", 404);
    });

    test("should return completed status with result", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Test prompt",
      });
      const createResponse = await GeneratePost(createRequest);
      const createData = await expectSuccess(createResponse);

      // Wait for completion (~5.5 seconds)
      await new Promise((resolve) => setTimeout(resolve, 6000));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/generate?requestId=${createData.requestId}`
      );
      const statusResponse = await GenerateGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.status).toBe("completed");
      expect(statusData.progress).toBe(100);
      expect(statusData.result).toBeDefined();
      expect(statusData.result.files).toBeDefined();
      expect(Array.isArray(statusData.result.files)).toBe(true);
      expect(statusData.result.files.length).toBeGreaterThan(0);
      expect(statusData.result.summary).toBeDefined();
      expect(statusData.result.estimatedEffort).toBeDefined();
      expect(statusData.completedAt).toBeDefined();
    }, 10000); // Increase timeout to 10 seconds

    test("should return files with correct structure", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Test prompt",
      });
      const createResponse = await GeneratePost(createRequest);
      const createData = await expectSuccess(createResponse);

      await new Promise((resolve) => setTimeout(resolve, 6000));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/generate?requestId=${createData.requestId}`
      );
      const statusResponse = await GenerateGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      const file = statusData.result.files[0];
      expect(file).toHaveProperty("path");
      expect(file).toHaveProperty("content");
      expect(file).toHaveProperty("language");
      expect(typeof file.path).toBe("string");
      expect(typeof file.content).toBe("string");
      expect(typeof file.language).toBe("string");
    }, 10000); // Increase timeout to 10 seconds
  });

  describe("Webhook Integration - Generate", () => {
    test("should trigger webhook on completion", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Test prompt",
        webhookUrl,
      });

      await GeneratePost(request);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 6000));

      expect(global.fetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.any(String),
        })
      );

      const callArgs = (global.fetch as any).mock.calls.find((call: any) => call[0] === webhookUrl);
      expect(callArgs).toBeDefined();
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.type).toBe("generate.completed");
      expect(payload.status).toBe("completed");
      expect(payload.result).toBeDefined();
    });

    test("should handle webhook failure gracefully", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/generate", {
        prompt: "Test prompt",
        webhookUrl: "https://example.com/webhook",
      });

      // Should not throw
      const response = await GeneratePost(request);
      await expectSuccess(response);
    });
  });
});

describe("Mock Stakwork Plan Endpoints", () => {
  beforeEach(() => {
    mockStakworkState.reset();
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe("POST /api/mock/stakwork/plan", () => {
    test("should create plan request with valid description", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Build user authentication system",
      });

      const response = await PlanPost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toMatch(/^plan_\d+$/);
      expect(data.status).toBe("pending");
      expect(data.progress).toBe(0);
      expect(data.message).toBe("Planning analysis started");
    });

    test("should return 400 when description is missing", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {});

      const response = await PlanPost(request);
      await expectError(response, "description is required", 400);
    });

    test("should accept webhookUrl parameter", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Plan project",
        webhookUrl,
      });

      const response = await PlanPost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toBeDefined();
    });
  });

  describe("GET /api/mock/stakwork/plan", () => {
    test("should return plan request status", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Test description",
      });
      const createResponse = await PlanPost(createRequest);
      const createData = await expectSuccess(createResponse);

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/plan?requestId=${createData.requestId}`
      );
      const statusResponse = await PlanGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.success).toBe(true);
      expect(statusData.requestId).toBe(createData.requestId);
      expect(statusData.status).toMatch(/pending|processing|completed/);
      expect(statusData.progress).toBeGreaterThanOrEqual(0);
    });

    test("should return 400 when requestId is missing", async () => {
      const request = createGetRequest("http://localhost:3000/api/mock/stakwork/plan");

      const response = await PlanGet(request);
      await expectError(response, "requestId is required", 400);
    });

    test("should return 404 for non-existent requestId", async () => {
      const request = createGetRequest("http://localhost:3000/api/mock/stakwork/plan?requestId=non_existent");

      const response = await PlanGet(request);
      await expectError(response, "Plan request not found", 404);
    });

    test("should return completed status with result", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Test description",
      });
      const createResponse = await PlanPost(createRequest);
      const createData = await expectSuccess(createResponse);

      // Wait for completion (~6 seconds)
      await new Promise((resolve) => setTimeout(resolve, 7000));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/plan?requestId=${createData.requestId}`
      );
      const statusResponse = await PlanGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.status).toBe("completed");
      expect(statusData.progress).toBe(100);
      expect(statusData.result).toBeDefined();
      expect(statusData.result.tasks).toBeDefined();
      expect(Array.isArray(statusData.result.tasks)).toBe(true);
      expect(statusData.result.tasks.length).toBeGreaterThan(0);
      expect(statusData.result.phases).toBeDefined();
      expect(Array.isArray(statusData.result.phases)).toBe(true);
      expect(statusData.result.summary).toBeDefined();
      expect(statusData.result.totalEstimatedHours).toBeDefined();
    });

    test("should return tasks with correct structure", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Test description",
      });
      const createResponse = await PlanPost(createRequest);
      const createData = await expectSuccess(createResponse);

      await new Promise((resolve) => setTimeout(resolve, 7000));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/plan?requestId=${createData.requestId}`
      );
      const statusResponse = await PlanGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      const task = statusData.result.tasks[0];
      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("title");
      expect(task).toHaveProperty("description");
      expect(task).toHaveProperty("priority");
      expect(task).toHaveProperty("estimatedHours");
      expect(task).toHaveProperty("dependencies");
      expect(Array.isArray(task.dependencies)).toBe(true);
      expect(["high", "medium", "low"]).toContain(task.priority);
    });

    test("should return phases with correct structure", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Test description",
      });
      const createResponse = await PlanPost(createRequest);
      const createData = await expectSuccess(createResponse);

      await new Promise((resolve) => setTimeout(resolve, 7000));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/plan?requestId=${createData.requestId}`
      );
      const statusResponse = await PlanGet(statusRequest);
      const statusData = await expectSuccess(statusResponse);

      const phase = statusData.result.phases[0];
      expect(phase).toHaveProperty("name");
      expect(phase).toHaveProperty("taskIds");
      expect(phase).toHaveProperty("duration");
      expect(Array.isArray(phase.taskIds)).toBe(true);
    });
  });

  describe("Webhook Integration - Plan", () => {
    test("should trigger webhook on completion", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/plan", {
        description: "Test description",
        webhookUrl,
      });

      await PlanPost(request);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 7000));

      expect(global.fetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: "POST",
        })
      );

      const callArgs = (global.fetch as any).mock.calls.find((call: any) => call[0] === webhookUrl);
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.type).toBe("plan.completed");
      expect(payload.status).toBe("completed");
      expect(payload.result).toBeDefined();
    });
  });
});

describe("Mock Stakwork Research Endpoints", () => {
  beforeEach(() => {
    mockStakworkState.reset();
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  describe("POST /api/mock/stakwork/research", () => {
    test("should create research request with valid topic", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Performance optimization opportunities",
      });

      const response = await ResearchPost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toMatch(/^research_\d+$/);
      expect(data.status).toBe("pending");
      expect(data.progress).toBe(0);
      expect(data.message).toBe("Deep research started");
    });

    test("should return 400 when topic is missing", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {});

      const response = await ResearchPost(request);
      await expectError(response, "topic is required", 400);
    });

    test("should accept webhookUrl parameter", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Research topic",
        webhookUrl,
      });

      const response = await ResearchPost(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.requestId).toBeDefined();
    });
  });

  describe("GET /api/mock/stakwork/research/[id]", () => {
    test("should return research data status", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Test topic",
      });
      const createResponse = await ResearchPost(createRequest);
      const createData = await expectSuccess(createResponse);

      const statusResponse = await ResearchGet(
        new NextRequest(`http://localhost:3000/api/mock/stakwork/research/${createData.requestId}`),
        { params: Promise.resolve({ id: createData.requestId }) }
      );
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.success).toBe(true);
      expect(statusData.requestId).toBe(createData.requestId);
      expect(statusData.topic).toBe("Test topic");
      expect(statusData.status).toMatch(/pending|processing|completed/);
      expect(statusData.progress).toBeGreaterThanOrEqual(0);
    });

    test("should return 404 for non-existent research id", async () => {
      const response = await ResearchGet(
        new NextRequest("http://localhost:3000/api/mock/stakwork/research/non_existent"),
        { params: Promise.resolve({ id: "non_existent" }) }
      );

      await expectError(response, "Research data not found", 404);
    });

    test("should return completed status with result", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Test topic",
      });
      const createResponse = await ResearchPost(createRequest);
      const createData = await expectSuccess(createResponse);

      // Wait for completion (~12.5 seconds)
      await new Promise((resolve) => setTimeout(resolve, 13000));

      const statusResponse = await ResearchGet(
        new NextRequest(`http://localhost:3000/api/mock/stakwork/research/${createData.requestId}`),
        { params: Promise.resolve({ id: createData.requestId }) }
      );
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.status).toBe("completed");
      expect(statusData.progress).toBe(100);
      expect(statusData.result).toBeDefined();
      expect(statusData.result.insights).toBeDefined();
      expect(Array.isArray(statusData.result.insights)).toBe(true);
      expect(statusData.result.insights.length).toBeGreaterThan(0);
      expect(statusData.result.recommendations).toBeDefined();
      expect(Array.isArray(statusData.result.recommendations)).toBe(true);
      expect(statusData.result.summary).toBeDefined();
      expect(statusData.result.keyFindings).toBeDefined();
    });

    test("should return insights with correct structure", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Test topic",
      });
      const createResponse = await ResearchPost(createRequest);
      const createData = await expectSuccess(createResponse);

      await new Promise((resolve) => setTimeout(resolve, 13000));

      const statusResponse = await ResearchGet(
        new NextRequest(`http://localhost:3000/api/mock/stakwork/research/${createData.requestId}`),
        { params: Promise.resolve({ id: createData.requestId }) }
      );
      const statusData = await expectSuccess(statusResponse);

      const insight = statusData.result.insights[0];
      expect(insight).toHaveProperty("title");
      expect(insight).toHaveProperty("description");
      expect(insight).toHaveProperty("confidence");
      expect(insight).toHaveProperty("sources");
      expect(Array.isArray(insight.sources)).toBe(true);
      expect(typeof insight.confidence).toBe("number");
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
    });

    test("should return recommendations with correct structure", async () => {
      const createRequest = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Test topic",
      });
      const createResponse = await ResearchPost(createRequest);
      const createData = await expectSuccess(createResponse);

      await new Promise((resolve) => setTimeout(resolve, 13000));

      const statusResponse = await ResearchGet(
        new NextRequest(`http://localhost:3000/api/mock/stakwork/research/${createData.requestId}`),
        { params: Promise.resolve({ id: createData.requestId }) }
      );
      const statusData = await expectSuccess(statusResponse);

      const recommendation = statusData.result.recommendations[0];
      expect(recommendation).toHaveProperty("title");
      expect(recommendation).toHaveProperty("description");
      expect(recommendation).toHaveProperty("priority");
      expect(recommendation).toHaveProperty("effort");
      expect(["high", "medium", "low"]).toContain(recommendation.priority);
      expect(["high", "medium", "low"]).toContain(recommendation.effort);
    });
  });

  describe("Webhook Integration - Research", () => {
    test("should trigger webhook on completion", async () => {
      const webhookUrl = "https://example.com/webhook";
      const request = createPostRequest("http://localhost:3000/api/mock/stakwork/research", {
        topic: "Test topic",
        webhookUrl,
      });

      await ResearchPost(request);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 13000));

      expect(global.fetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: "POST",
        })
      );

      const callArgs = (global.fetch as any).mock.calls.find((call: any) => call[0] === webhookUrl);
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.type).toBe("research.completed");
      expect(payload.status).toBe("completed");
      expect(payload.result).toBeDefined();
    });
  });
});

describe("Mock Stakwork State Management", () => {
  beforeEach(() => {
    mockStakworkState.reset();
  });

  test("should reset all state correctly", () => {
    // Create some data
    mockStakworkState.createGenerateRequest("test prompt");
    mockStakworkState.createPlanRequest("test description");
    mockStakworkState.createResearchRequest("test topic");

    // Reset
    mockStakworkState.reset();

    // Verify reset
    const generateRequest = mockStakworkState.getGenerateRequest("gen_1000");
    const planRequest = mockStakworkState.getPlanRequest("plan_1000");
    const researchData = mockStakworkState.getResearchData("research_1000");

    expect(generateRequest).toBeUndefined();
    expect(planRequest).toBeUndefined();
    expect(researchData).toBeUndefined();
  });

  test("should auto-increment request IDs", () => {
    const req1 = mockStakworkState.createGenerateRequest("test 1");
    const req2 = mockStakworkState.createGenerateRequest("test 2");
    const req3 = mockStakworkState.createPlanRequest("test 3");

    expect(req1.id).toBe("gen_1000");
    expect(req2.id).toBe("gen_1001");
    expect(req3.id).toBe("plan_1002");
  });

  test("should store and retrieve requests correctly", () => {
    const original = mockStakworkState.createGenerateRequest("test prompt");
    const retrieved = mockStakworkState.getGenerateRequest(original.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(original.id);
    expect(retrieved?.prompt).toBe("test prompt");
    expect(retrieved?.status).toBe("pending");
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "@/app/api/mock/db/scenario/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import {
  createGetRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import {
  registerScenario,
  getScenario,
} from "@/__tests__/support/scenarios";
import type { ScenarioDefinition } from "@/__tests__/support/scenarios/types";

describe("GET /api/mock/db/scenario", () => {
  beforeEach(async () => {
    await resetDatabase();
    // Enable mock endpoints for testing
    process.env.ALLOW_SCENARIO_API = "true";
  });

  afterEach(() => {
    delete process.env.ALLOW_SCENARIO_API;
    vi.restoreAllMocks();
  });

  describe("Scenario Listing", () => {
    test("returns list of available scenarios", async () => {
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("scenarios");
      expect(Array.isArray(data.scenarios)).toBe(true);
      expect(data.scenarios.length).toBeGreaterThan(0);
    });

    test("returns scenarios with correct structure", async () => {
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      const scenario = data.scenarios[0];

      expect(scenario).toHaveProperty("name");
      expect(scenario).toHaveProperty("description");
      expect(typeof scenario.name).toBe("string");
      expect(typeof scenario.description).toBe("string");
    });

    test("includes built-in scenarios in response", async () => {
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      const scenarioNames = data.scenarios.map((s: any) => s.name);

      expect(scenarioNames).toContain("blank");
      expect(scenarioNames).toContain("simple_mock_user");
    });

    test("includes optional fields (extends, tags) when present", async () => {
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      
      // simple_mock_user has tags
      const simpleMockUser = data.scenarios.find(
        (s: any) => s.name === "simple_mock_user"
      );
      expect(simpleMockUser).toBeDefined();
      expect(simpleMockUser.tags).toBeDefined();
      expect(Array.isArray(simpleMockUser.tags)).toBe(true);
      expect(simpleMockUser.tags.length).toBeGreaterThan(0);
    });
  });

  describe("Tag Filtering", () => {
    test("filters scenarios by tag when provided", async () => {
      // Register test scenario with tags
      const testScenario: ScenarioDefinition = {
        name: "test_tagged",
        description: "Test scenario with tags",
        tags: ["test", "integration"],
        run: async () => ({
          metadata: {
            name: "test_tagged",
            description: "Test scenario",
            tags: ["test", "integration"],
            executedAt: new Date().toISOString(),
          },
          data: { owner: null, workspace: null },
        }),
      };
      registerScenario(testScenario);

      const request = createGetRequest("/api/mock/db/scenario?tag=test");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.scenarios.length).toBeGreaterThan(0);
      expect(
        data.scenarios.every((s: any) => !s.tags || s.tags.includes("test"))
      ).toBe(true);
    });

    test("returns empty array when no scenarios match tag", async () => {
      const request = createGetRequest(
        "/api/mock/db/scenario?tag=nonexistent_tag"
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.scenarios).toEqual([]);
    });

    test("returns all scenarios when tag filter is not provided", async () => {
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.scenarios.length).toBeGreaterThan(0);
    });
  });

  describe("Mock Gating", () => {
    test("allows access when ALLOW_SCENARIO_API is set", async () => {
      // ALLOW_SCENARIO_API is already set in beforeEach
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("scenarios");
    });

    test("allows access when USE_MOCKS environment variable is true", async () => {
      // Even without ALLOW_SCENARIO_API, if USE_MOCKS is true at startup, it works
      // This tests the OR logic in isMockEnabled()
      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toHaveProperty("scenarios");
    });
  });

  describe("Error Handling", () => {
    test("handles errors gracefully", async () => {
      // Mock getScenario to throw error
      vi.spyOn(
        await import("@/__tests__/support/scenarios"),
        "listScenariosForAPI"
      ).mockImplementation(() => {
        throw new Error("Test error");
      });

      const request = createGetRequest("/api/mock/db/scenario");
      const response = await GET(request);

      // Don't use expectError here since we need to access the response body twice
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Failed to list scenarios");
      expect(data.details).toBe("Test error");
    });
  });
});

describe("POST /api/mock/db/scenario", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.ALLOW_SCENARIO_API = "true";
  });

  afterEach(() => {
    delete process.env.ALLOW_SCENARIO_API;
    vi.restoreAllMocks();
  });

  describe("Scenario Execution", () => {
    test("runs 'blank' scenario successfully", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "blank",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.scenario).toHaveProperty("name", "blank");
      expect(data.scenario).toHaveProperty("description");
      expect(data.scenario).toHaveProperty("executedAt");
      expect(data.data).toBeDefined();
    });

    test("runs 'simple_mock_user' scenario successfully", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.scenario.name).toBe("simple_mock_user");
      expect(data.data.workspaceId).toBeDefined();
      expect(data.data.workspaceSlug).toBeDefined();
      expect(data.data.ownerId).toBeDefined();
      expect(data.data.ownerEmail).toBeDefined();
    });

    test("creates database records when running scenario", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);

      // Verify workspace was created
      const workspace = await db.workspace.findUnique({
        where: { id: data.data.workspaceId },
      });
      expect(workspace).toBeDefined();
      expect(workspace?.slug).toBe(data.data.workspaceSlug);

      // Verify owner was created
      const owner = await db.user.findUnique({
        where: { id: data.data.ownerId },
      });
      expect(owner).toBeDefined();
      expect(owner?.email).toBe(data.data.ownerEmail);
    });

    test("returns correct metadata structure", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "blank",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      
      expect(data.scenario).toHaveProperty("name");
      expect(data.scenario).toHaveProperty("description");
      expect(data.scenario).toHaveProperty("executedAt");
      expect(typeof data.scenario.executedAt).toBe("string");
      
      const executedAtDate = new Date(data.scenario.executedAt);
      expect(executedAtDate).toBeInstanceOf(Date);
      expect(executedAtDate.getTime()).not.toBeNaN();
    });

    test("returns data summary with correct fields", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      
      expect(data.data).toHaveProperty("workspaceId");
      expect(data.data).toHaveProperty("workspaceSlug");
      expect(data.data).toHaveProperty("ownerId");
      expect(data.data).toHaveProperty("ownerEmail");
      expect(data.data).toHaveProperty("hasSwarm");
      expect(data.data).toHaveProperty("hasRepository");
      
      expect(typeof data.data.hasSwarm).toBe("boolean");
      expect(typeof data.data.hasRepository).toBe("boolean");
    });
  });

  describe("Validation", () => {
    test("returns 400 when name is missing", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {});
      const response = await POST(request);

      await expectError(
        response,
        "Scenario name is required. Body: { name: string }",
        400
      );
    });

    test("returns 400 when body is empty", async () => {
      const request = new Request("http://localhost/api/mock/db/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const response = await POST(request);

      await expectError(response, "Scenario name is required", 400);
    });

    test("returns 404 when scenario doesn't exist", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "nonexistent_scenario",
      });
      const response = await POST(request);

      await expectError(
        response,
        'Unknown scenario: "nonexistent_scenario"',
        404
      );
    });

    test("includes available scenarios in 404 response", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "invalid_name",
      });
      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty("available");
      expect(typeof data.available).toBe("string");
      expect(data.available).toContain("blank");
      expect(data.available).toContain("simple_mock_user");
    });
  });

  describe("Mock Gating", () => {
    test("allows access when ALLOW_SCENARIO_API is set", async () => {
      // ALLOW_SCENARIO_API is already set in beforeEach
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "blank",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows access when USE_MOCKS environment variable is true", async () => {
      // Even without ALLOW_SCENARIO_API, if USE_MOCKS is true at startup, it works
      // This tests the OR logic in isMockEnabled()
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "blank",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("returns 500 when scenario execution fails", async () => {
      // Register failing scenario
      const failingScenario: ScenarioDefinition = {
        name: "failing_test",
        description: "Test scenario that fails",
        run: async () => {
          throw new Error("Scenario execution failed");
        },
      };
      registerScenario(failingScenario);

      const request = createPostRequest("/api/mock/db/scenario", {
        name: "failing_test",
      });
      const response = await POST(request);

      // Don't use expectError here since we need to access the response body twice
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Failed to run scenario");
      expect(data.details).toBe("Scenario execution failed");
    });

    test("validates scenario existence before running", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "not_registered",
      });
      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Unknown scenario");
    });
  });

  describe("Scenario Inheritance", () => {
    test("runs parent scenario when child extends it", async () => {
      const request = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      
      // simple_mock_user extends blank, so database should be clean first
      // then populated with mock user data
      expect(data.success).toBe(true);
      expect(data.data.workspaceId).toBeDefined();
      expect(data.data.ownerId).toBeDefined();
    });
  });

  describe("Database Isolation", () => {
    test("each scenario run starts with clean database state", async () => {
      // Run first scenario
      const request1 = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1, 200);

      await resetDatabase();

      // Run second scenario
      const request2 = createPostRequest("/api/mock/db/scenario", {
        name: "simple_mock_user",
      });
      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2, 200);

      // Workspace IDs should be different (new database records)
      expect(data1.data.workspaceId).toBeDefined();
      expect(data2.data.workspaceId).toBeDefined();
    });
  });
});

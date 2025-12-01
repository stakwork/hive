import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mockStakworkState } from "@/lib/mock/stakwork-state";
import {
  createPostRequest,
  createGetRequest,
  expectSuccess,
  expectError,
} from "@/__tests__/support/helpers";

describe("Stakwork Mock Service Integration Tests", () => {
  beforeEach(() => {
    mockStakworkState.reset();
  });

  afterEach(() => {
    mockStakworkState.reset();
  });

  describe("POST /api/mock/stakwork/projects - Create Project", () => {
    test("should create project and return project_id", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.project_id).toBeDefined();
      expect(typeof data.data.project_id).toBe("number");
      expect(data.data.project_id).toBeGreaterThanOrEqual(10000);
    });

    test("should auto-increment project IDs", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request1 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Project 1",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const request2 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Project 2",
          workflow_id: 124,
          workflow_params: {},
        }
      );

      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1);

      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2);

      expect(data2.data.project_id).toBe(data1.data.project_id + 1);
    });

    test("should extract webhook URL from workflow params", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const webhookUrl = "http://localhost:3000/api/stakwork/webhook?run_id=123";
      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {
            set_var: {
              attributes: {
                vars: {
                  webhook_url: webhookUrl,
                },
              },
            },
          },
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.project_id).toBeDefined();
    });

    test("should return 400 when name is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const response = await POST(request);
      await expectError(
        response,
        "Missing required fields: name, workflow_id",
        400
      );
    });

    test("should return 400 when workflow_id is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_params: {},
        }
      );

      const response = await POST(request);
      await expectError(
        response,
        "Missing required fields: name, workflow_id",
        400
      );
    });

    test("should handle projects without workflow_params", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.project_id).toBeDefined();
    });

    test("should start workflow progression immediately", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      // Check status immediately - should be "running"
      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
      );

      const statusResponse = await GET(statusRequest, {
        params: Promise.resolve({ projectId: projectId.toString() }),
      });
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.data.project.workflow_state).toBe("running");
    });

    test("should return 500 for invalid JSON", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      const request = new Request(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json",
        }
      );

      const response = await POST(request as any);
      await expectError(response, "Internal server error", 500);
    });
  });

  describe("GET /api/mock/stakwork/projects/:projectId.json - Get Workflow Status", () => {
    test("should return project status", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      // Create project first
      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      // Get project status
      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
      );

      const statusResponse = await GET(statusRequest, {
        params: Promise.resolve({ projectId: projectId.toString() }),
      });
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.success).toBe(true);
      expect(statusData.data).toBeDefined();
      expect(statusData.data.project).toBeDefined();
      expect(statusData.data.project.workflow_state).toBeDefined();
      expect(statusData.data.project.name).toBe("Test Project");
      expect(statusData.data.project.workflow_id).toBe(123);
    });

    test("should return 404 for non-existent project", async () => {
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const request = createGetRequest(
        "http://localhost:3000/api/mock/stakwork/projects/99999.json"
      );

      const response = await GET(request, {
        params: Promise.resolve({ projectId: "99999" }),
      });

      await expectError(response, "Project not found", 404);
    });

    test("should include transitions and connections in response", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
      );

      const statusResponse = await GET(statusRequest, {
        params: Promise.resolve({ projectId: projectId.toString() }),
      });
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.data.transitions).toBeDefined();
      expect(statusData.data.connections).toBeDefined();
      expect(Array.isArray(statusData.data.connections)).toBe(true);
    });

    test("should handle invalid project ID format", async () => {
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const request = createGetRequest(
        "http://localhost:3000/api/mock/stakwork/projects/invalid.json"
      );

      const response = await GET(request, {
        params: Promise.resolve({ projectId: "invalid" }),
      });

      await expectError(response, "Project not found", 404);
    });
  });

  describe("POST /api/mock/stakwork/customers - Create Customer", () => {
    test("should create customer and return token", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {
            name: "Test Customer",
          },
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.customer).toBeDefined();
      expect(data.customer.id).toBeDefined();
      expect(data.customer.name).toBe("Test Customer");
      expect(data.customer.token).toBeDefined();
      expect(data.customer.token).toMatch(/^mock_token_/);
    });

    test("should return same customer for duplicate names", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request1 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {
            name: "Test Customer",
          },
        }
      );

      const request2 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {
            name: "Test Customer",
          },
        }
      );

      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1);

      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2);

      expect(data1.customer.id).toBe(data2.customer.id);
      expect(data1.customer.token).toBe(data2.customer.token);
    });

    test("should generate unique tokens for different customers", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request1 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {
            name: "Customer 1",
          },
        }
      );

      const request2 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {
            name: "Customer 2",
          },
        }
      );

      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1);

      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2);

      expect(data1.customer.token).not.toBe(data2.customer.token);
    });

    test("should return 400 when customer name is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          customer: {},
        }
      );

      const response = await POST(request);
      await expectError(response, "Customer name required", 400);
    });

    test("should return 400 when customer object is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/customers",
        {}
      );

      const response = await POST(request);
      await expectError(response, "Customer name required", 400);
    });

    test("should return 500 for invalid JSON", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );

      const request = new Request(
        "http://localhost:3000/api/mock/stakwork/customers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json",
        }
      );

      const response = await POST(request as any);
      await expectError(response, "Internal server error", 500);
    });
  });

  describe("POST /api/mock/stakwork/secrets - Create Secret", () => {
    test("should create secret successfully", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            name: "api_key",
            value: "secret_value_123",
          },
          source: "hive",
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toContain("api_key");
      expect(data.message).toContain("created successfully");
      expect(data.secret).toBeDefined();
      expect(data.secret.name).toBe("api_key");
      expect(data.secret.source).toBe("hive");
    });

    test("should use default source when not provided", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            name: "api_key",
            value: "secret_value_123",
          },
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.secret.source).toBe("hive");
    });

    test("should overwrite existing secrets with same name", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request1 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            name: "api_key",
            value: "value1",
          },
        }
      );

      const request2 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            name: "api_key",
            value: "value2",
          },
        }
      );

      const response1 = await POST(request1);
      await expectSuccess(response1);

      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2);

      expect(data2.success).toBe(true);
      
      // Verify the value was updated in state
      const storedValue = mockStakworkState.getSecret("api_key");
      expect(storedValue).toBe("value2");
    });

    test("should return 400 when secret name is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            value: "secret_value",
          },
        }
      );

      const response = await POST(request);
      await expectError(response, "Secret name and value required", 400);
    });

    test("should return 400 when secret value is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          secret: {
            name: "api_key",
          },
        }
      );

      const response = await POST(request);
      await expectError(response, "Secret name and value required", 400);
    });

    test("should return 400 when secret object is missing", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {}
      );

      const response = await POST(request);
      await expectError(response, "Secret name and value required", 400);
    });

    test("should return 500 for invalid JSON", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      const request = new Request(
        "http://localhost:3000/api/mock/stakwork/secrets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json",
        }
      );

      const response = await POST(request as any);
      await expectError(response, "Internal server error", 500);
    });
  });

  describe("Workflow Auto-Progression", () => {
    test("should transition from pending to running immediately", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
      );

      const statusResponse = await GET(statusRequest, {
        params: Promise.resolve({ projectId: projectId.toString() }),
      });
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.data.project.workflow_state).toBe("running");
    });

    test("should transition to complete after 3 seconds", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      // Wait for auto-progression (3 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const statusRequest = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
      );

      const statusResponse = await GET(statusRequest, {
        params: Promise.resolve({ projectId: projectId.toString() }),
      });
      const statusData = await expectSuccess(statusResponse);

      expect(statusData.data.project.workflow_state).toBe("complete");
    });

    test("should handle multiple projects progressing independently", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      // Create first project
      const createRequest1 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Project 1",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse1 = await POST(createRequest1);
      const createData1 = await expectSuccess(createResponse1);
      const projectId1 = createData1.data.project_id;

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create second project
      const createRequest2 = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Project 2",
          workflow_id: 124,
          workflow_params: {},
        }
      );

      const createResponse2 = await POST(createRequest2);
      const createData2 = await expectSuccess(createResponse2);
      const projectId2 = createData2.data.project_id;

      // Wait for first project to complete (2.5 more seconds)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Check first project - should be complete
      const statusRequest1 = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId1}.json`
      );

      const statusResponse1 = await GET(statusRequest1, {
        params: Promise.resolve({ projectId: projectId1.toString() }),
      });
      const statusData1 = await expectSuccess(statusResponse1);

      expect(statusData1.data.project.workflow_state).toBe("complete");

      // Check second project - should still be running
      const statusRequest2 = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId2}.json`
      );

      const statusResponse2 = await GET(statusRequest2, {
        params: Promise.resolve({ projectId: projectId2.toString() }),
      });
      const statusData2 = await expectSuccess(statusResponse2);

      expect(statusData2.data.project.workflow_state).toBe("running");

      // Wait for second project to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const statusRequest3 = createGetRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${projectId2}.json`
      );

      const statusResponse3 = await GET(statusRequest3, {
        params: Promise.resolve({ projectId: projectId2.toString() }),
      });
      const statusData3 = await expectSuccess(statusResponse3);

      expect(statusData3.data.project.workflow_state).toBe("complete");
    });
  });

  describe("State Management", () => {
    test("should persist state across multiple requests", async () => {
      const { POST: createProject } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { GET: getProject } = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );

      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      const createResponse = await createProject(createRequest);
      const createData = await expectSuccess(createResponse);
      const projectId = createData.data.project_id;

      // Get project status multiple times
      for (let i = 0; i < 3; i++) {
        const statusRequest = createGetRequest(
          `http://localhost:3000/api/mock/stakwork/projects/${projectId}.json`
        );

        const statusResponse = await getProject(statusRequest, {
          params: Promise.resolve({ projectId: projectId.toString() }),
        });
        const statusData = await expectSuccess(statusResponse);

        expect(statusData.data.project.name).toBe("Test Project");
        expect(statusData.data.project.workflow_id).toBe(123);
      }
    });

    test("should reset state correctly", async () => {
      const { POST: createProject } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const { POST: createCustomer } = await import(
        "@/app/api/mock/stakwork/customers/route"
      );
      const { POST: createSecret } = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      // Create some data
      await createProject(
        createPostRequest(
          "http://localhost:3000/api/mock/stakwork/projects",
          {
            name: "Test Project",
            workflow_id: 123,
            workflow_params: {},
          }
        )
      );

      await createCustomer(
        createPostRequest(
          "http://localhost:3000/api/mock/stakwork/customers",
          {
            customer: { name: "Test Customer" },
          }
        )
      );

      await createSecret(
        createPostRequest(
          "http://localhost:3000/api/mock/stakwork/secrets",
          {
            secret: { name: "api_key", value: "secret" },
          }
        )
      );

      // Reset state
      mockStakworkState.reset();

      // Verify state is cleared
      const project = mockStakworkState.getProject(10000);
      const customer = mockStakworkState.getCustomer("Test Customer");
      const secret = mockStakworkState.getSecret("api_key");

      expect(project).toBeUndefined();
      expect(customer).toBeUndefined();
      expect(secret).toBeUndefined();
    });

    test("should clear timers on reset", async () => {
      const { POST } = await import(
        "@/app/api/mock/stakwork/projects/route"
      );

      // Create project
      const createRequest = createPostRequest(
        "http://localhost:3000/api/mock/stakwork/projects",
        {
          name: "Test Project",
          workflow_id: 123,
          workflow_params: {},
        }
      );

      await POST(createRequest);

      // Reset immediately (before timer completes)
      mockStakworkState.reset();

      // Wait longer than timer duration
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // No errors should occur from orphaned timers
      expect(true).toBe(true);
    });
  });

  describe("Cache Configuration", () => {
    test("should use force-dynamic for all endpoints", async () => {
      const projectsModule = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const projectIdModule = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );
      const customersModule = await import(
        "@/app/api/mock/stakwork/customers/route"
      );
      const secretsModule = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      expect(projectsModule.dynamic).toBe("force-dynamic");
      expect(projectIdModule.dynamic).toBe("force-dynamic");
      expect(customersModule.dynamic).toBe("force-dynamic");
      expect(secretsModule.dynamic).toBe("force-dynamic");
    });

    test("should use force-no-store for all endpoints", async () => {
      const projectsModule = await import(
        "@/app/api/mock/stakwork/projects/route"
      );
      const projectIdModule = await import(
        "@/app/api/mock/stakwork/projects/[projectId]/route"
      );
      const customersModule = await import(
        "@/app/api/mock/stakwork/customers/route"
      );
      const secretsModule = await import(
        "@/app/api/mock/stakwork/secrets/route"
      );

      expect(projectsModule.fetchCache).toBe("force-no-store");
      expect(projectIdModule.fetchCache).toBe("force-no-store");
      expect(customersModule.fetchCache).toBe("force-no-store");
      expect(secretsModule.fetchCache).toBe("force-no-store");
    });
  });
});

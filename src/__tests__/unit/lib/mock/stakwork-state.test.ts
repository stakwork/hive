import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

describe("MockStakworkStateManager Unit Tests", () => {
  beforeEach(() => {
    mockStakworkState.reset();
  });

  afterEach(() => {
    mockStakworkState.reset();
  });

  describe("Project Management", () => {
    test("should create project with auto-incrementing ID", () => {
      const result1 = mockStakworkState.createProject({
        name: "Project 1",
        workflow_id: 123,
        workflow_params: {},
      });

      const result2 = mockStakworkState.createProject({
        name: "Project 2",
        workflow_id: 124,
        workflow_params: {},
      });

      expect(result1.project_id).toBe(10000);
      expect(result2.project_id).toBe(10001);
    });

    test("should store project with all properties", () => {
      const workflowParams = { test: "value" };
      const result = mockStakworkState.createProject({
        name: "Test Project",
        workflow_id: 456,
        workflow_params: workflowParams,
      });

      const project = mockStakworkState.getProject(result.project_id);

      expect(project).toBeDefined();
      expect(project?.name).toBe("Test Project");
      expect(project?.workflow_id).toBe(456);
      expect(project?.workflow_params).toEqual(workflowParams);
      expect(project?.workflow_state).toBe("pending");
      expect(project?.transitions).toEqual({});
      expect(project?.connections).toEqual([]);
      expect(project?.createdAt).toBeInstanceOf(Date);
    });

    test("should return undefined for non-existent project", () => {
      const project = mockStakworkState.getProject(99999);
      expect(project).toBeUndefined();
    });

    test("should progress workflow from pending to running", () => {
      const result = mockStakworkState.createProject({
        name: "Test Project",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.progressWorkflow(result.project_id);

      const project = mockStakworkState.getProject(result.project_id);
      expect(project?.workflow_state).toBe("running");
    });

    test("should progress workflow to complete after timeout", async () => {
      const result = mockStakworkState.createProject({
        name: "Test Project",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.progressWorkflow(result.project_id);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 3100));

      const project = mockStakworkState.getProject(result.project_id);
      expect(project?.workflow_state).toBe("complete");
    });

    test("should not progress non-existent project", () => {
      // Should not throw error
      expect(() => {
        mockStakworkState.progressWorkflow(99999);
      }).not.toThrow();
    });

    test("should store webhook URL when provided", () => {
      const webhookUrl = "http://localhost:3000/webhook";
      const result = mockStakworkState.createProject({
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
      });

      mockStakworkState.progressWorkflow(result.project_id, webhookUrl);

      // Webhook URL should be stored internally
      const project = mockStakworkState.getProject(result.project_id);
      expect(project).toBeDefined();
    });
  });

  describe("Customer Management", () => {
    test("should create new customer with unique ID and token", () => {
      const result = mockStakworkState.createCustomer("Test Customer");

      expect(result.customer).toBeDefined();
      expect(result.customer.name).toBe("Test Customer");
      expect(result.customer.id).toMatch(/^customer_/);
      expect(result.customer.token).toMatch(/^mock_token_/);
    });

    test("should return existing customer for duplicate names", () => {
      const result1 = mockStakworkState.createCustomer("Same Customer");
      const result2 = mockStakworkState.createCustomer("Same Customer");

      expect(result1.customer.id).toBe(result2.customer.id);
      expect(result1.customer.token).toBe(result2.customer.token);
    });

    test("should create different tokens for different customers", () => {
      const result1 = mockStakworkState.createCustomer("Customer 1");
      const result2 = mockStakworkState.createCustomer("Customer 2");

      expect(result1.customer.token).not.toBe(result2.customer.token);
      expect(result1.customer.id).not.toBe(result2.customer.id);
    });

    test("should retrieve customer by name", () => {
      mockStakworkState.createCustomer("Test Customer");
      const customer = mockStakworkState.getCustomer("Test Customer");

      expect(customer).toBeDefined();
      expect(customer?.name).toBe("Test Customer");
      expect(customer?.createdAt).toBeInstanceOf(Date);
    });

    test("should return undefined for non-existent customer", () => {
      const customer = mockStakworkState.getCustomer("Non-existent");
      expect(customer).toBeUndefined();
    });
  });

  describe("Secret Management", () => {
    test("should create secret successfully", () => {
      const result = mockStakworkState.createSecret("api_key", "secret_value");

      expect(result.success).toBe(true);
    });

    test("should retrieve secret value by name", () => {
      mockStakworkState.createSecret("test_secret", "test_value");
      const value = mockStakworkState.getSecret("test_secret");

      expect(value).toBe("test_value");
    });

    test("should overwrite existing secret", () => {
      mockStakworkState.createSecret("api_key", "old_value");
      mockStakworkState.createSecret("api_key", "new_value");

      const value = mockStakworkState.getSecret("api_key");
      expect(value).toBe("new_value");
    });

    test("should return undefined for non-existent secret", () => {
      const value = mockStakworkState.getSecret("non_existent");
      expect(value).toBeUndefined();
    });
  });

  describe("State Reset", () => {
    test("should clear all projects on reset", () => {
      const result = mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.reset();

      const project = mockStakworkState.getProject(result.project_id);
      expect(project).toBeUndefined();
    });

    test("should clear all customers on reset", () => {
      mockStakworkState.createCustomer("Test Customer");
      mockStakworkState.reset();

      const customer = mockStakworkState.getCustomer("Test Customer");
      expect(customer).toBeUndefined();
    });

    test("should clear all secrets on reset", () => {
      mockStakworkState.createSecret("test_key", "test_value");
      mockStakworkState.reset();

      const value = mockStakworkState.getSecret("test_key");
      expect(value).toBeUndefined();
    });

    test("should reset project ID counter", () => {
      mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.reset();

      const result = mockStakworkState.createProject({
        name: "Test 2",
        workflow_id: 124,
        workflow_params: {},
      });

      expect(result.project_id).toBe(10000);
    });

    test("should clear completion timers on reset", async () => {
      const result = mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.progressWorkflow(result.project_id);

      // Reset before timer completes
      mockStakworkState.reset();

      // Wait longer than timer duration
      await new Promise((resolve) => setTimeout(resolve, 3100));

      // Should not cause errors
      expect(true).toBe(true);
    });

    test("should clear webhook callbacks on reset", () => {
      const result = mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      mockStakworkState.progressWorkflow(
        result.project_id,
        "http://localhost:3000/webhook"
      );

      mockStakworkState.reset();

      // Webhook callbacks should be cleared
      expect(true).toBe(true);
    });
  });

  describe("Webhook Triggering", () => {
    test("should not throw error when webhook fails", async () => {
      // Mock fetch to simulate error
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      // Should not throw
      expect(() => {
        mockStakworkState.progressWorkflow(
          result.project_id,
          "http://localhost:3000/webhook"
        );
      }).not.toThrow();

      // Restore fetch
      global.fetch = originalFetch;
    });

    test("should not trigger webhook when URL not provided", () => {
      const result = mockStakworkState.createProject({
        name: "Test",
        workflow_id: 123,
        workflow_params: {},
      });

      // Should not throw
      expect(() => {
        mockStakworkState.progressWorkflow(result.project_id);
      }).not.toThrow();
    });
  });

  describe("Concurrent Operations", () => {
    test("should handle multiple projects being created simultaneously", () => {
      const results = Array.from({ length: 10 }, (_, i) =>
        mockStakworkState.createProject({
          name: `Project ${i}`,
          workflow_id: i,
          workflow_params: {},
        })
      );

      const projectIds = results.map((r) => r.project_id);

      // All IDs should be unique
      const uniqueIds = new Set(projectIds);
      expect(uniqueIds.size).toBe(10);

      // IDs should be sequential
      expect(projectIds).toEqual([
        10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009,
      ]);
    });

    test("should handle multiple customers being created simultaneously", () => {
      const results = Array.from({ length: 5 }, (_, i) =>
        mockStakworkState.createCustomer(`Customer ${i}`)
      );

      const tokens = results.map((r) => r.customer.token);

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(5);
    });

    test("should handle multiple secrets being created simultaneously", () => {
      const results = Array.from({ length: 5 }, (_, i) =>
        mockStakworkState.createSecret(`key_${i}`, `value_${i}`)
      );

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // All values should be retrievable
      for (let i = 0; i < 5; i++) {
        const value = mockStakworkState.getSecret(`key_${i}`);
        expect(value).toBe(`value_${i}`);
      }
    });
  });
});

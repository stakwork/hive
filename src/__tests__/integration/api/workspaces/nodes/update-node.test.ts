import { describe, test, expect, beforeEach, vi } from "vitest";
import { PUT } from "@/app/api/workspaces/[slug]/nodes/[nodeId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPutRequest,
  createPutRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  expectSuccess,
  expectForbidden,
  expectNotFound,
  expectUnauthorized,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import {
  expectMemberRole,
  expectWorkspaceExists,
} from "@/__tests__/support/helpers/database-assertions";
import * as nodesService from "@/services/swarm/api/nodes";

// Mock the Jarvis nodes service
vi.mock("@/services/swarm/api/nodes");

describe("Node Update API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PUT /api/workspaces/[slug]/nodes/[nodeId]", () => {
    describe("Success Cases", () => {
      test("allows workspace OWNER to update node", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-123";
        const updateData = {
          properties: {
            name: "Updated Node",
            description: "Updated description",
          },
        };

        // Mock Jarvis API success response
        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);

        // Verify workspace access was checked
        await expectWorkspaceExists(workspace.id);
        await expectMemberRole(workspace.id, owner.id, "OWNER");

        // Verify Jarvis service was called
        expect(nodesService.updateNode).toHaveBeenCalledWith(
          expect.objectContaining({
            jarvisUrl: expect.any(String),
            apiKey: expect.any(String),
          }),
          expect.objectContaining({
            ref_id: nodeId,
            properties: updateData.properties,
          })
        );
      });

      test("allows workspace ADMIN to update node", async () => {
        const owner = await createTestUser();
        const admin = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: admin.id,
          role: "ADMIN",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-456";
        const updateData = {
          properties: {
            status: "active",
            metadata: { version: "2.0" },
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          admin,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);

        await expectMemberRole(workspace.id, admin.id, "ADMIN");
        expect(nodesService.updateNode).toHaveBeenCalled();
      });

      test("handles complex nested properties", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-789";
        const updateData = {
          properties: {
            name: "Complete Node",
            type: "service",
            config: {
              port: 8080,
              host: "localhost",
            },
            tags: ["api", "backend"],
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        const data = await expectSuccess(response, 200);
        expect(data.success).toBe(true);
      });
    });

    describe("Authorization Failures", () => {
      test("allows DEVELOPER role to update nodes (no role restriction)", async () => {
        const owner = await createTestUser();
        const developer = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: developer.id,
          role: "DEVELOPER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-dev-123";
        const updateData = {
          properties: { name: "Developer Update" },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          developer,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
        expect(nodesService.updateNode).toHaveBeenCalled();
      });

      test("allows VIEWER role to update nodes (no role restriction)", async () => {
        const owner = await createTestUser();
        const viewer = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: viewer.id,
          role: "VIEWER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-viewer-123";
        const updateData = {
          properties: { name: "Viewer Update" },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          viewer,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
        expect(nodesService.updateNode).toHaveBeenCalled();
      });

      test("allows PM role to update nodes (no role restriction)", async () => {
        const owner = await createTestUser();
        const pm = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: pm.id,
          role: "PM",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-pm-123";
        const updateData = {
          properties: { name: "PM Update" },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          pm,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
        expect(nodesService.updateNode).toHaveBeenCalled();
      });

      test("rejects non-member from updating nodes", async () => {
        const owner = await createTestUser();
        const nonMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-non-member-123";
        const updateData = {
          properties: { name: "Unauthorized Update" },
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          nonMember,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectForbidden(response, "Access denied");
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("returns 404 for non-existent workspace", async () => {
        const user = await createTestUser();
        const nodeId = "node-404";
        const updateData = {
          properties: { name: "Update" },
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/non-existent-workspace/nodes/${nodeId}`,
          user,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({
            slug: "non-existent-workspace",
            nodeId,
          }),
        });

        await expectNotFound(response, "Workspace not found");
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("returns 404 for soft-deleted workspace", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });

        // Soft-delete the workspace
        await db.workspace.update({
          where: { id: workspace.id },
          data: { deleted: true, deletedAt: new Date() },
        });

        const nodeId = "node-deleted-ws";
        const updateData = {
          properties: { name: "Update" },
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectNotFound(response, "Workspace not found");
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("rejects member who has left the workspace", async () => {
        const owner = await createTestUser();
        const formerMember = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: formerMember.id,
          role: "ADMIN",
          leftAt: new Date(),
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-left-member";
        const updateData = {
          properties: { name: "Update" },
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          formerMember,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectForbidden(response, "Access denied");
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("rejects unauthenticated requests", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        const nodeId = "node-unauth";
        const updateData = {
          properties: { name: "Update" },
        };

        const request = createPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectUnauthorized(response);
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });
    });

    describe("Validation Failures", () => {
      test("rejects request with missing properties field", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-no-props";
        const updateData = {}; // Missing properties

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectError(response, "properties object is required", 400);
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("rejects request with properties field as non-object", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-invalid-props-type";
        const updateData = {
          properties: "invalid-string" as any, // Should be object
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectError(response, "properties object is required", 400);
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });

      test("allows array as properties (typeof array === 'object')", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-array-props";
        const updateData = {
          properties: ["item1", "item2"] as any, // Arrays pass typeof check
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        // Arrays pass the typeof check since typeof [] === "object"
        expect(response.status).toBe(200);
        expect(nodesService.updateNode).toHaveBeenCalled();
      });
    });

    describe("Swarm Configuration", () => {
      test("returns 400 when workspace has no swarm configuration", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        // No swarm created

        const nodeId = "node-no-swarm";
        const updateData = {
          properties: { name: "Update" },
        };

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        await expectError(response, "Swarm not configured", 400);
        expect(nodesService.updateNode).not.toHaveBeenCalled();
      });
    });

    describe("Service Failures", () => {
      test("handles Jarvis API error response", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-error";
        const updateData = {
          properties: { name: "Update" },
        };

        // Mock Jarvis API error - updateNode returns error via result object
        vi.mocked(nodesService.updateNode).mockResolvedValue({
          success: false,
          error: "Failed to update node",
        });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(502);
        const data = await response.json();
        expect(data.error).toContain("Failed to update node");
      });

      test("handles unexpected errors", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-exception";
        const updateData = {
          properties: { name: "Update" },
        };

        // Mock unexpected exception
        vi.mocked(nodesService.updateNode).mockRejectedValue(
          new Error("Unexpected error")
        );

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.error).toBe("Internal server error");
      });
    });

    describe("Edge Cases", () => {
      test("handles concurrent updates to same node", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-concurrent";
        const updateData1 = {
          properties: { name: "Update 1" },
        };
        const updateData2 = {
          properties: { name: "Update 2" },
        };

        vi.mocked(nodesService.updateNode)
          .mockResolvedValueOnce({ success: true })
          .mockResolvedValueOnce({ success: true });

        const request1 = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData1
        );
        const request2 = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData2
        );

        const [response1, response2] = await Promise.all([
          PUT(request1, {
            params: Promise.resolve({ slug: workspace.slug, nodeId }),
          }),
          PUT(request2, {
            params: Promise.resolve({ slug: workspace.slug, nodeId }),
          }),
        ]);

        expect(response1.status).toBe(200);
        expect(response2.status).toBe(200);
        expect(nodesService.updateNode).toHaveBeenCalledTimes(2);
      });

      test("handles very large property values", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-large-props";
        const largeString = "x".repeat(10000);
        const updateData = {
          properties: {
            name: "Large Node",
            config: largeString,
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
      });

      test("handles special characters in property names and values", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-special-chars";
        const updateData = {
          properties: {
            "property-with-dashes": "value",
            "property.with.dots": "value",
            "property:with:colons": "value",
            "property with spaces": "value",
            "property_with_underscores": "value",
            "special!@#$%^&*()chars": "value!@#$%^&*()",
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
      });

      test("handles null values in properties", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-null-values";
        const updateData = {
          properties: {
            name: "Node with nulls",
            optionalField: null,
            nestedObject: {
              field1: "value",
              field2: null,
            },
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
      });

      test("handles nested object properties", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const nodeId = "node-nested";
        const updateData = {
          properties: {
            name: "Nested Node",
            config: {
              level1: {
                level2: {
                  level3: {
                    value: "deeply nested",
                  },
                },
              },
            },
            array: [1, 2, { nested: "value" }],
          },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        const response = await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        expect(response.status).toBe(200);
      });

      test("preserves workspace state after node update", async () => {
        const owner = await createTestUser();
        const workspace = await createTestWorkspace({ ownerId: owner.id });
        await createTestMembership({
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        });
        await createTestSwarm({ workspaceId: workspace.id, swarmApiKey: "test-api-key" });

        const initialWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        const nodeId = "node-preserve-ws";
        const updateData = {
          properties: { name: "Update" },
        };

        vi.mocked(nodesService.updateNode).mockResolvedValue({ success: true });

        const request = createAuthenticatedPutRequest(
          `http://localhost:3000/api/workspaces/${workspace.slug}/nodes/${nodeId}`,
          owner,
          updateData
        );

        await PUT(request, {
          params: Promise.resolve({ slug: workspace.slug, nodeId }),
        });

        const updatedWorkspace = await db.workspace.findUnique({
          where: { id: workspace.id },
        });

        // Verify workspace state unchanged
        expect(updatedWorkspace?.name).toBe(initialWorkspace?.name);
        expect(updatedWorkspace?.slug).toBe(initialWorkspace?.slug);
        expect(updatedWorkspace?.description).toBe(initialWorkspace?.description);
        expect(updatedWorkspace?.deleted).toBe(initialWorkspace?.deleted);
      });
    });
  });
});

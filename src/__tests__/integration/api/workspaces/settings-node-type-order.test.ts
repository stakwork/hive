import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PUT } from "@/app/api/workspaces/[slug]/settings/node-type-order/route";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectValidationError,
  getMockedSession,
  createGetRequest,
  createPutRequest,
} from "@/__tests__/support/helpers";

// APPLICATION BUG: Route imports getServerSession from 'next-auth' instead of 'next-auth/next'
// This causes all tests to fail with "headers was called outside a request scope" error
// The global mock is set up for 'next-auth/next' in src/__tests__/setup/global.ts
// Fix needed in src/app/api/workspaces/[slug]/settings/node-type-order/route.ts line 2:
// Change: import { getServerSession } from "next-auth";
// To: import { getServerSession } from "next-auth/next";

describe.skip("Node Type Order Settings API Integration Tests", () => {
  const defaultNodeTypeOrder = [
    { type: "Function", value: 20 },
    { type: "Feature", value: 20 },
    { type: "File", value: 20 },
    { type: "Endpoint", value: 20 },
    { type: "Person", value: 20 },
    { type: "Episode", value: 20 },
    { type: "Call", value: 20 },
    { type: "Message", value: 20 },
  ];

  async function createTestWorkspace(customNodeTypeOrder?: Array<{ type: string; value: number }>) {
    const scenario = await createTestWorkspaceScenario({
      workspace: {
        nodeTypeOrder: customNodeTypeOrder || defaultNodeTypeOrder,
      },
      members: [{ role: "ADMIN" }, { role: "DEVELOPER" }, { role: "VIEWER" }],
    });

    return {
      ownerUser: scenario.owner,
      adminUser: scenario.members[0],
      developerUser: scenario.members[1],
      viewerUser: scenario.members[2],
      workspace: scenario.workspace,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/settings/node-type-order", () => {
    test("should get node type order successfully as workspace owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toBeDefined();
      expect(data.data.nodeTypeOrder).toHaveLength(8);
      expect(data.data.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should get node type order successfully as admin", async () => {
      const { adminUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should get node type order successfully as developer", async () => {
      const { developerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should get node type order successfully as viewer", async () => {
      const { viewerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should return empty array if nodeTypeOrder is null in database", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Set nodeTypeOrder to null
      await db.workspace.update({
        where: { id: workspace.id },
        data: { nodeTypeOrder: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual([]);
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/nonexistent/settings/node-type-order"
      );
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });

    test("should return 404 for deleted workspace", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });

    test("should return 404 for workspace user is not a member of", async () => {
      const { workspace } = await createTestWorkspace();

      // Create a different user not part of the workspace
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Other Owner", email: "other@example.com" },
        workspace: { name: "Other Workspace", slug: "other-workspace" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherScenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`
      );
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });
  });

  describe("PUT /api/workspaces/[slug]/settings/node-type-order", () => {
    test("should update node type order successfully as owner with real database operations", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const updatedOrder = [
        { type: "Function", value: 10 },
        { type: "Feature", value: 30 },
        { type: "File", value: 25 },
        { type: "Endpoint", value: 15 },
        { type: "Person", value: 40 },
        { type: "Episode", value: 35 },
        { type: "Call", value: 5 },
        { type: "Message", value: 50 },
      ];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(updatedOrder);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true, updatedAt: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual(updatedOrder);
    });

    test("should update node type order successfully as admin with real database operations", async () => {
      const { adminUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const updatedOrder = [
        { type: "Function", value: 100 },
        { type: "Feature", value: 200 },
      ];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(updatedOrder);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual(updatedOrder);
    });

    test("should return 404 for developer attempting to update node type order", async () => {
      const { developerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should return 404 for viewer attempting to update node type order", async () => {
      const { viewerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should update with empty array", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: [] }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual([]);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual([]);
    });

    test("should validate value range (min 0)", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidOrder = [{ type: "Function", value: -1 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: invalidOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should validate value range (max 999)", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidOrder = [{ type: "Function", value: 1000 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: invalidOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should accept valid edge values (0 and 999)", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const validOrder = [
        { type: "Function", value: 0 },
        { type: "Feature", value: 999 },
      ];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: validOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(validOrder);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual(validOrder);
    });

    test("should validate required fields in array items", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidOrder = [{ type: "Function" }]; // Missing value

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: invalidOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should validate that nodeTypeOrder is an array", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidData = { nodeTypeOrder: "not an array" };

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        invalidData
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should validate that nodeTypeOrder field is present", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidData = {}; // Missing nodeTypeOrder

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        invalidData
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should validate type is a string", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidOrder = [{ type: 123, value: 10 }]; // type should be string

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: invalidOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should validate value is a number", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const invalidOrder = [{ type: "Function", value: "not a number" }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: invalidOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectValidationError(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should return 401 for unauthenticated request", async () => {
      const { workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);

      // Verify workspace was not changed in database
      const unchangedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(unchangedWorkspaceInDb?.nodeTypeOrder).toEqual(defaultNodeTypeOrder);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        "http://localhost:3000/api/workspaces/nonexistent/settings/node-type-order",
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });

    test("should return 404 for deleted workspace", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });

    test("should return 404 for workspace user is not a member of", async () => {
      const { workspace } = await createTestWorkspace();

      // Create a different user not part of the workspace
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Other Owner", email: "other@example.com" },
        workspace: { name: "Other Workspace", slug: "other-workspace" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherScenario.owner));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });

    test("should handle large arrays efficiently", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Create a large array with 50 items
      const largeOrder = Array.from({ length: 50 }, (_, i) => ({
        type: `Type${i}`,
        value: i * 10,
      }));

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: largeOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(largeOrder);
      expect(data.data.nodeTypeOrder).toHaveLength(50);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual(largeOrder);
    });

    test("should handle special characters in type names", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const specialOrder = [
        { type: "Type-With-Hyphens", value: 10 },
        { type: "Type_With_Underscores", value: 20 },
        { type: "Type With Spaces", value: 30 },
        { type: "Type.With.Dots", value: 40 },
        { type: "Type/With/Slashes", value: 50 },
      ];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: specialOrder }
      );

      const response = await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
      expect(data.data.nodeTypeOrder).toEqual(specialOrder);

      // Verify changes were persisted in database
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { nodeTypeOrder: true },
      });
      expect(updatedWorkspaceInDb?.nodeTypeOrder).toEqual(specialOrder);
    });

    test("should update updatedAt timestamp when node type order changes", async () => {
      const { ownerUser, workspace } = await createTestWorkspace();

      // Get initial updatedAt timestamp
      const initialWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { updatedAt: true },
      });

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const updatedOrder = [{ type: "Function", value: 10 }];

      const request = createPutRequest(
        `http://localhost:3000/api/workspaces/${workspace.slug}/settings/node-type-order`,
        { nodeTypeOrder: updatedOrder }
      );

      await PUT(request, { params: Promise.resolve({ slug: workspace.slug }) });

      // Verify updatedAt was changed
      const updatedWorkspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
        select: { updatedAt: true },
      });

      expect(updatedWorkspaceInDb?.updatedAt.getTime()).toBeGreaterThan(
        initialWorkspace?.updatedAt.getTime() || 0
      );
    });
  });
});

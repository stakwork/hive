import { describe, test, expect, beforeEach, vi } from "vitest";
import { PATCH } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPatchRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers";

describe("PATCH /api/tickets/[ticketId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("requires authentication", async () => {
      const request = createPatchRequest("http://localhost:3000/api/tickets/test-id", { title: "Updated Title" });

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "test-id" }) });

      await expectUnauthorized(response);
    });
  });

  describe("runBuild Field", () => {
    test("updates runBuild to false", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runBuild: false },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runBuild: true, runTestSuite: true },
      });
      expect(updatedTask?.runBuild).toBe(false);
      expect(updatedTask?.runTestSuite).toBe(true); // Should remain unchanged
    });

    test("updates runBuild to true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: false,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runBuild: true },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runBuild: true },
      });
      expect(updatedTask?.runBuild).toBe(true);
    });

    test("does not update runBuild when not provided", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: false,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "Updated Title" },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database that runBuild remains unchanged
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runBuild: true, title: true },
      });
      expect(updatedTask?.runBuild).toBe(false);
      expect(updatedTask?.title).toBe("Updated Title");
    });
  });

  describe("runTestSuite Field", () => {
    test("updates runTestSuite to false", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runTestSuite: false },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runBuild: true, runTestSuite: true },
      });
      expect(updatedTask?.runTestSuite).toBe(false);
      expect(updatedTask?.runBuild).toBe(true); // Should remain unchanged
    });

    test("updates runTestSuite to true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: false,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runTestSuite: true },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runTestSuite: true },
      });
      expect(updatedTask?.runTestSuite).toBe(true);
    });

    test("does not update runTestSuite when not provided", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: false,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { title: "Updated Title" },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database that runTestSuite remains unchanged
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runTestSuite: true, title: true },
      });
      expect(updatedTask?.runTestSuite).toBe(false);
      expect(updatedTask?.title).toBe("Updated Title");
    });
  });

  describe("Combined Updates", () => {
    test("updates both runBuild and runTestSuite simultaneously", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runBuild: false, runTestSuite: false },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: { runBuild: true, runTestSuite: true },
      });
      expect(updatedTask?.runBuild).toBe(false);
      expect(updatedTask?.runTestSuite).toBe(false);
    });

    test("updates runBuild, runTestSuite, and other fields together", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          description: "Original description",
          workspaceId: workspace.id,
          featureId: feature.id,
          status: "TODO",
          priority: "MEDIUM",
          createdById: user.id,
          updatedById: user.id,
          runBuild: true,
          runTestSuite: true,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        {
          title: "Updated Ticket",
          description: "Updated description",
          status: "IN_PROGRESS",
          priority: "HIGH",
          runBuild: false,
          runTestSuite: false,
        },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      const data = await expectSuccess(response, 200);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: ticket.id },
        select: {
          title: true,
          description: true,
          status: true,
          priority: true,
          runBuild: true,
          runTestSuite: true,
        },
      });
      expect(updatedTask?.title).toBe("Updated Ticket");
      expect(updatedTask?.description).toBe("Updated description");
      expect(updatedTask?.status).toBe("IN_PROGRESS");
      expect(updatedTask?.priority).toBe("HIGH");
      expect(updatedTask?.runBuild).toBe(false);
      expect(updatedTask?.runTestSuite).toBe(false);
    });
  });

  describe("Authorization", () => {
    test("validates ticket exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPatchRequest(
        "http://localhost:3000/api/tickets/non-existent-id",
        { runBuild: false },
        user,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: "non-existent-id" }) });

      await expectError(response, "Task not found", 404);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const ticket = await db.task.create({
        data: {
          title: "Test Ticket",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/tickets/${ticket.id}`,
        { runBuild: false },
        nonMember,
      );

      const response = await PATCH(request, { params: Promise.resolve({ ticketId: ticket.id }) });

      await expectError(response, "Access denied", 403);
    });
  });
});

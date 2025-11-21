import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/generate/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

// Mock AI dependencies
vi.mock("aieo", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(() => "mock-api-key"),
}));

vi.mock("ai", () => ({
  streamObject: vi.fn(),
  streamText: vi.fn(),
}));

describe("Generate Content API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/features/[featureId]/generate", () => {
    test("requires authentication", async () => {
      const request = createPostRequest("http://localhost:3000/api/features/test-feature-id/generate", {
        type: "userStories",
      });

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "test-feature-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/generate",
        { type: "userStories" },
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "userStories" },
        nonMember,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 400 when type parameter is missing", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        {}, // No type parameter
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Invalid type parameter", 400);
    });

    test("returns 400 when type parameter is invalid", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "invalid_type" },
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Invalid type parameter", 400);
    });

    test("returns streaming response for userStories type", async () => {
      const { getModel } = await import("aieo");
      const { streamObject } = await import("ai");

      // Mock the model and streaming response
      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      vi.mocked(getModel).mockResolvedValue(mockModel as any);

      const mockStreamResponse = {
        toTextStreamResponse: vi.fn(() => new Response("mock stream")),
      };
      vi.mocked(streamObject).mockReturnValue(mockStreamResponse as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          brief: "A test feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "userStories" },
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(getModel).toHaveBeenCalledWith("anthropic", "mock-api-key");
      expect(streamObject).toHaveBeenCalled();
    });

    test("returns streaming response for requirements type", async () => {
      const { getModel } = await import("aieo");
      const { streamObject } = await import("ai");

      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      vi.mocked(getModel).mockResolvedValue(mockModel as any);

      const mockStreamResponse = {
        toTextStreamResponse: vi.fn(() => new Response("mock stream")),
      };
      vi.mocked(streamObject).mockReturnValue(mockStreamResponse as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          brief: "A test feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "requirements" },
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(getModel).toHaveBeenCalledWith("anthropic", "mock-api-key");
      expect(streamObject).toHaveBeenCalled();
    });

    test("returns streaming response for architecture type", async () => {
      const { getModel } = await import("aieo");
      const { streamObject } = await import("ai");

      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      vi.mocked(getModel).mockResolvedValue(mockModel as any);

      const mockStreamResponse = {
        toTextStreamResponse: vi.fn(() => new Response("mock stream")),
      };
      vi.mocked(streamObject).mockReturnValue(mockStreamResponse as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          brief: "A test feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "architecture" },
        user,
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(getModel).toHaveBeenCalledWith("anthropic", "mock-api-key");
      expect(streamObject).toHaveBeenCalled();
    });
  });
});

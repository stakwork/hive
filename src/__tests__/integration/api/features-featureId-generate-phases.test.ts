import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/generate/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectUnauthorized,
  expectError,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

// Mock AI dependencies
vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(() => "mock-api-key"),
}));

vi.mock("ai", () => ({
  streamObject: vi.fn(),
}));

describe("Generate Phases and Tickets API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/features/[featureId]/generate - phasesTickets type", () => {
    test("returns streaming response for phasesTickets type", async () => {
      const { getModel } = await import("@/lib/ai/provider");
      const { streamObject } = await import("ai");

      // Mock the model and streaming response
      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      vi.mocked(getModel).mockResolvedValue(mockModel as any);

      const mockStreamResponse = {
        toTextStreamResponse: vi.fn(() => new Response("mock stream")),
      };
      vi.mocked(streamObject).mockReturnValue(mockStreamResponse as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.features.create({
        data: {
          title: "Voice Command Feature",
          brief: "Add voice commands to the app",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "phasesTickets" },
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({feature_id: feature.id }),
      });

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(getModel).toHaveBeenCalledWith("anthropic", "mock-api-key");
      expect(streamObject).toHaveBeenCalled();

      // Verify streamObject was called with correct schema structure
      const streamObjectCall = vi.mocked(streamObject).mock.calls[0][0];
      expect(streamObjectCall.schema).toBeDefined();
      expect(streamObjectCall.system).toContain("technical project manager");
    });

    test("requires authentication", async () => {
      const request = new Request(
        "http://localhost:3000/api/features/test-feature-id/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "phasesTickets" }),
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({feature_id: "test-feature-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/generate",
        { type: "phasesTickets" },
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({feature_id: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.features.create({
        data: {
          title: "Test Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "phasesTickets" },
        nonMember
      );

      const response = await POST(request, {
        params: Promise.resolve({feature_id: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 400 when type parameter is invalid", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.features.create({
        data: {
          title: "Test Feature",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "invalid_type" },
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({feature_id: feature.id }),
      });

      await expectError(response, "Invalid type parameter", 400);
    });

    test("includes feature context in AI prompt", async () => {
      const { getModel } = await import("@/lib/ai/provider");
      const { streamObject } = await import("ai");

      const mockModel = { modelId: "claude-3-5-sonnet-20241022" };
      vi.mocked(getModel).mockResolvedValue(mockModel as any);

      const mockStreamResponse = {
        toTextStreamResponse: vi.fn(() => new Response("mock stream")),
      };
      vi.mocked(streamObject).mockReturnValue(mockStreamResponse as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
        description: "A test workspace for development",
      });

      const feature = await db.features.create({
        data: {
          title: "Payment Integration",
          brief: "Add Stripe payment processing",
          requirements: "Must support credit cards and ACH",
          architecture: "Use Stripe SDK with webhook handlers",
          personas: ["Customer", "Admin"],workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      // Add user stories
      await db.user_stories.create({
        data: {
          title: "Customer can checkout with credit card",feature_id: feature.id,
          order: 0,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/generate`,
        { type: "phasesTickets" },
        user
      );

      await POST(request, {
        params: Promise.resolve({feature_id: feature.id }),
      });

      // Verify the prompt includes all context
      const streamObjectCall = vi.mocked(streamObject).mock.calls[0][0];
      expect(streamObjectCall.prompt).toContain("Payment Integration");
      expect(streamObjectCall.prompt).toContain("Add Stripe payment processing");
      expect(streamObjectCall.prompt).toContain("Must support credit cards");
      expect(streamObjectCall.prompt).toContain("Use Stripe SDK");
      expect(streamObjectCall.prompt).toContain("Customer");
      expect(streamObjectCall.prompt).toContain("Customer can checkout");
    });
  });
});

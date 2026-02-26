/**
 * Integration tests for PUT /api/features/[featureId]/title
 *
 * Tests the feature title update endpoint including:
 * - Authentication via x-api-token header
 * - Input validation (title presence, type)
 * - Feature existence checks
 * - Database persistence
 * - Pusher event broadcasting (FEATURE_TITLE_UPDATE)
 * - No broadcast when title unchanged
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers";
import type { Workspace, User, Feature } from "@prisma/client";

// Mock Pusher - use vi.hoisted to ensure proper initialization order
const { mockPusherTrigger } = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: {
      trigger: mockPusherTrigger,
    },
  };
});

// Import after mock setup
import { PUT } from "@/app/api/features/[featureId]/title/route";

// Helper to create test setup with owner, workspace, and feature
async function createFeatureTestSetup() {
  const testData = await db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `test-${Date.now()}@example.com`,
        name: "Test Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
        ownerId: owner.id,
      },
    });

    await tx.workspaceMember.create({
      data: {
        id: generateUniqueId("workspaceMember"),
        userId: owner.id,
        workspaceId: workspace.id,
        role: "OWNER",
      },
    });

    const feature = await tx.feature.create({
      data: {
        id: generateUniqueId("feature"),
        title: "Original Feature Title",
        brief: "Test feature brief",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    return { owner, workspace, feature };
  });

  return testData;
}

// Helper to create PUT request with x-api-token header
function createPutRequest(url: string, body: { title: string }, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["x-api-token"] = token;
  }

  return new Request(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

// Helper to expect unauthorized response
async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(401);
  const data = await response.json();
  expect(data).toEqual({ error: "Unauthorized" });
}

describe("PUT /api/features/[featureId]/title - Integration Tests", () => {
  const VALID_API_TOKEN = process.env.API_TOKEN || "test-api-token";

  beforeEach(() => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 for requests without x-api-token header", async () => {
      const { feature } = await createFeatureTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: "New Title" }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 for requests with invalid x-api-token", async () => {
      const { feature } = await createFeatureTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: "New Title" },
        "invalid-token"
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when title is missing", async () => {
      const { feature } = await createFeatureTestSetup();

      const request = new Request(
        `http://localhost:3000/api/features/${feature.id}/title`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": VALID_API_TOKEN,
          },
          body: JSON.stringify({}),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    test("returns 400 when title is not a string", async () => {
      const { feature } = await createFeatureTestSetup();

      const request = new Request(
        `http://localhost:3000/api/features/${feature.id}/title`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": VALID_API_TOKEN,
          },
          body: JSON.stringify({ title: 123 }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    test("returns 400 when title is empty string", async () => {
      const { feature } = await createFeatureTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: "" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });
  });

  describe("Feature Existence", () => {
    test("returns 404 when feature does not exist", async () => {
      const nonExistentId = "feature_nonexistent123";

      const request = createPutRequest(
        `http://localhost:3000/api/features/${nonExistentId}/title`,
        { title: "New Title" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: nonExistentId }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Feature not found");
    });
  });

  describe("Successful Title Updates", () => {
    test("updates feature title and persists to database", async () => {
      const { feature } = await createFeatureTestSetup();
      const newTitle = "Updated Feature Title";

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.title).toBe(newTitle);

      // Verify database persistence
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.title).toBe(newTitle);
    });

    test("trims whitespace from title", async () => {
      const { feature } = await createFeatureTestSetup();
      const titleWithWhitespace = "  Trimmed Title  ";
      const expectedTitle = "Trimmed Title";

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: titleWithWhitespace },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(expectedTitle);

      // Verify database persistence
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.title).toBe(expectedTitle);
    });
  });

  describe("Pusher Event Broadcasting", () => {
    test("broadcasts FEATURE_TITLE_UPDATE event when title changes", async () => {
      const { feature } = await createFeatureTestSetup();
      const newTitle = "Updated Feature Title";

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      // Verify Pusher trigger was called
      expect(mockPusherTrigger).toHaveBeenCalledOnce();
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `feature-${feature.id}`,
        "feature-title-update",
        { featureId: feature.id, newTitle }
      );
    });

    test("does NOT broadcast when title is unchanged", async () => {
      const { feature } = await createFeatureTestSetup();
      const sameTitle = feature.title;

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: sameTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe("Title unchanged");

      // Verify Pusher trigger was NOT called
      expect(mockPusherTrigger).not.toHaveBeenCalled();
    });

    test("does NOT broadcast when trimmed title matches current title", async () => {
      const { feature } = await createFeatureTestSetup();
      const titleWithWhitespace = `  ${feature.title}  `;

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: titleWithWhitespace },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe("Title unchanged");

      // Verify Pusher trigger was NOT called
      expect(mockPusherTrigger).not.toHaveBeenCalled();
    });

    test("handles Pusher trigger failure gracefully", async () => {
      const { feature } = await createFeatureTestSetup();
      const newTitle = "Updated Feature Title";

      // Mock Pusher trigger to throw error
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher error"));

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Should still succeed even if Pusher fails
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.title).toBe(newTitle);

      // Verify database was updated
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.title).toBe(newTitle);
    });
  });

  describe("Data Consistency", () => {
    test("only updates title field, preserving other feature fields", async () => {
      const { feature } = await createFeatureTestSetup();
      const originalBrief = feature.brief;
      const originalWorkspaceId = feature.workspaceId;
      const newTitle = "Updated Feature Title";

      const request = createPutRequest(
        `http://localhost:3000/api/features/${feature.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);

      // Verify only title changed
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });

      expect(updatedFeature?.title).toBe(newTitle);
      expect(updatedFeature?.brief).toBe(originalBrief);
      expect(updatedFeature?.workspaceId).toBe(originalWorkspaceId);
    });
  });
});

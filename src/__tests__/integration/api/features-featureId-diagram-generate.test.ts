import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/features/[featureId]/diagram/generate/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

// Mock the Gemini service
vi.mock("@/services/gemini-image", () => ({
  generateArchitectureDiagram: vi.fn(),
  GeminiError: class GeminiError extends Error {
    constructor(message: string, public type: string) {
      super(message);
      this.name = "GeminiError";
    }
  },
  GeminiErrorType: {
    AUTHENTICATION: "AUTHENTICATION",
    RATE_LIMIT: "RATE_LIMIT",
    INVALID_RESPONSE: "INVALID_RESPONSE",
    NETWORK: "NETWORK",
  },
}));

// Mock the diagram storage service
vi.mock("@/services/diagram-storage", () => ({
  getDiagramStorageService: vi.fn(() => ({
    uploadDiagram: vi.fn(),
    deleteDiagram: vi.fn(),
  })),
}));

describe("Diagram Generation API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test data
    await db.feature.deleteMany({
      where: { title: { startsWith: "Test" } },
    });
  });

  describe("POST /api/features/[featureId]/diagram/generate", () => {
    test("returns 401 for unauthenticated requests", async () => {
      const request = new Request("http://localhost:3000/api/features/test-id/diagram/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "test-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();
      const request = await createAuthenticatedPostRequest(
        "/api/features/non-existent-id/diagram/generate",
        {},
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("returns 403 for user without workspace access", async () => {
      const owner = await createTestUser();
      const otherUser = await createTestUser({ email: "other@example.com" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature for Access Control",
          workspaceId: workspace.id,
          architecture: "Test architecture content",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = await createAuthenticatedPostRequest(
        `/api/features/${feature.id}/diagram/generate`,
        {},
        otherUser
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 400 when architecture text is missing", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature Without Architecture",
          workspaceId: workspace.id,
          architecture: null, // No architecture text
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = await createAuthenticatedPostRequest(
        `/api/features/${feature.id}/diagram/generate`,
        {},
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Architecture text required", 400);
    });

    test("successfully generates diagram with valid architecture text", async () => {
      const { generateArchitectureDiagram } = await import("@/services/gemini-image");
      const { getDiagramStorageService } = await import("@/services/diagram-storage");

      // Setup mocks
      const mockImageBuffer = Buffer.from("fake-image-data");
      vi.mocked(generateArchitectureDiagram).mockResolvedValue(mockImageBuffer);

      const mockUploadResult = {
        s3Url: "https://s3.example.com/diagram.png",
        s3Key: "diagrams/feature-123.png",
      };
      const mockStorageService = {
        uploadDiagram: vi.fn().mockResolvedValue(mockUploadResult),
        deleteDiagram: vi.fn(),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      // Create test data
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature With Architecture",
          workspaceId: workspace.id,
          architecture: "## Architecture\n\nThis is a test architecture with multiple components.",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = await createAuthenticatedPostRequest(
        `/api/features/${feature.id}/diagram/generate`,
        {},
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Verify response
      const data = await expectSuccess(response, 200);
      expect(data.diagramUrl).toBe(mockUploadResult.s3Url);
      expect(data.s3Key).toBe(mockUploadResult.s3Key);

      // Verify Gemini was called with architecture text
      expect(generateArchitectureDiagram).toHaveBeenCalledWith(feature.architecture);

      // Verify storage service was called
      expect(mockStorageService.uploadDiagram).toHaveBeenCalledWith(
        mockImageBuffer,
        feature.id,
        workspace.id
      );

      // Verify database was updated
      const updatedFeature = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(updatedFeature?.diagramUrl).toBe(mockUploadResult.s3Url);
      expect(updatedFeature?.diagramS3Key).toBe(mockUploadResult.s3Key);
    });

    test("handles Gemini API errors gracefully", async () => {
      const { generateArchitectureDiagram, GeminiError, GeminiErrorType } = await import(
        "@/services/gemini-image"
      );

      // Setup mock to throw error
      vi.mocked(generateArchitectureDiagram).mockRejectedValue(
        new (GeminiError as any)("Rate limit exceeded", GeminiErrorType.RATE_LIMIT)
      );

      // Create test data
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature Rate Limit",
          workspaceId: workspace.id,
          architecture: "Test architecture",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = await createAuthenticatedPostRequest(
        `/api/features/${feature.id}/diagram/generate`,
        {},
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Diagram generation failed", 429);
    });

    test("cleans up diagram on database update failure", async () => {
      const { generateArchitectureDiagram } = await import("@/services/gemini-image");
      const { getDiagramStorageService } = await import("@/services/diagram-storage");

      // Setup mocks
      const mockImageBuffer = Buffer.from("fake-image-data");
      vi.mocked(generateArchitectureDiagram).mockResolvedValue(mockImageBuffer);

      const mockUploadResult = {
        s3Url: "https://s3.example.com/diagram.png",
        s3Key: "diagrams/feature-123.png",
      };
      const mockStorageService = {
        uploadDiagram: vi.fn().mockResolvedValue(mockUploadResult),
        deleteDiagram: vi.fn(),
      };
      vi.mocked(getDiagramStorageService).mockReturnValue(mockStorageService as any);

      // Create test data
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature DB Failure",
          workspaceId: workspace.id,
          architecture: "Test architecture",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Mock db.feature.update to fail
      const originalUpdate = db.feature.update;
      db.feature.update = vi.fn().mockRejectedValue(new Error("DB Error"));

      const request = await createAuthenticatedPostRequest(
        `/api/features/${feature.id}/diagram/generate`,
        {},
        user
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Verify error response
      await expectError(response, "Database update failed", 500);

      // Verify cleanup was called
      expect(mockStorageService.deleteDiagram).toHaveBeenCalledWith(mockUploadResult.s3Key);

      // Restore original function
      db.feature.update = originalUpdate;
    });
  });
});

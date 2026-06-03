/**
 * Integration tests for POST /api/scorer/analyze/[featureId]
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
  resetDatabase,
} from "@/__tests__/support/fixtures";
import { createTestMembership } from "@/__tests__/support/factories/workspace.factory";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { POST } from "@/app/api/scorer/analyze/[featureId]/route";

// ---------------------------------------------------------------------------
// Mock the scorer pipeline functions — we test the route, not the pipeline
// ---------------------------------------------------------------------------
const { mockGenerateDigest, mockCacheFeatureAgentStats, mockAnalyzeSingleSession } =
  vi.hoisted(() => ({
    mockGenerateDigest: vi.fn().mockResolvedValue(undefined),
    mockCacheFeatureAgentStats: vi.fn().mockResolvedValue(undefined),
    mockAnalyzeSingleSession: vi.fn().mockResolvedValue({ insightCount: 2 }),
  }));

vi.mock("@/lib/scorer/digest", () => ({
  generateDigest: mockGenerateDigest,
}));

vi.mock("@/lib/scorer/agent-stats", () => ({
  cacheFeatureAgentStats: mockCacheFeatureAgentStats,
}));

vi.mock("@/lib/scorer/analysis", () => ({
  analyzeSingleSession: mockAnalyzeSingleSession,
}));

describe("POST /api/scorer/analyze/[featureId]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateDigest.mockResolvedValue(undefined);
    mockCacheFeatureAgentStats.mockResolvedValue(undefined);
    mockAnalyzeSingleSession.mockResolvedValue({ insightCount: 2 });
    await resetDatabase();
  });

  test("returns 404 when feature does not exist", async () => {
    const owner = await createTestUser();
    const request = createAuthenticatedPostRequest(
      "http://localhost/api/scorer/analyze/nonexistent",
      owner,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: "nonexistent" }),
    });

    expect(response.status).toBe(404);
  });

  test("returns 401 for unauthenticated request", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 403 for non-owner workspace member", async () => {
    const owner = await createTestUser();
    const developer = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: developer.id,
      role: "DEVELOPER",
    });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      developer,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  test("workspace owner runs full pipeline and returns insights", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    // Seed an insight so the re-fetch returns data
    await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "HIGH",
        pattern: "Test",
        description: "desc",
        featureIds: [feature.id],
        suggestion: "suggestion",
        digestIds: [],
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      owner,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insightCount).toBe(2); // from mock
    expect(Array.isArray(body.insights)).toBe(true);

    // Pipeline steps were called in order
    expect(mockGenerateDigest).toHaveBeenCalledWith(feature.id);
    expect(mockCacheFeatureAgentStats).toHaveBeenCalledWith(feature.id);
    expect(mockAnalyzeSingleSession).toHaveBeenCalledWith(
      feature.id,
      workspace.id,
      undefined // no custom prompt
    );
  });

  test("passes custom prompt to analyzeSingleSession when provided in body", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const customPrompt = "my custom prompt {session}";

    const request = createAuthenticatedPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      owner,
      { prompt: customPrompt }
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);

    expect(mockAnalyzeSingleSession).toHaveBeenCalledWith(
      feature.id,
      workspace.id,
      customPrompt
    );
  });

  test("sends undefined (not empty string) to analyzeSingleSession when no prompt in body", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    // Send body without prompt field
    const request = createAuthenticatedPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      owner,
      { someOtherField: "value" }
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);

    expect(mockAnalyzeSingleSession).toHaveBeenCalledWith(
      feature.id,
      workspace.id,
      undefined
    );
  });

  test("superAdmin (non-member) can trigger analysis", async () => {
    const owner = await createTestUser();
    const superAdmin = await createTestUser({ role: "SUPER_ADMIN" });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost/api/scorer/analyze/${feature.id}`,
      superAdmin,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    expect(mockAnalyzeSingleSession).toHaveBeenCalled();
  });
});

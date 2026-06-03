/**
 * Integration tests for GET /api/scorer/insights/[featureId]
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
  createGetRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";
import { GET } from "@/app/api/scorer/insights/[featureId]/route";
import { DEFAULT_SINGLE_SESSION_PROMPT } from "@/lib/scorer/prompts";

describe("GET /api/scorer/insights/[featureId]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  test("returns 404 when feature does not exist", async () => {
    const request = createGetRequest(
      "http://localhost/api/scorer/insights/nonexistent-feature"
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: "nonexistent-feature" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Feature not found");
  });

  test("returns 401 for unauthenticated request on private workspace", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(401);
  });

  test("returns { insights: [], effectivePrompt } when no insights exist — effectivePrompt is default prompt", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createAuthenticatedGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`,
      owner
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insights).toEqual([]);
    expect(body.effectivePrompt).toBe(DEFAULT_SINGLE_SESSION_PROMPT);
  });

  test("returns workspace scorerSinglePrompt as effectivePrompt when set", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const customPrompt = "custom workspace prompt {session}";
    await db.workspace.update({
      where: { id: workspace.id },
      data: { scorerSinglePrompt: customPrompt },
    });

    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createAuthenticatedGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`,
      owner
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.effectivePrompt).toBe(customPrompt);
  });

  test("returns populated insights sorted HIGH → MEDIUM → LOW then by recency", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    // Create insights with different severities
    const low = await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "LOW",
        pattern: "Low pattern",
        description: "Low description",
        featureIds: [feature.id],
        suggestion: "Low suggestion",
        digestIds: [],
      },
    });
    const high = await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "HIGH",
        pattern: "High pattern",
        description: "High description",
        featureIds: [feature.id],
        suggestion: "High suggestion",
        digestIds: [],
      },
    });
    const medium = await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "MEDIUM",
        pattern: "Medium pattern",
        description: "Medium description",
        featureIds: [feature.id],
        suggestion: "Medium suggestion",
        digestIds: [],
      },
    });

    const request = createAuthenticatedGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`,
      owner
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insights).toHaveLength(3);
    expect(body.insights[0].id).toBe(high.id);
    expect(body.insights[1].id).toBe(medium.id);
    expect(body.insights[2].id).toBe(low.id);
  });

  test("excludes dismissed insights", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    // Active insight
    await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "HIGH",
        pattern: "Active pattern",
        description: "desc",
        featureIds: [feature.id],
        suggestion: "suggestion",
        digestIds: [],
      },
    });
    // Dismissed insight
    await db.scorerInsight.create({
      data: {
        workspaceId: workspace.id,
        mode: "single",
        promptSnapshot: "prompt",
        severity: "HIGH",
        pattern: "Dismissed pattern",
        description: "desc",
        featureIds: [feature.id],
        suggestion: "suggestion",
        digestIds: [],
        dismissedAt: new Date(),
      },
    });

    const request = createAuthenticatedGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`,
      owner
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insights).toHaveLength(1);
    expect(body.insights[0].pattern).toBe("Active pattern");
  });

  test("workspace member (non-owner) can access insights", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: member.id,
      role: "DEVELOPER",
    });
    const feature = await createTestFeature({
      workspaceId: workspace.id,
      createdById: owner.id,
      updatedById: owner.id,
    });

    const request = createAuthenticatedGetRequest(
      `http://localhost/api/scorer/insights/${feature.id}`,
      member
    );

    const response = await GET(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(200);
  });
});

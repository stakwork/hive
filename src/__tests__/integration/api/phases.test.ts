import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/phases/reorder/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

describe("POST /api/features/[featureId]/phases/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reorders phases successfully and persists new order", async () => {
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

    // Create 3 phases with initial order [0, 1, 2]
    const phase1 = await db.phase.create({
      data: {
        name: "Phase 1",
        description: "First phase",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const phase2 = await db.phase.create({
      data: {
        name: "Phase 2",
        description: "Second phase",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 1,
      },
    });

    const phase3 = await db.phase.create({
      data: {
        name: "Phase 3",
        description: "Third phase",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 2,
      },
    });

    // Reorder to [Phase 3, Phase 1, Phase 2] with new order [0, 1, 2]
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [
          { id: phase3.id, order: 0 },
          { id: phase1.id, order: 1 },
          { id: phase2.id, order: 2 },
        ],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const data = await expectSuccess(response, 200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(3);

    // Verify database state reflects new order
    const updatedPhases = await db.phase.findMany({
      where: { featureId: feature.id, deleted: false },
      orderBy: { order: "asc" },
    });

    expect(updatedPhases).toHaveLength(3);
    expect(updatedPhases[0].id).toBe(phase3.id);
    expect(updatedPhases[0].order).toBe(0);
    expect(updatedPhases[1].id).toBe(phase1.id);
    expect(updatedPhases[1].order).toBe(1);
    expect(updatedPhases[2].id).toBe(phase2.id);
    expect(updatedPhases[2].order).toBe(2);
  });

  test("requires authentication", async () => {
    const request = createPostRequest("http://localhost:3000/api/features/test-id/phases/reorder", {
      phases: [{ id: "phase-id", order: 0 }],
    });

    const response = await POST(request, {
      params: Promise.resolve({ featureId: "test-id" }),
    });

    await expectUnauthorized(response);
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

    const phase = await db.phase.create({
      data: {
        name: "Test Phase",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [{ id: phase.id, order: 0 }],
      },
      nonMember,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    await expectError(response, "Access denied", 403);
  });

  test("validates feature exists", async () => {
    const user = await createTestUser();

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/features/non-existent-id/phases/reorder",
      {
        phases: [{ id: "phase-id", order: 0 }],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: "non-existent-id" }),
    });

    await expectError(response, "Feature not found", 404);
  });

  test("rejects deleted workspace features", async () => {
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

    const phase = await db.phase.create({
      data: {
        name: "Test Phase",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    // Soft delete workspace
    await db.workspace.update({
      where: { id: workspace.id },
      data: { deleted: true, deletedAt: new Date() },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [{ id: phase.id, order: 0 }],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    await expectError(response, "Feature not found", 404);
  });

  test("validates phases array is provided", async () => {
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
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      { phases: "not-an-array" },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    await expectError(response, "Phases must be an array", 400);
  });

  test("handles empty phases array gracefully", async () => {
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
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      { phases: [] },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const data = await expectSuccess(response, 200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
  });

  test("prevents cross-feature phase reordering", async () => {
    const user = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: user.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Create two features in same workspace
    const feature1 = await db.feature.create({
      data: {
        title: "Feature 1",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const feature2 = await db.feature.create({
      data: {
        title: "Feature 2",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // Create phase in feature 1
    const phase1 = await db.phase.create({
      data: {
        name: "Phase in Feature 1",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature1.id,
        order: 0,
      },
    });

    // Create phase in feature 2
    const phase2 = await db.phase.create({
      data: {
        name: "Phase in Feature 2",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature2.id,
        order: 0,
      },
    });

    // Attempt to reorder phase from feature 2 in feature 1's endpoint
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature1.id}/phases/reorder`,
      {
        phases: [
          { id: phase1.id, order: 0 },
          { id: phase2.id, order: 1 }, // Wrong feature!
        ],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature1.id }),
    });

    // Transaction fails because phase2 doesn't match featureId in WHERE clause
    expect(response.status).toBe(404);

    // Verify original order is preserved (transaction rolled back)
    const phase1Check = await db.phase.findUnique({
      where: { id: phase1.id },
    });
    const phase2Check = await db.phase.findUnique({
      where: { id: phase2.id },
    });

    expect(phase1Check?.order).toBe(0);
    expect(phase1Check?.featureId).toBe(feature1.id);
    expect(phase2Check?.order).toBe(0);
    expect(phase2Check?.featureId).toBe(feature2.id);
  });

  test("rolls back transaction on partial failure with invalid phase ID", async () => {
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

    const phase1 = await db.phase.create({
      data: {
        name: "Phase 1",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const phase2 = await db.phase.create({
      data: {
        name: "Phase 2",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 1,
      },
    });

    // Attempt reorder with one invalid phase ID in the middle
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [
          { id: phase1.id, order: 0 },
          { id: "non-existent-phase-id", order: 1 }, // Invalid!
          { id: phase2.id, order: 2 },
        ],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    // Prisma transaction fails, mapped to 404
    expect(response.status).toBe(404);

    // Verify original order is preserved (no partial updates)
    const updatedPhases = await db.phase.findMany({
      where: { featureId: feature.id, deleted: false },
      orderBy: { order: "asc" },
    });

    expect(updatedPhases).toHaveLength(2);
    expect(updatedPhases[0].id).toBe(phase1.id);
    expect(updatedPhases[0].order).toBe(0); // Original order
    expect(updatedPhases[1].id).toBe(phase2.id);
    expect(updatedPhases[1].order).toBe(1); // Original order
  });

  test("handles reordering with duplicate order values", async () => {
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

    const phase1 = await db.phase.create({
      data: {
        name: "Phase 1",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const phase2 = await db.phase.create({
      data: {
        name: "Phase 2",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 1,
      },
    });

    // Reorder with duplicate order values (both order: 0)
    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [
          { id: phase1.id, order: 0 },
          { id: phase2.id, order: 0 }, // Duplicate order
        ],
      },
      user,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    // Should succeed - database allows duplicate order values
    const data = await expectSuccess(response, 200);
    expect(data.success).toBe(true);

    // Verify both phases have order 0
    const updatedPhases = await db.phase.findMany({
      where: { featureId: feature.id, deleted: false },
    });

    expect(updatedPhases).toHaveLength(2);
    expect(updatedPhases.every((p) => p.order === 0)).toBe(true);
  });

  test("allows workspace owner to reorder phases", async () => {
    const owner = await createTestUser();
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

    const phase = await db.phase.create({
      data: {
        name: "Test Phase",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [{ id: phase.id, order: 5 }],
      },
      owner,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const data = await expectSuccess(response, 200);
    expect(data.success).toBe(true);

    // Verify owner can reorder
    const updatedPhase = await db.phase.findUnique({
      where: { id: phase.id },
    });
    expect(updatedPhase?.order).toBe(5);
  });

  test("allows workspace member to reorder phases", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      },
    });

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const phase = await db.phase.create({
      data: {
        name: "Test Phase",
        description: "Test description",
        status: "NOT_STARTED",
        featureId: feature.id,
        order: 0,
      },
    });

    const request = createAuthenticatedPostRequest(
      `http://localhost:3000/api/features/${feature.id}/phases/reorder`,
      {
        phases: [{ id: phase.id, order: 3 }],
      },
      member,
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const data = await expectSuccess(response, 200);
    expect(data.success).toBe(true);

    // Verify member can reorder
    const updatedPhase = await db.phase.findUnique({
      where: { id: phase.id },
    });
    expect(updatedPhase?.order).toBe(3);
  });
});

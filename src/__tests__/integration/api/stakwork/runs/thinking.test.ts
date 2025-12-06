import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";

describe("Stakwork Run Thinking Artifacts - Database Integration", () => {
  let workspaceId: string;
  let featureId: string;
  let userId: string;

  beforeEach(async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });
    userId = user.id;

    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: userId,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });
    workspaceId = workspace.id;

    // Create test feature
    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId,
        createdById: userId,
        updatedById: userId,
      },
    });
    featureId = feature.id;
  });

  afterEach(async () => {
    // Cleanup
    await db.stakworkRun.deleteMany({ where: { workspaceId } });
    await db.feature.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId } });
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.delete({ where: { id: userId } });
  });

  it("should store and retrieve thinking artifacts as JSON", async () => {
    const thinkingArtifacts = [
      {
        stepId: "step-1",
        stepName: "Research",
        log: "Starting research",
        output: "Found results",
        stepState: "completed",
      },
      {
        stepId: "step-2",
        stepName: "Analysis",
        log: "Analyzing data",
        stepState: "running",
      },
    ];

    const stakworkRun = await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId,
        projectId: 12345,
        webhookUrl: "http://example.com/webhook",
        type: "ARCHITECTURE",
        status: "IN_PROGRESS",
        thinkingArtifacts,
      },
    });

    const retrieved = await db.stakworkRun.findUnique({
      where: { id: stakworkRun.id },
    });

    expect(retrieved?.thinkingArtifacts).toEqual(thinkingArtifacts);
  });

  it("should handle null thinking artifacts", async () => {
    const stakworkRun = await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId,
        projectId: 12345,
        webhookUrl: "http://example.com/webhook",
        type: "ARCHITECTURE",
        status: "PENDING",
        thinkingArtifacts: null,
      },
    });

    const retrieved = await db.stakworkRun.findUnique({
      where: { id: stakworkRun.id },
    });

    expect(retrieved?.thinkingArtifacts).toBeNull();
  });

  it("should update thinking artifacts", async () => {
    const initialArtifacts = [
      {
        stepId: "step-1",
        stepName: "Step 1",
        log: "Initial log",
        stepState: "running",
      },
    ];

    const stakworkRun = await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId,
        projectId: 12345,
        webhookUrl: "http://example.com/webhook",
        type: "ARCHITECTURE",
        status: "IN_PROGRESS",
        thinkingArtifacts: initialArtifacts,
      },
    });

    const updatedArtifacts = [
      ...initialArtifacts,
      {
        stepId: "step-2",
        stepName: "Step 2",
        log: "New step",
        stepState: "running",
      },
    ];

    await db.stakworkRun.update({
      where: { id: stakworkRun.id },
      data: { thinkingArtifacts: updatedArtifacts },
    });

    const retrieved = await db.stakworkRun.findUnique({
      where: { id: stakworkRun.id },
    });

    expect(retrieved?.thinkingArtifacts).toEqual(updatedArtifacts);
  });

  it("should handle complex nested structures in thinking artifacts", async () => {
    const complexArtifacts = [
      {
        stepId: "step-1",
        stepName: "Complex Step",
        log: "Log with nested data",
        output: JSON.stringify({
          results: ["item1", "item2"],
          metadata: { count: 2, source: "api" },
        }),
        stepState: "completed",
      },
    ];

    const stakworkRun = await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId,
        projectId: 12345,
        webhookUrl: "http://example.com/webhook",
        type: "ARCHITECTURE",
        status: "COMPLETED",
        thinkingArtifacts: complexArtifacts,
      },
    });

    const retrieved = await db.stakworkRun.findUnique({
      where: { id: stakworkRun.id },
    });

    expect(retrieved?.thinkingArtifacts).toEqual(complexArtifacts);
  });

  it("should query stakwork runs by workspace with thinking artifacts", async () => {
    await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId,
        projectId: 12346,
        webhookUrl: "http://example.com/webhook1",
        type: "ARCHITECTURE",
        status: "COMPLETED",
        thinkingArtifacts: [
          { stepId: "s1", stepName: "Step 1", log: "Log", stepState: "completed" },
        ],
      },
    });

    await db.stakworkRun.create({
      data: {
        workspaceId,
        projectId: 12347,
        webhookUrl: "http://example.com/webhook2",
        type: "REQUIREMENTS",
        status: "IN_PROGRESS",
        thinkingArtifacts: null,
      },
    });

    const runs = await db.stakworkRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });

    expect(runs).toHaveLength(2);
    expect(runs[0].thinkingArtifacts).toBeDefined();
    expect(runs[1].thinkingArtifacts).toBeNull();
  });
});

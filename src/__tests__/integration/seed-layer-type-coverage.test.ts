import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, TaskLayerType } from "@prisma/client";
import { seedDatabase } from "../../../scripts/helpers/seed-database";

const prisma = new PrismaClient();

describe("Seed Script Layer Type Coverage", () => {
  // Run seed before each test (after resetDatabase from integration setup)
  beforeEach(async () => {
    // Run seed script - this will create users, workspaces, and tasks
    await seedDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should create at least 20 tasks", async () => {
    const totalTasks = await prisma.task.count();
    
    expect(totalTasks).toBeGreaterThanOrEqual(20);
  });

  it("should create tasks with all 8 layer types", async () => {
    const allLayerTypes = Object.values(TaskLayerType);
    
    for (const layerType of allLayerTypes) {
      const tasksWithLayerType = await prisma.task.count({
        where: { layerType },
      });
      
      expect(tasksWithLayerType).toBeGreaterThanOrEqual(1);
    }
  });

  it("should create at least 2 tasks per layer type", async () => {
    const layerTypeCounts = await prisma.task.groupBy({
      by: ["layerType"],
      _count: true,
      where: {
        layerType: { not: null },
      },
    });

    // Filter to only the newly created tasks
    const countsByType = layerTypeCounts.reduce((acc, item) => {
      if (item.layerType) {
        acc[item.layerType] = item._count;
      }
      return acc;
    }, {} as Record<string, number>);

    // Verify each layer type has at least 2 tasks (except CONFIG_INFRA and DOCUMENTATION which have 2)
    expect(countsByType[TaskLayerType.DATABASE_SCHEMA]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.BACKEND_API]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.FRONTEND_COMPONENT]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.INTEGRATION_TEST]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.UNIT_TEST]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.E2E_TEST]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.CONFIG_INFRA]).toBeGreaterThanOrEqual(2);
    expect(countsByType[TaskLayerType.DOCUMENTATION]).toBeGreaterThanOrEqual(2);
  });

  it("should create tasks with realistic titles for each layer type", async () => {
    // DATABASE_SCHEMA tasks should have database-related titles
    const dbTasks = await prisma.task.findMany({
      where: { layerType: TaskLayerType.DATABASE_SCHEMA },
      select: { title: true },
    });
    expect(dbTasks.length).toBeGreaterThan(0);
    expect(
      dbTasks.some((t) => 
        t.title.toLowerCase().includes("table") ||
        t.title.toLowerCase().includes("schema") ||
        t.title.toLowerCase().includes("index")
      )
    ).toBe(true);

    // BACKEND_API tasks should have API-related titles
    const apiTasks = await prisma.task.findMany({
      where: { layerType: TaskLayerType.BACKEND_API },
      select: { title: true },
    });
    expect(apiTasks.length).toBeGreaterThan(0);
    expect(
      apiTasks.some((t) =>
        t.title.toLowerCase().includes("api") ||
        t.title.toLowerCase().includes("endpoint") ||
        t.title.toLowerCase().includes("webhook")
      )
    ).toBe(true);

    // FRONTEND_COMPONENT tasks should have UI-related titles
    const frontendTasks = await prisma.task.findMany({
      where: { layerType: TaskLayerType.FRONTEND_COMPONENT },
      select: { title: true },
    });
    expect(frontendTasks.length).toBeGreaterThan(0);
    expect(
      frontendTasks.some((t) =>
        t.title.toLowerCase().includes("component") ||
        t.title.toLowerCase().includes("modal") ||
        t.title.toLowerCase().includes("table")
      )
    ).toBe(true);

    // TEST layer types should have test-related titles
    const testTasks = await prisma.task.findMany({
      where: {
        layerType: {
          in: [
            TaskLayerType.UNIT_TEST,
            TaskLayerType.INTEGRATION_TEST,
            TaskLayerType.E2E_TEST,
          ],
        },
      },
      select: { title: true },
    });
    expect(testTasks.length).toBeGreaterThan(0);
    expect(
      testTasks.some((t) =>
        t.title.toLowerCase().includes("test") ||
        t.title.toLowerCase().includes("verify") ||
        t.title.toLowerCase().includes("validate")
      )
    ).toBe(true);
  });

  it("should include edge cases with ambiguous titles (null layerType)", async () => {
    const ambiguousTasks = await prisma.task.findMany({
      where: { 
        layerType: null,
        title: {
          in: ["Fix button styling", "Improve performance", "Update dependencies"],
        },
      },
    });

    expect(ambiguousTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("should have diverse statuses across tasks", async () => {
    const statusCounts = await prisma.task.groupBy({
      by: ["status"],
      _count: true,
    });

    // Should have at least 2 different statuses
    expect(statusCounts.length).toBeGreaterThanOrEqual(2);
  });

  it("should have diverse priorities across tasks", async () => {
    const priorityCounts = await prisma.task.groupBy({
      by: ["priority"],
      _count: true,
    });

    // Should have at least 2 different priorities
    expect(priorityCounts.length).toBeGreaterThanOrEqual(2);
  });
});

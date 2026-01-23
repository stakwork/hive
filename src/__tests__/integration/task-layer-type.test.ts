import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient, TaskLayerType, TaskStatus, Priority } from "@prisma/client";

const prisma = new PrismaClient();

describe("Task Layer Type Integration Tests", () => {
  let testWorkspaceId: string;
  let testUserId: string;

  // Create fresh user and workspace before each test (after resetDatabase)
  beforeEach(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `test-layer-${Date.now()}@example.com`,
        name: "Layer Test User",
        emailVerified: new Date(),
      },
    });
    testUserId = user.id;

    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: "Layer Test Workspace",
        slug: `layer-test-${Date.now()}`,
        ownerId: testUserId,
      },
    });
    testWorkspaceId = workspace.id;
  });

  afterAll(async () => {
    // Disconnect Prisma client
    await prisma.$disconnect();
  });

  it("should create task with DATABASE_SCHEMA layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Create users table",
        description: "Database schema migration",
        layerType: TaskLayerType.DATABASE_SCHEMA,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.DATABASE_SCHEMA);
    expect(task.manualLayerOverride).toBeNull();
  });

  it("should create task with BACKEND_API layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Implement REST API",
        description: "Create API endpoints",
        layerType: TaskLayerType.BACKEND_API,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.BACKEND_API);
  });

  it("should create task with FRONTEND_COMPONENT layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Build UI component",
        description: "Create reusable React component",
        layerType: TaskLayerType.FRONTEND_COMPONENT,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.FRONTEND_COMPONENT);
  });

  it("should create task with INTEGRATION_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Test API integration",
        description: "Integration test suite",
        layerType: TaskLayerType.INTEGRATION_TEST,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.INTEGRATION_TEST);
  });

  it("should create task with UNIT_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Write unit tests",
        description: "Unit test coverage",
        layerType: TaskLayerType.UNIT_TEST,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.UNIT_TEST);
  });

  it("should create task with E2E_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "E2E testing",
        description: "End-to-end test scenarios",
        layerType: TaskLayerType.E2E_TEST,
        status: TaskStatus.TODO,
        priority: Priority.CRITICAL,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.E2E_TEST);
  });

  it("should create task with CONFIG_INFRA layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Setup CI/CD",
        description: "Infrastructure configuration",
        layerType: TaskLayerType.CONFIG_INFRA,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.CONFIG_INFRA);
  });

  it("should create task with DOCUMENTATION layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Write API docs",
        description: "API documentation",
        layerType: TaskLayerType.DOCUMENTATION,
        status: TaskStatus.TODO,
        priority: Priority.LOW,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.DOCUMENTATION);
  });

  it("should create task without layer type (nullable)", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Unclassified task",
        description: "Task without layer type",
        status: TaskStatus.TODO,
        priority: Priority.LOW,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBeNull();
    expect(task.manualLayerOverride).toBeNull();
  });

  it("should create task with manual layer override", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Task with override",
        description: "Manually overridden layer type",
        layerType: TaskLayerType.BACKEND_API,
        manualLayerOverride: true,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        workspaceId: testWorkspaceId,
        createdById: testUserId,
        updatedById: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.BACKEND_API);
    expect(task.manualLayerOverride).toBe(true);
  });

  it("should filter tasks by layer type", async () => {
    // Create multiple tasks with different layer types
    await Promise.all([
      prisma.task.create({
        data: {
          title: "Backend task 1",
          layerType: TaskLayerType.BACKEND_API,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workspaceId: testWorkspaceId,
          createdById: testUserId,
          updatedById: testUserId,
        },
      }),
      prisma.task.create({
        data: {
          title: "Backend task 2",
          layerType: TaskLayerType.BACKEND_API,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workspaceId: testWorkspaceId,
          createdById: testUserId,
          updatedById: testUserId,
        },
      }),
      prisma.task.create({
        data: {
          title: "Frontend task",
          layerType: TaskLayerType.FRONTEND_COMPONENT,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workspaceId: testWorkspaceId,
          createdById: testUserId,
          updatedById: testUserId,
        },
      }),
    ]);

    const backendTasks = await prisma.task.findMany({
      where: {
        workspaceId: testWorkspaceId,
        layerType: TaskLayerType.BACKEND_API,
      },
    });

    expect(backendTasks.length).toBeGreaterThanOrEqual(2);
    expect(
      backendTasks.every((t) => t.layerType === TaskLayerType.BACKEND_API)
    ).toBe(true);
  });

  it("should query tasks with multiple layer types", async () => {
    const testLayerTypes = [
      TaskLayerType.UNIT_TEST,
      TaskLayerType.INTEGRATION_TEST,
      TaskLayerType.E2E_TEST,
    ];

    const testTasks = await prisma.task.findMany({
      where: {
        workspaceId: testWorkspaceId,
        layerType: {
          in: testLayerTypes,
        },
      },
    });

    expect(
      testTasks.every((t) => t.layerType && testLayerTypes.includes(t.layerType))
    ).toBe(true);
  });
});

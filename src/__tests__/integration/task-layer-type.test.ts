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
        name: "Layer Test User",email_verified: new Date(),
      },
    });
    testUserId = user.id;

    // Create test workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: "Layer Test Workspace",
        slug: `layer-test-${Date.now()}`,owner_id: testUserId,
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
        description: "Database schema migration",layer_type: TaskLayerType.DATABASE_SCHEMA,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.DATABASE_SCHEMA);
    expect(task.manualLayerOverride).toBeNull();
  });

  it("should create task with BACKEND_API layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Implement REST API",
        description: "Create API endpoints",layer_type: TaskLayerType.BACKEND_API,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.BACKEND_API);
  });

  it("should create task with FRONTEND_COMPONENT layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Build UI component",
        description: "Create reusable React component",layer_type: TaskLayerType.FRONTEND_COMPONENT,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.FRONTEND_COMPONENT);
  });

  it("should create task with INTEGRATION_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Test API integration",
        description: "Integration test suite",layer_type: TaskLayerType.INTEGRATION_TEST,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.INTEGRATION_TEST);
  });

  it("should create task with UNIT_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Write unit tests",
        description: "Unit test coverage",layer_type: TaskLayerType.UNIT_TEST,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.UNIT_TEST);
  });

  it("should create task with E2E_TEST layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "E2E testing",
        description: "End-to-end test scenarios",layer_type: TaskLayerType.E2E_TEST,
        status: TaskStatus.TODO,
        priority: Priority.CRITICAL,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.E2E_TEST);
  });

  it("should create task with CONFIG_INFRA layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Setup CI/CD",
        description: "Infrastructure configuration",layer_type: TaskLayerType.CONFIG_INFRA,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBe(TaskLayerType.CONFIG_INFRA);
  });

  it("should create task with DOCUMENTATION layer type", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Write API docs",
        description: "API documentation",layer_type: TaskLayerType.DOCUMENTATION,
        status: TaskStatus.TODO,
        priority: Priority.LOW,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
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
        priority: Priority.LOW,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
      },
    });

    expect(task.layerType).toBeNull();
    expect(task.manualLayerOverride).toBeNull();
  });

  it("should create task with manual layer override", async () => {
    const task = await prisma.task.create({
      data: {
        title: "Task with override",
        description: "Manually overridden layer type",layer_type: TaskLayerType.BACKEND_API,manual_layer_override: true,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
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
          title: "Backend task 1",layer_type: TaskLayerType.BACKEND_API,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
        },
      }),
      prisma.task.create({
        data: {
          title: "Backend task 2",layer_type: TaskLayerType.BACKEND_API,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
        },
      }),
      prisma.task.create({
        data: {
          title: "Frontend task",layer_type: TaskLayerType.FRONTEND_COMPONENT,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,workspace_id: testWorkspaceId,created_by_id: testUserId,updated_by_id: testUserId,
        },
      }),
    ]);

    const backendTasks = await prisma.task.findMany({
      where: {workspace_id: testWorkspaceId,layer_type: TaskLayerType.BACKEND_API,
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
      where: {workspace_id: testWorkspaceId,layer_type: {
          in: testLayerTypes,
        },
      },
    });

    expect(
      testTasks.every((t) => t.layerType && testLayerTypes.includes(t.layerType))
    ).toBe(true);
  });
});

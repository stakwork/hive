import {
  PrismaClient,
  SwarmStatus,
  TaskLayerType,
  TaskStatus,
  Priority,
  FeatureStatus,
  FeaturePriority,
  StakworkRunType,
  WorkflowStatus,
} from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

async function seedUsersWithAccounts() {
  const users = [
    { name: "Alice Test", email: "alice@example.com" },
    { name: "Bob Test", email: "bob@example.com" },
    { name: "Dev Mock", email: "dev-user@mock.dev" },
  ];

  const results: Array<{ id: string; email: string }> = [];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: { name: u.name, email: u.email, emailVerified: new Date() },
    });

    const providerAccountId = `${user.id.slice(0, 8)}-gh`;
    const plainAccessToken = `gho_test_token_${user.id}`;

    await prisma.account.upsert({
      where: {
        provider_providerAccountId: { provider: "github", providerAccountId },
      },
      update: { access_token: plainAccessToken, scope: "repo,read:org" },
      create: {
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: plainAccessToken,
        token_type: "bearer",
        scope: "repo,read:org",
      },
    });

    results.push({ id: user.id, email: user.email || u.email });
  }

  return results;
}

async function seedWorkspacesAndSwarms(
  users: Array<{ id: string; email: string }>,
) {
  const items = [
    {
      owner: users[0],
      workspace: { name: "Alpha Workspace", slug: "alpha-workspace" },
      swarm: {
        name: "alpha-swarm",
        repoUrl: "https://github.com/example/alpha",
      },
    },
    {
      owner: users[1],
      workspace: { name: "Beta Workspace", slug: "beta-workspace" },
      swarm: { name: "beta-swarm", repoUrl: "https://github.com/example/beta" },
    },
    {
      owner: users[2],
      workspace: { name: "Dev Mock Workspace", slug: "dev-mock" },
      swarm: {
        name: "dev-mock-swarm",
        repoUrl: "https://github.com/example/dev-mock",
      },
    },
  ];

  for (const item of items) {
    const stakworkApiKey = `stakwork_key_${item.workspace.slug}`;

    const ws = await prisma.workspace.upsert({
      where: { slug: item.workspace.slug },
      update: {
        name: item.workspace.name,
        ownerId: item.owner.id,
        stakworkApiKey,
      },
      create: {
        name: item.workspace.name,
        slug: item.workspace.slug,
        ownerId: item.owner.id,
        stakworkApiKey,
      },
    });

    const poolApiKey = `pool_key_${item.workspace.slug}`;

    const swarmApiKey = `swarm_key_${item.swarm.name}`;

    await prisma.swarm.upsert({
      where: { workspaceId: ws.id },
      update: {
        name: item.swarm.name,
        status: SwarmStatus.ACTIVE,
        swarmApiKey,
        poolApiKey,
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "FEATURE_FLAG", value: "true" },
        ],
      },
      create: {
        name: item.swarm.name,
        status: SwarmStatus.ACTIVE,
        workspaceId: ws.id,
        swarmApiKey,
        poolApiKey,
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "FEATURE_FLAG", value: "true" },
        ],
      },
    });
  }
}

async function seedTasksWithLayerTypes(
  users: Array<{ id: string; email: string }>,
) {
  // Get all workspaces
  const workspaces = await prisma.workspace.findMany();
  if (workspaces.length === 0) {
    console.log("No workspaces found, skipping task seeding");
    return;
  }

  const workspace = workspaces[0];
  const userId = users[0].id;

  // Define tasks with diverse layer types (20+ tasks, 2-3 per layer)
  const tasksData = [
    // DATABASE_SCHEMA (3 tasks)
    {
      title: "Add user preferences table",
      description: "Create a new table for storing user-specific preferences",
      layerType: TaskLayerType.DATABASE_SCHEMA,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },
    {
      title: "Create audit log schema",
      description: "Design and implement audit logging tables",
      layerType: TaskLayerType.DATABASE_SCHEMA,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
    },
    {
      title: "Add indexes for performance",
      description: "Optimize database queries with strategic indexes",
      layerType: TaskLayerType.DATABASE_SCHEMA,
      status: TaskStatus.DONE,
      priority: Priority.MEDIUM,
    },

    // BACKEND_API (3 tasks)
    {
      title: "Create notification endpoints",
      description: "Build REST API for notification management",
      layerType: TaskLayerType.BACKEND_API,
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
    },
    {
      title: "Implement webhook handler",
      description: "Process incoming webhook payloads from external services",
      layerType: TaskLayerType.BACKEND_API,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.CRITICAL,
    },
    {
      title: "Add search API with filters",
      description: "Create powerful search endpoint with multiple filter options",
      layerType: TaskLayerType.BACKEND_API,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },

    // FRONTEND_COMPONENT (3 tasks)
    {
      title: "Build settings modal component",
      description: "Create reusable modal for app settings",
      layerType: TaskLayerType.FRONTEND_COMPONENT,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.MEDIUM,
    },
    {
      title: "Design notification toast system",
      description: "Implement toast notifications with animations",
      layerType: TaskLayerType.FRONTEND_COMPONENT,
      status: TaskStatus.TODO,
      priority: Priority.LOW,
    },
    {
      title: "Create data table with sorting",
      description: "Build sortable, filterable data table component",
      layerType: TaskLayerType.FRONTEND_COMPONENT,
      status: TaskStatus.DONE,
      priority: Priority.HIGH,
    },

    // INTEGRATION_TEST (3 tasks)
    {
      title: "Test API authentication flow",
      description: "Verify OAuth integration and token refresh",
      layerType: TaskLayerType.INTEGRATION_TEST,
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
    },
    {
      title: "Validate payment gateway integration",
      description: "Test complete payment processing workflow",
      layerType: TaskLayerType.INTEGRATION_TEST,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.CRITICAL,
    },
    {
      title: "Verify email service integration",
      description: "Test email sending and template rendering",
      layerType: TaskLayerType.INTEGRATION_TEST,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },

    // UNIT_TEST (3 tasks)
    {
      title: "Write tests for validation utils",
      description: "Cover all edge cases in validation functions",
      layerType: TaskLayerType.UNIT_TEST,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },
    {
      title: "Test date formatting helpers",
      description: "Ensure timezone and locale handling works correctly",
      layerType: TaskLayerType.UNIT_TEST,
      status: TaskStatus.DONE,
      priority: Priority.LOW,
    },
    {
      title: "Add coverage for auth middleware",
      description: "Test permission checks and role validation",
      layerType: TaskLayerType.UNIT_TEST,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
    },

    // E2E_TEST (3 tasks)
    {
      title: "Test complete checkout flow",
      description: "E2E test from cart to order confirmation",
      layerType: TaskLayerType.E2E_TEST,
      status: TaskStatus.TODO,
      priority: Priority.CRITICAL,
    },
    {
      title: "Verify user onboarding journey",
      description: "Test signup, verification, and profile setup",
      layerType: TaskLayerType.E2E_TEST,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
    },
    {
      title: "Test dashboard interactions",
      description: "Validate all dashboard features work together",
      layerType: TaskLayerType.E2E_TEST,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },

    // CONFIG_INFRA (2 tasks)
    {
      title: "Set up CI/CD pipeline",
      description: "Configure automated testing and deployment",
      layerType: TaskLayerType.CONFIG_INFRA,
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
    },
    {
      title: "Configure monitoring alerts",
      description: "Set up error tracking and performance monitoring",
      layerType: TaskLayerType.CONFIG_INFRA,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },

    // DOCUMENTATION (2 tasks)
    {
      title: "Write API integration guide",
      description: "Document all public API endpoints with examples",
      layerType: TaskLayerType.DOCUMENTATION,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },
    {
      title: "Update architecture diagrams",
      description: "Refresh system architecture documentation",
      layerType: TaskLayerType.DOCUMENTATION,
      status: TaskStatus.DONE,
      priority: Priority.LOW,
    },

    // Edge cases with ambiguous titles (no layerType set)
    {
      title: "Fix button styling",
      description: "Could be frontend or CSS config",
      layerType: null,
      status: TaskStatus.TODO,
      priority: Priority.LOW,
    },
    {
      title: "Improve performance",
      description: "Ambiguous - could be backend, frontend, or database",
      layerType: null,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    },
    {
      title: "Update dependencies",
      description: "Could be any layer - package updates",
      layerType: null,
      status: TaskStatus.TODO,
      priority: Priority.LOW,
    },
  ];

  console.log(`Creating ${tasksData.length} tasks with layer types...`);

  for (const taskData of tasksData) {
    await prisma.task.create({
      data: {
        title: taskData.title,
        description: taskData.description,
        layerType: taskData.layerType,
        status: taskData.status,
        priority: taskData.priority,
        workspaceId: workspace.id,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  console.log(
    `✓ Created ${tasksData.length} tasks across all ${Object.values(TaskLayerType).length} layer types`,
  );
}

async function seedFeaturesWithStakworkRuns(
  users: Array<{ id: string; email: string }>,
) {
  // Get all workspaces
  const workspaces = await prisma.workspace.findMany();
  if (workspaces.length === 0) {
    console.log("No workspaces found, skipping feature seeding");
    return;
  }

  const workspace = workspaces[0];
  const userId = users[0].id;

  console.log("Creating features with StakworkRuns for testing needs attention...");

  // Create features with various states
  const featuresData = [
    {
      title: "User Authentication System",
      brief: "Implement user authentication with OAuth",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
      needsAttention: true, // Has pending architecture review
    },
    {
      title: "Dashboard Analytics",
      brief: "Build analytics dashboard with charts",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
      needsAttention: true, // Has pending requirements review
    },
    {
      title: "Notification Service",
      brief: "Real-time notifications via websockets",
      status: FeatureStatus.BACKLOG,
      priority: FeaturePriority.LOW,
      needsAttention: false, // No pending reviews
    },
    {
      title: "API Rate Limiting",
      brief: "Implement rate limiting for API endpoints",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
      needsAttention: true, // Has pending task generation review
    },
    {
      title: "Search Functionality",
      brief: "Full-text search across all content",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
      needsAttention: false, // No pending reviews (decision already made)
    },
  ];

  for (const featureData of featuresData) {
    // Create the feature with a Phase
    const feature = await prisma.feature.create({
      data: {
        title: featureData.title,
        brief: featureData.brief,
        status: featureData.status,
        priority: featureData.priority,
        workspaceId: workspace.id,
        createdById: userId,
        updatedById: userId,
        phases: {
          create: {
            name: "Phase 1",
            description: null,
            status: "NOT_STARTED",
            order: 0,
          },
        },
      },
    });

    if (featureData.needsAttention) {
      // Create a StakworkRun with status=COMPLETED and decision=null (needs attention)
      const runTypes = [
        StakworkRunType.ARCHITECTURE,
        StakworkRunType.REQUIREMENTS,
        StakworkRunType.TASK_GENERATION,
      ];
      const randomType = runTypes[Math.floor(Math.random() * runTypes.length)];

      await prisma.stakworkRun.create({
        data: {
          webhookUrl: `https://example.com/webhook/${feature.id}`,
          type: randomType,
          featureId: feature.id,
          workspaceId: workspace.id,
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({ generated: "Sample AI-generated content for review" }),
          dataType: "json",
          decision: null, // User hasn't made a decision yet
        },
      });
    } else {
      // Create a StakworkRun with decision already made
      await prisma.stakworkRun.create({
        data: {
          webhookUrl: `https://example.com/webhook/${feature.id}`,
          type: StakworkRunType.ARCHITECTURE,
          featureId: feature.id,
          workspaceId: workspace.id,
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({ generated: "Sample accepted content" }),
          dataType: "json",
          decision: "ACCEPTED", // User already accepted
        },
      });
    }
  }

  console.log(`✓ Created ${featuresData.length} features with StakworkRuns`);
}

async function seedWhiteboards(
  users: Array<{ id: string; email: string }>,
) {
  // Get all workspaces
  const workspaces = await prisma.workspace.findMany({
    where: { deleted: false },
    take: 3,
  });

  if (workspaces.length === 0) {
    console.log("No workspaces found, skipping whiteboard seeding");
    return;
  }

  // Get all features across all workspaces
  const allFeatures = await prisma.feature.findMany({
    where: { 
      deleted: false,
      workspaceId: { in: workspaces.map(w => w.id) }
    },
    take: 5,
  });

  // First, delete existing whiteboards to ensure idempotency
  await prisma.whiteboard.deleteMany({});

  let totalWhiteboards = 0;
  let featureWhiteboards = 0;

  for (const workspace of workspaces) {
    // Create empty whiteboard
    await prisma.whiteboard.create({
      data: {
        name: "Empty Whiteboard",
        workspaceId: workspace.id,
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
    });
    totalWhiteboards++;

    // Create whiteboard with 5-8 sample elements
    const sampleElements = [
      {
        id: "rect-1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12345,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: [{ type: "arrow", id: "arrow-1" }],
      },
      {
        id: "text-1",
        type: "text",
        x: 120,
        y: 130,
        width: 160,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12346,
        version: 1,
        versionNonce: 2,
        isDeleted: false,
        text: "API Gateway",
        fontSize: 20,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
      },
      {
        id: "rect-2",
        type: "rectangle",
        x: 400,
        y: 100,
        width: 200,
        height: 120,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#b2f2bb",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12347,
        version: 1,
        versionNonce: 3,
        isDeleted: false,
        boundElements: [{ type: "arrow", id: "arrow-1" }],
      },
      {
        id: "text-2",
        type: "text",
        x: 420,
        y: 130,
        width: 160,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12348,
        version: 1,
        versionNonce: 4,
        isDeleted: false,
        text: "Database",
        fontSize: 20,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
      },
      {
        id: "arrow-1",
        type: "arrow",
        x: 300,
        y: 160,
        width: 100,
        height: 0,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12349,
        version: 1,
        versionNonce: 5,
        isDeleted: false,
        points: [
          [0, 0],
          [100, 0],
        ],
        lastCommittedPoint: [100, 0],
        startBinding: { elementId: "rect-1", focus: 0, gap: 1 },
        endBinding: { elementId: "rect-2", focus: 0, gap: 1 },
        startArrowhead: null,
        endArrowhead: "arrow",
      },
      {
        id: "ellipse-1",
        type: "ellipse",
        x: 200,
        y: 300,
        width: 180,
        height: 180,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#ffc9c9",
        fillStyle: "hachure",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12350,
        version: 1,
        versionNonce: 6,
        isDeleted: false,
      },
      {
        id: "text-3",
        type: "text",
        x: 220,
        y: 370,
        width: 140,
        height: 25,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 12351,
        version: 1,
        versionNonce: 7,
        isDeleted: false,
        text: "Auth Service",
        fontSize: 20,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "middle",
      },
    ];

    await prisma.whiteboard.create({
      data: {
        name: "Sample Architecture Diagram",
        workspaceId: workspace.id,
        elements: sampleElements,
        appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
        files: {},
      },
    });
    totalWhiteboards++;
  }

  // Create feature-linked whiteboards from the features we found
  const workspaceFeaturesMap = new Map<string, typeof allFeatures>();
  for (const feature of allFeatures) {
    if (!workspaceFeaturesMap.has(feature.workspaceId)) {
      workspaceFeaturesMap.set(feature.workspaceId, []);
    }
    workspaceFeaturesMap.get(feature.workspaceId)!.push(feature);
  }

  for (const workspace of workspaces) {
    const workspaceFeatures = workspaceFeaturesMap.get(workspace.id) || [];
    
    if (workspaceFeatures.length > 0) {
      // Create first feature-linked whiteboard with microservices architecture (20 elements)
      const mediumElements = [
        // Microservices architecture diagram with 20 elements
        {
          id: "service-1",
          type: "rectangle",
          x: 100,
          y: 50,
          width: 150,
          height: 100,
          angle: 0,
          strokeColor: "#1971c2",
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20001,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
        },
        {
          id: "label-1",
          type: "text",
          x: 115,
          y: 80,
          width: 120,
          height: 25,
          angle: 0,
          strokeColor: "#1971c2",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20002,
          version: 1,
          versionNonce: 2,
          isDeleted: false,
          text: "User Service",
          fontSize: 16,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "service-2",
          type: "rectangle",
          x: 300,
          y: 50,
          width: 150,
          height: 100,
          angle: 0,
          strokeColor: "#2f9e44",
          backgroundColor: "#b2f2bb",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20003,
          version: 1,
          versionNonce: 3,
          isDeleted: false,
        },
        {
          id: "label-2",
          type: "text",
          x: 315,
          y: 80,
          width: 120,
          height: 25,
          angle: 0,
          strokeColor: "#2f9e44",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20004,
          version: 1,
          versionNonce: 4,
          isDeleted: false,
          text: "Order Service",
          fontSize: 16,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "service-3",
          type: "rectangle",
          x: 500,
          y: 50,
          width: 150,
          height: 100,
          angle: 0,
          strokeColor: "#c92a2a",
          backgroundColor: "#ffc9c9",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20005,
          version: 1,
          versionNonce: 5,
          isDeleted: false,
        },
        {
          id: "label-3",
          type: "text",
          x: 515,
          y: 80,
          width: 120,
          height: 25,
          angle: 0,
          strokeColor: "#c92a2a",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20006,
          version: 1,
          versionNonce: 6,
          isDeleted: false,
          text: "Payment Service",
          fontSize: 16,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "database-1",
          type: "diamond",
          x: 125,
          y: 250,
          width: 100,
          height: 100,
          angle: 0,
          strokeColor: "#1971c2",
          backgroundColor: "#d0ebff",
          fillStyle: "hachure",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20007,
          version: 1,
          versionNonce: 7,
          isDeleted: false,
        },
        {
          id: "db-label-1",
          type: "text",
          x: 145,
          y: 285,
          width: 60,
          height: 20,
          angle: 0,
          strokeColor: "#1971c2",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20008,
          version: 1,
          versionNonce: 8,
          isDeleted: false,
          text: "Users DB",
          fontSize: 14,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "database-2",
          type: "diamond",
          x: 325,
          y: 250,
          width: 100,
          height: 100,
          angle: 0,
          strokeColor: "#2f9e44",
          backgroundColor: "#d3f9d8",
          fillStyle: "hachure",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20009,
          version: 1,
          versionNonce: 9,
          isDeleted: false,
        },
        {
          id: "db-label-2",
          type: "text",
          x: 340,
          y: 285,
          width: 70,
          height: 20,
          angle: 0,
          strokeColor: "#2f9e44",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20010,
          version: 1,
          versionNonce: 10,
          isDeleted: false,
          text: "Orders DB",
          fontSize: 14,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "arrow-1",
          type: "arrow",
          x: 175,
          y: 150,
          width: 0,
          height: 100,
          angle: 0,
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20011,
          version: 1,
          versionNonce: 11,
          isDeleted: false,
          points: [
            [0, 0],
            [0, 100],
          ],
          lastCommittedPoint: [0, 100],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        },
        {
          id: "arrow-2",
          type: "arrow",
          x: 375,
          y: 150,
          width: 0,
          height: 100,
          angle: 0,
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20012,
          version: 1,
          versionNonce: 12,
          isDeleted: false,
          points: [
            [0, 0],
            [0, 100],
          ],
          lastCommittedPoint: [0, 100],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        },
        {
          id: "api-gateway",
          type: "rectangle",
          x: 275,
          y: 450,
          width: 200,
          height: 80,
          angle: 0,
          strokeColor: "#862e9c",
          backgroundColor: "#e9d8fd",
          fillStyle: "solid",
          strokeWidth: 3,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20013,
          version: 1,
          versionNonce: 13,
          isDeleted: false,
        },
        {
          id: "gateway-label",
          type: "text",
          x: 300,
          y: 475,
          width: 150,
          height: 25,
          angle: 0,
          strokeColor: "#862e9c",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20014,
          version: 1,
          versionNonce: 14,
          isDeleted: false,
          text: "API Gateway",
          fontSize: 18,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
        },
        {
          id: "arrow-gateway-1",
          type: "arrow",
          x: 250,
          y: 150,
          width: 75,
          height: 295,
          angle: 0,
          strokeColor: "#495057",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20015,
          version: 1,
          versionNonce: 15,
          isDeleted: false,
          points: [
            [0, 0],
            [75, 295],
          ],
          lastCommittedPoint: [75, 295],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        },
        {
          id: "arrow-gateway-2",
          type: "arrow",
          x: 375,
          y: 150,
          width: 0,
          height: 295,
          angle: 0,
          strokeColor: "#495057",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20016,
          version: 1,
          versionNonce: 16,
          isDeleted: false,
          points: [
            [0, 0],
            [0, 295],
          ],
          lastCommittedPoint: [0, 295],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        },
        {
          id: "arrow-gateway-3",
          type: "arrow",
          x: 500,
          y: 150,
          width: -75,
          height: 295,
          angle: 0,
          strokeColor: "#495057",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness: 1,
          opacity: 100,
          groupIds: [],
          seed: 20017,
          version: 1,
          versionNonce: 17,
          isDeleted: false,
          points: [
            [0, 0],
            [-75, 295],
          ],
          lastCommittedPoint: [-75, 295],
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: "arrow",
        },
      ];

      await prisma.whiteboard.create({
        data: {
          name: `${workspaceFeatures[0].title} - Planning`,
          workspaceId: workspace.id,
          featureId: workspaceFeatures[0].id,
          elements: mediumElements,
          appState: { viewBackgroundColor: "#fafafa", gridSize: 20 },
          files: {},
        },
      });
      totalWhiteboards++;
      featureWhiteboards++;

      // Create second feature-linked whiteboard if we have 2+ features
      if (workspaceFeatures.length > 1) {
        await prisma.whiteboard.create({
          data: {
            name: `${workspaceFeatures[1].title} - Flow Diagram`,
            workspaceId: workspace.id,
            featureId: workspaceFeatures[1].id,
            elements: [
              {
                id: "start",
                type: "ellipse",
                x: 350,
                y: 50,
                width: 100,
                height: 60,
                angle: 0,
                strokeColor: "#2f9e44",
                backgroundColor: "#d3f9d8",
                fillStyle: "solid",
                strokeWidth: 2,
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: 30001,
                version: 1,
                versionNonce: 1,
                isDeleted: false,
              },
              {
                id: "start-text",
                type: "text",
                x: 375,
                y: 70,
                width: 50,
                height: 20,
                angle: 0,
                strokeColor: "#2f9e44",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 2,
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: 30002,
                version: 1,
                versionNonce: 2,
                isDeleted: false,
                text: "Start",
                fontSize: 16,
                fontFamily: 1,
                textAlign: "center",
                verticalAlign: "middle",
              },
              {
                id: "process-1",
                type: "rectangle",
                x: 325,
                y: 150,
                width: 150,
                height: 80,
                angle: 0,
                strokeColor: "#1971c2",
                backgroundColor: "#a5d8ff",
                fillStyle: "solid",
                strokeWidth: 2,
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: 30003,
                version: 1,
                versionNonce: 3,
                isDeleted: false,
              },
              {
                id: "process-1-text",
                type: "text",
                x: 345,
                y: 175,
                width: 110,
                height: 25,
                angle: 0,
                strokeColor: "#1971c2",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 2,
                roughness: 1,
                opacity: 100,
                groupIds: [],
                seed: 30004,
                version: 1,
                versionNonce: 4,
                isDeleted: false,
                text: "Authenticate",
                fontSize: 16,
                fontFamily: 1,
                textAlign: "center",
                verticalAlign: "middle",
              },
            ],
            appState: { viewBackgroundColor: "#f8f9fa", gridSize: 10 },
            files: {},
          },
        });
        totalWhiteboards++;
        featureWhiteboards++;
      }
    }
  }

  console.log(`✓ Created ${totalWhiteboards} whiteboards (${featureWhiteboards} feature-linked) across ${workspaces.length} workspaces`);
}

async function main() {
  await prisma.$connect();

  const users = await seedUsersWithAccounts();
  await seedWorkspacesAndSwarms(users);
  await seedTasksWithLayerTypes(users);
  await seedFeaturesWithStakworkRuns(users);
  await seedWhiteboards(users);

  console.log("Seed completed.");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as seedDatabase };

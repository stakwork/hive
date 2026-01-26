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

async function main() {
  await prisma.$connect();

  const users = await seedUsersWithAccounts();
  await seedWorkspacesAndSwarms(users);
  await seedTasksWithLayerTypes(users);
  await seedFeaturesWithStakworkRuns(users);

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

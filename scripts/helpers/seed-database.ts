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

/**
 * Seed features with auto-merge test scenarios
 * 
 * Creates two features with sequential task chains to test:
 * - Full auto-merge workflow (all tasks auto-merge enabled)
 * - Mixed auto-merge workflow (some tasks require manual merge)
 * - Task dependency chains
 * - Coordinator behavior with sequential tasks
 * - UI badge display for various PR states
 */
async function seedAutoMergeFeatures(
  users: Array<{ id: string; email: string }>,
) {
  const workspace = await prisma.workspace.findFirst({
    where: { name: "Alpha Workspace" },
  });
  if (!workspace) {
    console.log("⚠ No workspace found for auto-merge seeding");
    return;
  }

  const userId = users[0].id; // Alice

  console.log("\n=== Seeding Auto-Merge Test Scenarios ===");

  // Feature A: Payment Integration - All tasks with autoMerge: true
  console.log("Creating Feature A: Payment Integration (all auto-merge)...");
  const featureA = await prisma.feature.create({
    data: {
      title: "Payment Integration",
      brief: "Add Stripe payment processing with sequential task chain",
      status: "IN_PROGRESS",
      priority: "HIGH",
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
      phases: {
        create: {
          name: "Implementation Phase",
          description: "Sequential implementation of payment features",
          status: "IN_PROGRESS",
          order: 0,
        },
      },
    },
    include: {
      phases: true,
    },
  });

  const phaseA = featureA.phases[0];

  // Task A1: Add payment API endpoints (no dependencies)
  const taskA1 = await prisma.task.create({
    data: {
      title: "Add payment API endpoints",
      description:
        "Create REST API endpoints for payment processing including charge, refund, and webhook handlers. This is the foundation for the payment system.",
      workspaceId: workspace.id,
      featureId: featureA.id,
      phaseId: phaseA.id,
      status: "TODO",
      priority: "HIGH",
      autoMerge: true,
      order: 0,
      dependsOnTaskIds: [],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Task A2: Implement payment UI components (depends on A1)
  const taskA2 = await prisma.task.create({
    data: {
      title: "Implement payment UI components",
      description:
        "Build React components for payment form, card input, and payment status display. Requires API endpoints to be completed first.",
      workspaceId: workspace.id,
      featureId: featureA.id,
      phaseId: phaseA.id,
      status: "TODO",
      priority: "HIGH",
      autoMerge: true,
      order: 1,
      dependsOnTaskIds: [taskA1.id],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Task A3: Add payment confirmation flow (depends on A2)
  const taskA3 = await prisma.task.create({
    data: {
      title: "Add payment confirmation flow",
      description:
        "Implement confirmation emails, success/failure pages, and receipt generation. Requires UI components to be completed.",
      workspaceId: workspace.id,
      featureId: featureA.id,
      phaseId: phaseA.id,
      status: "TODO",
      priority: "MEDIUM",
      autoMerge: true,
      order: 2,
      dependsOnTaskIds: [taskA2.id],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  console.log(
    `✓ Created Feature A with 3 tasks (all autoMerge: true, sequential dependencies)`,
  );

  // Feature B: User Profile Enhancement - Mixed auto-merge settings
  console.log(
    "\nCreating Feature B: User Profile Enhancement (mixed auto-merge)...",
  );
  const featureB = await prisma.feature.create({
    data: {
      title: "User Profile Enhancement",
      brief: "Enhance user profile with schema updates, edit UI, and avatar support",
      status: "PLANNED",
      priority: "MEDIUM",
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
      phases: {
        create: {
          name: "Profile Improvement Phase",
          description: "Mixed auto-merge workflow for testing manual review steps",
          status: "NOT_STARTED",
          order: 0,
        },
      },
    },
    include: {
      phases: true,
    },
  });

  const phaseB = featureB.phases[0];

  // Task B1: Update profile schema (auto-merge, no dependencies)
  const taskB1 = await prisma.task.create({
    data: {
      title: "Update profile schema",
      description:
        "Add new fields to user profile schema: bio, location, website, social links. Database migration is low-risk.",
      workspaceId: workspace.id,
      featureId: featureB.id,
      phaseId: phaseB.id,
      status: "TODO",
      priority: "HIGH",
      autoMerge: true,
      order: 0,
      dependsOnTaskIds: [],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Task B2: Add profile edit UI (manual merge, depends on B1)
  const taskB2 = await prisma.task.create({
    data: {
      title: "Add profile edit UI",
      description:
        "Create profile editing interface with form validation and real-time preview. Requires manual review due to UX complexity.",
      workspaceId: workspace.id,
      featureId: featureB.id,
      phaseId: phaseB.id,
      status: "TODO",
      priority: "HIGH",
      autoMerge: false, // Manual merge required
      order: 1,
      dependsOnTaskIds: [taskB1.id],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Task B3: Add avatar upload (auto-merge, depends on B2)
  const taskB3 = await prisma.task.create({
    data: {
      title: "Add avatar upload",
      description:
        "Implement avatar upload with image cropping, S3 storage, and thumbnail generation. Low-risk addition.",
      workspaceId: workspace.id,
      featureId: featureB.id,
      phaseId: phaseB.id,
      status: "TODO",
      priority: "MEDIUM",
      autoMerge: true,
      order: 2,
      dependsOnTaskIds: [taskB2.id],
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  console.log(
    `✓ Created Feature B with 3 tasks (mixed autoMerge: 2 true, 1 false, sequential dependencies)`,
  );

  // Edge Case Tasks: Test various auto-merge scenarios
  console.log("\nCreating edge case tasks for auto-merge testing...");

  // Edge Case 1: Task with autoMerge and IN_PROGRESS status
  // (Once PR is created, badge should show)
  const edgeTask1 = await prisma.task.create({
    data: {
      title: "Edge Case: Auto-merge ready for PR",
      description:
        "Task with auto-merge enabled, ready for PR creation. Once PR artifact is added, badge should display.",
      workspaceId: workspace.id,
      status: "IN_PROGRESS",
      priority: "LOW",
      autoMerge: true,
      workflowStatus: "IN_PROGRESS",
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Edge Case 2: Task with autoMerge and DONE status
  // (Simulates completed auto-merge workflow)
  const edgeTask2 = await prisma.task.create({
    data: {
      title: "Edge Case: Auto-merge completed",
      description:
        "Task with auto-merge that has been completed. Badge should not show on completed tasks.",
      workspaceId: workspace.id,
      status: "DONE",
      priority: "LOW",
      autoMerge: true,
      workflowStatus: "COMPLETED",
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Edge Case 3: Task with manual merge (autoMerge: false)
  const edgeTask3 = await prisma.task.create({
    data: {
      title: "Edge Case: Manual merge workflow",
      description:
        "Task with auto-merge disabled - requires manual PR review and merge.",
      workspaceId: workspace.id,
      status: "IN_PROGRESS",
      priority: "LOW",
      autoMerge: false,
      workflowStatus: "IN_PROGRESS",
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Edge Case 4: Task with autoMerge, TODO status, workflow PENDING
  // (Coordinator should pick this up and start workflow)
  await prisma.task.create({
    data: {
      title: "Edge Case: Auto-merge pending coordinator",
      description:
        "Task with auto-merge enabled waiting for coordinator to start workflow. Tests coordinator detection.",
      workspaceId: workspace.id,
      status: "TODO",
      priority: "MEDIUM",
      autoMerge: true,
      workflowStatus: "PENDING",
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Edge Case 5: Task with autoMerge and BLOCKED status
  // (Tests that auto-merge respects task state)
  await prisma.task.create({
    data: {
      title: "Edge Case: Auto-merge blocked task",
      description:
        "Task with auto-merge enabled but blocked status. Workflow should not proceed until unblocked.",
      workspaceId: workspace.id,
      status: "BLOCKED",
      priority: "HIGH",
      autoMerge: true,
      workflowStatus: "PENDING",
      systemAssigneeType: "TASK_COORDINATOR",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Create PR artifacts for edge cases to test badge display
  // Note: Artifacts require a chat message, so we create message + artifact

  // PR for edge case 1: Open PR with auto-merge (should show badge)
  const message1 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask1.id,
      message: "Created PR for auto-merge testing",
      role: "ASSISTANT",
      userId: userId,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: message1.id,
      type: "PULL_REQUEST",
      content: {
        prNumber: 123,
        title: "Test PR for auto-merge badge",
        url: "https://github.com/test/repo/pull/123",
        status: "IN_PROGRESS",
      },
    },
  });

  // PR for edge case 2: Merged PR (should NOT show badge)
  const message2 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask2.id,
      message: "PR merged successfully",
      role: "ASSISTANT",
      userId: userId,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: message2.id,
      type: "PULL_REQUEST",
      content: {
        prNumber: 124,
        title: "Merged PR - no badge expected",
        url: "https://github.com/test/repo/pull/124",
        status: "DONE",
        mergedAt: new Date().toISOString(),
      },
    },
  });

  // PR for edge case 3: Manual merge with open PR
  const message3 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask3.id,
      message: "Created PR for manual merge workflow",
      role: "ASSISTANT",
      userId: userId,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: message3.id,
      type: "PULL_REQUEST",
      content: {
        prNumber: 125,
        title: "Manual merge workflow PR",
        url: "https://github.com/test/repo/pull/125",
        status: "IN_PROGRESS",
      },
    },
  });

  console.log(`✓ Created 5 edge case tasks for auto-merge testing`);

  console.log("\n=== Auto-Merge Seeding Summary ===");
  console.log("Features created: 2");
  console.log("  - Payment Integration: 3 tasks, all autoMerge: true, sequential chain");
  console.log("  - User Profile Enhancement: 3 tasks, mixed autoMerge (2 true, 1 false), sequential chain");
  console.log("Edge case tasks: 5");
  console.log("  - Auto-merge ready for PR (IN_PROGRESS, autoMerge: true)");
  console.log("  - Auto-merge completed (DONE, autoMerge: true)");
  console.log("  - Manual merge workflow (IN_PROGRESS, autoMerge: false)");
  console.log("  - Pending coordinator (TODO, autoMerge: true, workflow PENDING)");
  console.log("  - Blocked task (BLOCKED, autoMerge: true)");
  console.log("\nTotal tasks with autoMerge=true: 9");
  console.log("Total tasks with autoMerge=false: 2");
  console.log("Total dependency chains: 2 (3 tasks each)");
}

async function main() {
  await prisma.$connect();

  const users = await seedUsersWithAccounts();
  await seedWorkspacesAndSwarms(users);
  await seedTasksWithLayerTypes(users);
  await seedFeaturesWithStakworkRuns(users);
  await seedAutoMergeFeatures(users);

  console.log("\n✓ Seed completed successfully.");
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

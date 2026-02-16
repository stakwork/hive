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
import { seedDeploymentTracking } from "./seed-deployment-tracking";

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

  // Helper to create dates relative to now
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  // Scenario 1: Old pending + newer accepted ARCHITECTURE run
  // Should NOT show indicator (latest is accepted)
  const feature1 = await prisma.feature.create({
    data: {
      title: "Sequential Test: Old Pending → New Accepted",
      brief: "Test case: older ARCHITECTURE run pending, newer ARCHITECTURE run accepted",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
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

  // Old pending run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature1.id}/old`,
      type: StakworkRunType.ARCHITECTURE,
      featureId: feature1.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        architecture: "Old architecture proposal that was never reviewed",
        components: ["ComponentA", "ComponentB"]
      }),
      dataType: "json",
      decision: null,
      createdAt: threeDaysAgo,
    },
  });

  // Newer accepted run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature1.id}/new`,
      type: StakworkRunType.ARCHITECTURE,
      featureId: feature1.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        architecture: "Updated architecture proposal (auto-accepted)",
        components: ["ComponentX", "ComponentY", "ComponentZ"]
      }),
      dataType: "json",
      decision: "ACCEPTED",
      autoAccept: true,
      createdAt: oneDayAgo,
    },
  });

  // Scenario 2: Old accepted + newer pending REQUIREMENTS run
  // Should show indicator (latest is pending)
  const feature2 = await prisma.feature.create({
    data: {
      title: "Sequential Test: Old Accepted → New Pending",
      brief: "Test case: older REQUIREMENTS run accepted, newer REQUIREMENTS run pending",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
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

  // Old accepted run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature2.id}/old`,
      type: StakworkRunType.REQUIREMENTS,
      featureId: feature2.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        requirements: ["Req1", "Req2", "Req3"],
        functionalRequirements: "Initial requirements that were accepted"
      }),
      dataType: "json",
      decision: "ACCEPTED",
      createdAt: twoDaysAgo,
    },
  });

  // Newer pending run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature2.id}/new`,
      type: StakworkRunType.REQUIREMENTS,
      featureId: feature2.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        requirements: ["Req1", "Req2", "Req3", "Req4", "Req5"],
        functionalRequirements: "Updated requirements with additional items - needs review"
      }),
      dataType: "json",
      decision: null,
      createdAt: now,
    },
  });

  // Scenario 3: Mixed types with different states
  // ARCHITECTURE: accepted (latest), REQUIREMENTS: pending (latest), 
  // TASK_GENERATION: old pending + newer accepted
  // Should only show indicator for REQUIREMENTS
  const feature3 = await prisma.feature.create({
    data: {
      title: "Mixed Sequential Test: Multiple Run Types",
      brief: "Test case: mixed run types with different decision states to test per-type logic",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
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

  // ARCHITECTURE - latest is accepted
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature3.id}/arch`,
      type: StakworkRunType.ARCHITECTURE,
      featureId: feature3.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        architecture: "Architecture design (accepted)",
        patterns: ["MVC", "Repository", "Factory"]
      }),
      dataType: "json",
      decision: "ACCEPTED",
      autoAccept: true,
      createdAt: oneDayAgo,
    },
  });

  // REQUIREMENTS - latest is pending (should show indicator)
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature3.id}/req`,
      type: StakworkRunType.REQUIREMENTS,
      featureId: feature3.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        requirements: ["Critical Req1", "Critical Req2"],
        functionalRequirements: "Requirements analysis needs review"
      }),
      dataType: "json",
      decision: null,
      createdAt: now,
    },
  });

  // TASK_GENERATION - old pending run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature3.id}/tasks-old`,
      type: StakworkRunType.TASK_GENERATION,
      featureId: feature3.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        tasks: [
          { title: "Task 1", description: "Old task breakdown" },
          { title: "Task 2", description: "Another old task" }
        ]
      }),
      dataType: "json",
      decision: null,
      createdAt: threeDaysAgo,
    },
  });

  // TASK_GENERATION - newer accepted run
  await prisma.stakworkRun.create({
    data: {
      webhookUrl: `https://example.com/webhook/${feature3.id}/tasks-new`,
      type: StakworkRunType.TASK_GENERATION,
      featureId: feature3.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({ 
        tasks: [
          { title: "Updated Task 1", description: "Refined task breakdown" },
          { title: "Updated Task 2", description: "Another refined task" },
          { title: "New Task 3", description: "Additional task" }
        ]
      }),
      dataType: "json",
      decision: "ACCEPTED",
      autoAccept: true,
      createdAt: oneDayAgo,
    },
  });

  // Keep existing simple features for backward compatibility
  const simpleFeatures = [
    {
      title: "User Authentication System",
      brief: "Implement user authentication with OAuth",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
      needsAttention: true,
    },
    {
      title: "Dashboard Analytics",
      brief: "Build analytics dashboard with charts",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
      needsAttention: true,
    },
    {
      title: "Notification Service",
      brief: "Real-time notifications via websockets",
      status: FeatureStatus.BACKLOG,
      priority: FeaturePriority.LOW,
      needsAttention: false,
    },
  ];

  for (const featureData of simpleFeatures) {
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
          decision: null,
        },
      });
    } else {
      await prisma.stakworkRun.create({
        data: {
          webhookUrl: `https://example.com/webhook/${feature.id}`,
          type: StakworkRunType.ARCHITECTURE,
          featureId: feature.id,
          workspaceId: workspace.id,
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({ generated: "Sample accepted content" }),
          dataType: "json",
          decision: "ACCEPTED",
        },
      });
    }
  }

  console.log(`✓ Created 3 sequential test features with multiple runs per type`);
  console.log(`✓ Created ${simpleFeatures.length} simple features with StakworkRuns`);
}

/**
 * Seeds auto-merge test scenarios for testing multi-task feature chains,
 * coordinator behavior, and UI display. Creates features with varied
 * auto-merge settings and dependency chains.
 */
export async function seedAutoMergeTestScenarios(
  users?: Array<{ id: string; email: string }>,
) {
  const workspaces = await prisma.workspace.findMany();
  if (workspaces.length === 0) {
    console.log("No workspaces found, skipping auto-merge test seeding");
    return;
  }

  const workspace = workspaces[0];
  
  // Get or use provided users
  const seedUsers = users || await prisma.user.findMany({ take: 1 });
  if (seedUsers.length === 0) {
    console.log("No users found, skipping auto-merge test seeding");
    return;
  }
  const userId = seedUsers[0].id;

  // Find or create system user for task-coordinator
  let systemUser = await prisma.user.findFirst({
    where: { email: "system:task-coordinator@hive.local" },
  });

  if (!systemUser) {
    systemUser = await prisma.user.create({
      data: {
        email: "system:task-coordinator@hive.local",
        name: "Task Coordinator",
        image: null,
      },
    });
  }

  console.log("Creating auto-merge test features...");

  // FEATURE A: Payment Integration - All tasks with autoMerge: true
  // Sequential dependency chain to test coordinator auto-progression
  const paymentFeature = await prisma.feature.create({
    data: {
      title: "Payment Integration",
      brief: "End-to-end payment processing system",
      status: "IN_PROGRESS",
      priority: Priority.HIGH,
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
    },
  });

  const paymentPhase = await prisma.phase.create({
    data: {
      name: "Implementation",
      featureId: paymentFeature.id,
      order: 0,
    },
  });

  // Task 1: Add payment API endpoints (no dependencies)
  const paymentTask1 = await prisma.task.create({
    data: {
      title: "Add payment API endpoints",
      description:
        "Create REST API endpoints for payment processing: POST /api/payments/process, GET /api/payments/:id, POST /api/payments/refund. Include validation, error handling, and proper HTTP status codes.",
      workspaceId: workspace.id,
      featureId: paymentFeature.id,
      phaseId: paymentPhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 0,
      dependsOnTaskIds: [],
    },
  });

  // Task 2: Implement payment UI components (depends on Task 1)
  const paymentTask2 = await prisma.task.create({
    data: {
      title: "Implement payment UI components",
      description:
        "Build React components for payment form with card input, billing address, and payment method selection. Include real-time validation and loading states.",
      workspaceId: workspace.id,
      featureId: paymentFeature.id,
      phaseId: paymentPhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 1,
      dependsOnTaskIds: [paymentTask1.id],
    },
  });

  // Task 3: Add payment confirmation flow (depends on Task 2)
  const paymentTask3 = await prisma.task.create({
    data: {
      title: "Add payment confirmation flow",
      description:
        "Implement post-payment confirmation page with receipt display, email confirmation trigger, and order summary. Add success/failure handling.",
      workspaceId: workspace.id,
      featureId: paymentFeature.id,
      phaseId: paymentPhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 2,
      dependsOnTaskIds: [paymentTask2.id],
    },
  });

  console.log(
    `✓ Created Feature A: Payment Integration with 3 sequential autoMerge tasks`,
  );

  // FEATURE B: User Profile Enhancement - Mixed auto-merge settings
  // Tests coordinator handling of manual intervention mid-chain
  const profileFeature = await prisma.feature.create({
    data: {
      title: "User Profile Enhancement",
      brief: "Improve user profile management and customization",
      status: "IN_PROGRESS",
      priority: Priority.MEDIUM,
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
    },
  });

  const profilePhase = await prisma.phase.create({
    data: {
      name: "Development",
      featureId: profileFeature.id,
      order: 0,
    },
  });

  // Task 1: Update profile schema - autoMerge: true (no dependencies)
  const profileTask1 = await prisma.task.create({
    data: {
      title: "Update profile schema",
      description:
        "Add new fields to User model: bio (text), location (string), website (url), socialLinks (json). Create Prisma migration and update TypeScript types.",
      workspaceId: workspace.id,
      featureId: profileFeature.id,
      phaseId: profilePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 0,
      dependsOnTaskIds: [],
    },
  });

  // Task 2: Add profile edit UI - autoMerge: false (depends on Task 1)
  // Manual review required for UI changes
  const profileTask2 = await prisma.task.create({
    data: {
      title: "Add profile edit UI",
      description:
        "Create profile editing form with all new fields. Include client-side validation, autosave functionality, and preview mode. Requires design review before merge.",
      workspaceId: workspace.id,
      featureId: profileFeature.id,
      phaseId: profilePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      sourceType: "SYSTEM",
      autoMerge: false, // Manual merge for UI review
      order: 1,
      dependsOnTaskIds: [profileTask1.id],
    },
  });

  // Task 3: Add avatar upload - autoMerge: true (depends on Task 2)
  const profileTask3 = await prisma.task.create({
    data: {
      title: "Add avatar upload",
      description:
        "Implement avatar image upload with S3 integration, image resizing/cropping, and fallback to initials. Max file size 5MB, support JPG/PNG/WebP.",
      workspaceId: workspace.id,
      featureId: profileFeature.id,
      phaseId: profilePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.TODO,
      priority: Priority.LOW,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 2,
      dependsOnTaskIds: [profileTask2.id],
    },
  });

  console.log(
    `✓ Created Feature B: User Profile Enhancement with mixed autoMerge settings`,
  );

  // EDGE CASE TASKS: Various PR artifact states for UI testing
  const edgeCaseFeature = await prisma.feature.create({
    data: {
      title: "Edge Case Testing Feature",
      brief: "Tasks with various auto-merge and PR states for testing",
      status: "IN_PROGRESS",
      priority: Priority.LOW,
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
    },
  });

  const edgeCasePhase = await prisma.phase.create({
    data: {
      name: "Testing",
      featureId: edgeCaseFeature.id,
      order: 0,
    },
  });

  // Edge Case 1: autoMerge with open PR (should show badge)
  const edgeTask1 = await prisma.task.create({
    data: {
      title: "Task with open PR and auto-merge",
      description: "Test auto-merge badge display with IN_PROGRESS PR artifact",
      workspaceId: workspace.id,
      featureId: edgeCaseFeature.id,
      phaseId: edgeCasePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.LOW,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 0,
    },
  });

  const edgeMessage1 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask1.id,
      message: "Created PR with auto-merge enabled",
      role: "ASSISTANT",
      userId: systemUser.id,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: edgeMessage1.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/test/repo/pull/101",
        number: 101,
        title: "Add feature with auto-merge",
        status: "IN_PROGRESS",
        autoMergeEnabled: true,
        merge_commit_sha: "a1b2c3d4e5f6789012345678901234567890abcd",
      },
    },
  });

  // Edge Case 2: autoMerge with merged PR (should NOT show badge)
  const edgeTask2 = await prisma.task.create({
    data: {
      title: "Task with merged PR and auto-merge",
      description: "Test that badge doesn't show for already merged PRs",
      workspaceId: workspace.id,
      featureId: edgeCaseFeature.id,
      phaseId: edgeCasePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.DONE,
      priority: Priority.LOW,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 1,
    },
  });

  const edgeMessage2 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask2.id,
      message: "PR merged successfully",
      role: "ASSISTANT",
      userId: systemUser.id,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: edgeMessage2.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/test/repo/pull/102",
        number: 102,
        title: "Completed feature",
        status: "DONE",
        mergedAt: new Date().toISOString(),
        merge_commit_sha: "b2c3d4e5f67890123456789012345678901abcde",
      },
    },
  });

  // Edge Case 3: Manual merge workflow (autoMerge: false with PR)
  const edgeTask3 = await prisma.task.create({
    data: {
      title: "Task with manual merge required",
      description: "Test manual merge workflow with autoMerge disabled",
      workspaceId: workspace.id,
      featureId: edgeCaseFeature.id,
      phaseId: edgeCasePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.LOW,
      sourceType: "SYSTEM",
      autoMerge: false,
      order: 2,
    },
  });

  const edgeMessage3 = await prisma.chatMessage.create({
    data: {
      taskId: edgeTask3.id,
      message: "Created PR requiring manual review",
      role: "ASSISTANT",
      userId: systemUser.id,
    },
  });

  await prisma.artifact.create({
    data: {
      messageId: edgeMessage3.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/test/repo/pull/103",
        number: 103,
        title: "Feature requiring manual review",
        status: "IN_PROGRESS",
        autoMergeEnabled: false,
        merge_commit_sha: "c3d4e5f678901234567890123456789012abcdef",
      },
    },
  });

  // Edge Case 4: Coordinator handling (autoMerge with PENDING workflow)
  const edgeTask4 = await prisma.task.create({
    data: {
      title: "Task awaiting coordinator processing",
      description:
        "Test coordinator picks up task with auto-merge and pending workflow",
      workspaceId: workspace.id,
      featureId: edgeCaseFeature.id,
      phaseId: edgeCasePhase.id,
      createdById: userId,
      updatedById: userId,
      systemAssigneeType: "TASK_COORDINATOR",
      status: TaskStatus.IN_PROGRESS,
      workflowStatus: "PENDING",
      priority: Priority.MEDIUM,
      sourceType: "SYSTEM",
      autoMerge: true,
      order: 3,
    },
  });

  console.log(`✓ Created 4 edge case tasks with PR artifacts`);
  console.log(
    `\n✓ Auto-merge test data seeding complete:\n  - 2 features with dependency chains\n  - 6 core tasks (4 with autoMerge: true, 2 with autoMerge: false)\n  - 4 edge case tasks with PR artifacts\n  - Total: 10 tasks for comprehensive testing`,
  );
}

async function main() {
  await prisma.$connect();

  const users = await seedUsersWithAccounts();
  await seedWorkspacesAndSwarms(users);
  await seedTasksWithLayerTypes(users);
  await seedFeaturesWithStakworkRuns(users);
  await seedAutoMergeTestScenarios(users);
  await seedDeploymentTracking();

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

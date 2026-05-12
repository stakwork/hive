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
  WorkspaceRole,
  InitiativeStatus,
  MilestoneStatus,
} from "@prisma/client";
import { config as dotenvConfig } from "dotenv";
import { seedDeploymentTracking } from "./seed-deployment-tracking";
import { seedAgentLogs } from "./seed-agent-logs";

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

    // Add the owner as a workspace member with OWNER role
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: ws.id,
          userId: item.owner.id,
        },
      },
      update: { role: WorkspaceRole.OWNER },
      create: {
        workspaceId: ws.id,
        userId: item.owner.id,
        role: WorkspaceRole.OWNER,
      },
    });

    // Add the dev-mock user as a DEVELOPER in all workspaces
    const devUser = users.find((u) => u.email === "dev-user@mock.dev");
    if (devUser && devUser.id !== item.owner.id) {
      await prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: ws.id,
            userId: devUser.id,
          },
        },
        update: {},
        create: {
          workspaceId: ws.id,
          userId: devUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });
    }

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

async function seedDashboardConversations(
  users: Array<{ id: string; email: string }>,
) {
  // Find the alpha workspace to seed conversations into
  const workspace = await prisma.workspace.findFirst({
    where: { slug: "alpha-workspace" },
    select: { id: true },
  });

  if (!workspace) {
    console.log("⚠ alpha-workspace not found, skipping dashboard conversation seed");
    return;
  }

  // Check if any dashboard conversations already exist
  const existing = await prisma.sharedConversation.count({
    where: { workspaceId: workspace.id, source: "dashboard" },
  });

  if (existing > 0) {
    console.log(`✓ Dashboard conversations already seeded (${existing} found)`);
    return;
  }

  const now = new Date();
  const minus1h = new Date(now.getTime() - 60 * 60 * 1000);
  const minus3h = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const minus1d = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const conversations = [
    {
      userId: users[0].id,
      title: "How does the authentication flow work?",
      messages: [
        { role: "user", content: "How does the authentication flow work?", createdAt: now.toISOString() },
        { role: "assistant", content: "The authentication flow uses NextAuth.js with GitHub OAuth...", createdAt: now.toISOString() },
      ],
      lastMessageAt: now,
    },
    {
      userId: users[1].id,
      title: "What are the main database models?",
      messages: [
        { role: "user", content: "What are the main database models?", createdAt: minus1h.toISOString() },
        { role: "assistant", content: "The main models are Workspace, User, Task, Feature...", createdAt: minus1h.toISOString() },
      ],
      lastMessageAt: minus1h,
    },
    {
      userId: users[0].id,
      title: "How do janitor cron jobs work?",
      messages: [
        { role: "user", content: "How do janitor cron jobs work?", createdAt: minus3h.toISOString() },
        { role: "assistant", content: "Janitor cron jobs run on a schedule defined in vercel.json...", createdAt: minus3h.toISOString() },
      ],
      lastMessageAt: minus3h,
    },
    {
      userId: users[1].id,
      title: "Explain the permission system",
      messages: [
        { role: "user", content: "Explain the permission system", createdAt: minus1d.toISOString() },
        { role: "assistant", content: "The permission system uses role-based access control with roles: OWNER, ADMIN, PM, DEVELOPER, STAKEHOLDER, VIEWER...", createdAt: minus1d.toISOString() },
      ],
      lastMessageAt: minus1d,
    },
  ];

  for (const conv of conversations) {
    await prisma.sharedConversation.create({
      data: {
        workspaceId: workspace.id,
        userId: conv.userId,
        title: conv.title,
        messages: conv.messages as any,
        followUpQuestions: [],
        isShared: false,
        source: "dashboard",
        lastMessageAt: conv.lastMessageAt,
      },
    });
  }

  console.log(`✓ Created 4 dashboard conversations for recent chats seeding`);
}

async function seedPlatformConfig() {
  await prisma.platformConfig.upsert({
    where: { key: 'hiveAmountUsd' },
    update: {},
    create: { key: 'hiveAmountUsd', value: '50' },
  });
  await prisma.platformConfig.upsert({
    where: { key: 'graphmindsetAmountUsd' },
    update: {},
    create: { key: 'graphmindsetAmountUsd', value: '50' },
  });
  console.log('✓ Seeded PlatformConfig: hiveAmountUsd=50, graphmindsetAmountUsd=50');
}

async function seedInitiativesAndMilestones(
  users: Array<{ id: string; email: string }>,
) {
  // Idempotent: skip if any initiatives already exist
  const existingCount = await prisma.initiative.count();
  if (existingCount > 0) {
    console.log("Initiatives already seeded, skipping.");
    return;
  }

  // Find or create a SourceControlOrg for seeding
  let org = await prisma.sourceControlOrg.findFirst();
  if (!org) {
    org = await prisma.sourceControlOrg.create({
      data: {
        githubLogin: "seed-org",
        githubInstallationId: 888001,
        name: "Seed Organization",
        type: "ORG",
      },
    });
    console.log("✓ Created seed SourceControlOrg");
  }

  const assigneeId = users[0]?.id ?? null;

  // Create 3 initiatives
  const initiative1 = await prisma.initiative.create({
    data: {
      orgId: org.id,
      name: "Q1 Platform Reliability",
      description: "Improve system reliability and reduce incident rate across all services.",
      status: InitiativeStatus.ACTIVE,
      assigneeId,
      startDate: new Date("2025-01-01"),
      targetDate: new Date("2025-03-31"),
    },
  });

  const initiative2 = await prisma.initiative.create({
    data: {
      orgId: org.id,
      name: "Mobile Launch",
      description: "Ship the first version of the mobile application to production.",
      status: InitiativeStatus.DRAFT,
      targetDate: new Date("2025-06-30"),
    },
  });

  const initiative3 = await prisma.initiative.create({
    data: {
      orgId: org.id,
      name: "Legacy Migration",
      description: "Migrate all legacy services to the new infrastructure.",
      status: InitiativeStatus.COMPLETED,
      assigneeId,
      startDate: new Date("2024-09-01"),
      targetDate: new Date("2024-12-31"),
      completedAt: new Date("2024-12-31"),
    },
  });

  // Create 4 milestones spread across initiatives
  const milestone1 = await prisma.milestone.create({
    data: {
      initiativeId: initiative1.id,
      name: "Observability Stack",
      description: "Set up centralized logging, tracing, and alerting.",
      status: MilestoneStatus.COMPLETED,
      sequence: 10,
      dueDate: new Date("2025-01-31"),
      completedAt: new Date("2025-01-28"),
      assigneeId,
    },
  });

  await prisma.milestone.create({
    data: {
      initiativeId: initiative1.id,
      name: "SLO Definitions",
      description: "Define and document SLOs for all critical services.",
      status: MilestoneStatus.IN_PROGRESS,
      sequence: 20,
      dueDate: new Date("2025-02-28"),
      assigneeId,
    },
  });

  await prisma.milestone.create({
    data: {
      initiativeId: initiative1.id,
      name: "Incident Runbooks",
      description: "Create runbooks for top 10 incident types.",
      status: MilestoneStatus.NOT_STARTED,
      sequence: 30,
      dueDate: new Date("2025-03-31"),
    },
  });

  await prisma.milestone.create({
    data: {
      initiativeId: initiative3.id,
      name: "Database Migration",
      description: "Migrate all legacy databases to managed PostgreSQL.",
      status: MilestoneStatus.COMPLETED,
      sequence: 10,
      dueDate: new Date("2024-11-30"),
      completedAt: new Date("2024-11-25"),
      assigneeId,
    },
  });

  // Link 1-2 existing features to a milestone
  const features = await prisma.feature.findMany({ take: 2, where: { deleted: false } });
  if (features.length > 0) {
    await prisma.feature.update({
      where: { id: features[0].id },
      data: { milestoneId: milestone1.id },
    });
    if (features.length > 1) {
      await prisma.feature.update({
        where: { id: features[1].id },
        data: { milestoneId: milestone1.id },
      });
    }
  }

  console.log(
    `✓ Seeded 3 initiatives, 4 milestones, linked ${Math.min(features.length, 2)} feature(s) to milestone`,
  );
}

async function seedMilestoneLinkFeatureData(
  users: Array<{ id: string; email: string }>,
) {
  const SEED_PREFIX = "[SEED]";

  // Guard against re-seeding
  const existingCount = await prisma.feature.count({
    where: { title: { startsWith: SEED_PREFIX } },
  });
  if (existingCount > 0) {
    console.log(
      `✓ Milestone link feature seed data already exists (${existingCount} features found), skipping.`,
    );
    return;
  }

  const userId = users[0].id;

  // Find the three target workspaces
  const [alphaWs, betaWs, devMockWs] = await Promise.all([
    prisma.workspace.findUnique({ where: { slug: "alpha-workspace" } }),
    prisma.workspace.findUnique({ where: { slug: "beta-workspace" } }),
    prisma.workspace.findUnique({ where: { slug: "dev-mock" } }),
  ]);

  if (!alphaWs || !betaWs || !devMockWs) {
    console.log(
      "⚠ One or more target workspaces not found, skipping milestone link feature seed.",
    );
    return;
  }

  // Find a seeded milestone to pre-link one feature
  const firstMilestone = await prisma.milestone.findFirst({
    orderBy: { sequence: "asc" },
  });

  const now = new Date();
  const weeksAgo = (weeks: number) =>
    new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);

  const featureSets: Array<{
    workspaceId: string;
    features: Array<{
      title: string;
      brief: string;
      status: FeatureStatus;
      priority: FeaturePriority;
      updatedAt: Date;
    }>;
  }> = [
    {
      workspaceId: alphaWs.id,
      features: [
        {
          title: `${SEED_PREFIX} Redesign onboarding flow`,
          brief: "Overhaul the user onboarding experience with progressive disclosure and contextual hints.",
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.HIGH,
          updatedAt: weeksAgo(1),
        },
        {
          title: `${SEED_PREFIX} Add dark mode toggle`,
          brief: "Implement system-aware dark mode with manual override stored in user preferences.",
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.MEDIUM,
          updatedAt: weeksAgo(3),
        },
        {
          title: `${SEED_PREFIX} Real-time collaboration cursors`,
          brief: "Show live presence indicators and cursors for concurrent workspace editors.",
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.LOW,
          updatedAt: weeksAgo(6),
        },
      ],
    },
    {
      workspaceId: betaWs.id,
      features: [
        {
          title: `${SEED_PREFIX} API rate limiting`,
          brief: "Enforce per-client rate limits on all public API endpoints with configurable thresholds.",
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.HIGH,
          updatedAt: weeksAgo(2),
        },
        {
          title: `${SEED_PREFIX} Webhook retry logic`,
          brief: "Implement exponential back-off retry queue for failed outbound webhook deliveries.",
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.HIGH,
          updatedAt: weeksAgo(4),
        },
        {
          title: `${SEED_PREFIX} GraphQL schema cleanup`,
          brief: "Remove deprecated fields, consolidate duplicate resolvers, and add schema linting CI step.",
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.MEDIUM,
          updatedAt: weeksAgo(7),
        },
      ],
    },
    {
      workspaceId: devMockWs.id,
      features: [
        {
          title: `${SEED_PREFIX} CI pipeline optimisation`,
          brief: "Parallelise test suites and add build caching to cut average CI runtime by 40%.",
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.MEDIUM,
          updatedAt: weeksAgo(1),
        },
        {
          title: `${SEED_PREFIX} Improve seed script coverage`,
          brief: "Extend seed helpers to cover all feature areas so local dev environments bootstrap fully.",
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.LOW,
          updatedAt: weeksAgo(5),
        },
      ],
    },
  ];

  let totalCreated = 0;
  let linkedToMilestone = false;

  for (const { workspaceId, features } of featureSets) {
    for (const featureData of features) {
      const created = await prisma.feature.create({
        data: {
          title: featureData.title,
          brief: featureData.brief,
          status: featureData.status,
          priority: featureData.priority,
          workspaceId,
          createdById: userId,
          updatedById: userId,
          // Link the first feature of the first workspace to a milestone
          ...(firstMilestone && !linkedToMilestone
            ? { milestoneId: firstMilestone.id }
            : {}),
        },
      });

      // Override updatedAt via a raw update (Prisma auto-sets updatedAt on create)
      await prisma.feature.update({
        where: { id: created.id },
        data: { updatedAt: featureData.updatedAt },
      });

      if (firstMilestone && !linkedToMilestone) {
        linkedToMilestone = true;
      }

      totalCreated++;
    }
  }

  console.log(
    `✓ Seeded ${totalCreated} features across alpha-workspace, beta-workspace, dev-mock` +
      (linkedToMilestone && firstMilestone
        ? ` (1 pre-linked to milestone "${firstMilestone.name}")`
        : ""),
  );
}

/**
 * Seed a workflow_editor task with a WorkflowTask row and a WORKFLOW chat artifact
 * into the stakwork workspace, alongside one normal repo task in the same feature.
 * Safe to call multiple times (idempotent via upsert).
 */
async function seedWorkflowTask(workspaceSlug = "stakwork") {
  // Find (or create) the workspace
  let workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, ownerId: true },
  });

  if (!workspace) {
    // Create a minimal placeholder workspace for local dev
    const owner = await prisma.user.findFirst({ select: { id: true } });
    if (!owner) {
      console.warn("[seedWorkflowTask] No users found — skipping");
      return;
    }
    workspace = await prisma.workspace.create({
      data: {
        name: "Stakwork",
        slug: workspaceSlug,
        ownerId: owner.id,
      },
      select: { id: true, ownerId: true },
    });
  }

  const userId = workspace.ownerId;

  // Create a feature to hold both tasks
  const feature = await prisma.feature.create({
    data: {
      title: "Seed: Workflow Task Demo",
      workspaceId: workspace.id,
      createdById: userId,
      updatedById: userId,
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.MEDIUM,
    },
  });

  // Create a phase inside the feature
  const phase = await prisma.phase.create({
    data: {
      name: "Phase 1",
      featureId: feature.id,
      order: 1,
    },
  });

  // --- Workflow task ---
  const wfTask = await prisma.task.create({
    data: {
      title: "Seed: Update test-workflow via WFE",
      description: "Start working on this workflow task.",
      workspaceId: workspace.id,
      featureId: feature.id,
      phaseId: phase.id,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      mode: "workflow_editor",
      createdById: userId,
      updatedById: userId,
    },
  });

  // Dual-write WorkflowTask row
  await prisma.workflowTask.upsert({
    where: { taskId: wfTask.id },
    update: {},
    create: {
      taskId: wfTask.id,
      workflowId: 1,
      workflowName: "test-workflow",
      workflowRefId: "ref-001",
    },
  });

  // Seed WORKFLOW chat artifact (assistant message)
  await prisma.chatMessage.create({
    data: {
      taskId: wfTask.id,
      message: "",
      role: "ASSISTANT",
      status: "SENT",
      contextTags: JSON.stringify([]),
      artifacts: {
        create: [
          {
            type: "WORKFLOW",
            content: {
              workflowId: 1,
              workflowName: "test-workflow",
              workflowRefId: "ref-001",
              originalWorkflowJson: "",
            },
          },
        ],
      },
    },
  });

  // --- Normal repo task (for contrast) ---
  await prisma.task.create({
    data: {
      title: "Seed: Normal repo task",
      description: "A regular code task for comparison.",
      workspaceId: workspace.id,
      featureId: feature.id,
      phaseId: phase.id,
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      createdById: userId,
      updatedById: userId,
    },
  });

  console.log(
    `[seedWorkflowTask] Created workflow task ${wfTask.id} + WorkflowTask row in workspace "${workspaceSlug}"`
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
  await seedAgentLogs();
  await seedDashboardConversations(users);
  await seedPlatformConfig();
  await seedInitiativesAndMilestones(users);
  await seedMilestoneLinkFeatureData(users);
  await seedWorkflowTask();

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

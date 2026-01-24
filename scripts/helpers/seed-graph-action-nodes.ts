import {
  PrismaClient,
  TaskStatus,
  WorkflowStatus,
  Priority,
  ArtifactType,
  StakworkRunType,
  StakworkRunDecision,
  FeatureStatus,
  FeaturePriority,
  ChatRole,
  ChatStatus,
} from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

interface SeedSummary {
  workspace: { slug: string };
  user: { email: string };
  tasks: {
    total: number;
    inProgress: number;
    halted: number;
    done: number;
    completed: number;
    archivedHalted: number;
  };
  features: {
    total: number;
    requirements: number;
    architecture: number;
    requirementsWithQuestions: number;
    taskGeneration: number;
    withDecisions: number;
  };
}

async function main() {
  console.log("🌱 Seeding action-required nodes...\n");

  // Query existing workspace and user
  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!workspace) {
    throw new Error(
      "No workspace found. Please run seed-database.ts first to create a workspace.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: workspace.ownerId },
  });

  if (!user) {
    throw new Error(
      `No user found with ID ${workspace.ownerId}. Database may be corrupted.`,
    );
  }

  console.log(`📦 Using workspace: ${workspace.slug}`);
  console.log(`👤 Using user: ${user.email}\n`);

  const summary: SeedSummary = {
    workspace: { slug: workspace.slug },
    user: { email: user.email || "unknown" },
    tasks: {
      total: 0,
      inProgress: 0,
      halted: 0,
      done: 0,
      completed: 0,
      archivedHalted: 0,
    },
    features: {
      total: 0,
      requirements: 0,
      architecture: 0,
      requirementsWithQuestions: 0,
      taskGeneration: 0,
      withDecisions: 0,
    },
  };

  // Create tasks with specific configurations
  console.log("📝 Creating tasks...");

  // 2 tasks with workflowStatus: 'IN_PROGRESS', archived: false
  for (let i = 1; i <= 2; i++) {
    await prisma.task.upsert({
      where: {
        id: `task-in-progress-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `task-in-progress-${i}-${workspace.id}`,
        title: `Task In Progress ${i}: Implement user authentication`,
        description: `Working on implementing user authentication flow with OAuth2. Current status: ${i === 1 ? "Setting up OAuth provider" : "Testing login flow"}`,
        workspaceId: workspace.id,
        createdById: user.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        archived: false,
        workflowStartedAt: new Date(),
      },
    });
    summary.tasks.inProgress++;
    summary.tasks.total++;
  }

  // 2 tasks with workflowStatus: 'HALTED', archived: false (requires user input)
  for (let i = 1; i <= 2; i++) {
    await prisma.task.upsert({
      where: {
        id: `task-halted-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `task-halted-${i}-${workspace.id}`,
        title: `Task Halted ${i}: ${i === 1 ? "Database schema design needs review" : "API endpoint design clarification needed"}`,
        description: `This task is waiting for user input before proceeding. ${i === 1 ? "Need to confirm database table structure" : "Need to clarify REST vs GraphQL approach"}`,
        workspaceId: workspace.id,
        createdById: user.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.HALTED,
        priority: Priority.MEDIUM,
        archived: false,
        workflowStartedAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });
    summary.tasks.halted++;
    summary.tasks.total++;
  }

  // 2 tasks with status: 'DONE' + Artifact with type: 'PULL_REQUEST' (awaiting merge)
  for (let i = 1; i <= 2; i++) {
    const task = await prisma.task.upsert({
      where: {
        id: `task-done-pr-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `task-done-pr-${i}-${workspace.id}`,
        title: `Task Done ${i}: ${i === 1 ? "Add email validation" : "Update dashboard UI"}`,
        description: `Task completed with PR ready for merge. ${i === 1 ? "Email validation logic implemented" : "Dashboard UI components updated"}`,
        workspaceId: workspace.id,
        createdById: user.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        archived: false,
        branch: `feature/task-done-${i}`,
        workflowStartedAt: new Date(Date.now() - 7200000), // 2 hours ago
        workflowCompletedAt: new Date(Date.now() - 1800000), // 30 mins ago
      },
    });

    // Create a chat message for the PR artifact
    const message = await prisma.chatMessage.create({
      data: {
        taskId: task.id,
        message: `Pull request created for ${task.title}`,
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
      },
    });

    // Create PULL_REQUEST artifact
    await prisma.artifact.create({
      data: {
        messageId: message.id,
        type: ArtifactType.PULL_REQUEST,
        content: {
          url: `https://github.com/example/repo/pull/${1000 + i}`,
          number: 1000 + i,
          title: task.title,
          status: "DONE",
          branch: task.branch,
          baseBranch: "main",
          description: task.description,
        },
      },
    });

    summary.tasks.done++;
    summary.tasks.total++;
  }

  // 2 tasks with workflowStatus: 'COMPLETED' (should NOT appear on graph)
  for (let i = 1; i <= 2; i++) {
    await prisma.task.upsert({
      where: {
        id: `task-completed-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `task-completed-${i}-${workspace.id}`,
        title: `Task Completed ${i}: ${i === 1 ? "Fix login bug" : "Add unit tests"}`,
        description: `This task is fully completed and should not appear in action-required view.`,
        workspaceId: workspace.id,
        createdById: user.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
        priority: Priority.LOW,
        archived: false,
        workflowStartedAt: new Date(Date.now() - 14400000), // 4 hours ago
        workflowCompletedAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });
    summary.tasks.completed++;
    summary.tasks.total++;
  }

  // 1 task with workflowStatus: 'HALTED', archived: true (should NOT appear)
  await prisma.task.upsert({
    where: {
      id: `task-halted-archived-${workspace.id}`,
    },
    update: {},
    create: {
      id: `task-halted-archived-${workspace.id}`,
      title: "Task Halted Archived: Abandoned feature experiment",
      description:
        "This task was halted and archived. Should not appear in action-required view.",
      workspaceId: workspace.id,
      createdById: user.id,
      status: TaskStatus.CANCELLED,
      workflowStatus: WorkflowStatus.HALTED,
      priority: Priority.LOW,
      archived: true,
      workflowStartedAt: new Date(Date.now() - 86400000), // 24 hours ago
    },
  });
  summary.tasks.archivedHalted++;
  summary.tasks.total++;

  console.log(`✅ Created ${summary.tasks.total} tasks\n`);

  // Create features with specific StakworkRun configurations
  console.log("🎯 Creating features...");

  // 2 features with StakworkRun: type: 'REQUIREMENTS', status: 'COMPLETED', decision: null
  for (let i = 1; i <= 2; i++) {
    const feature = await prisma.feature.upsert({
      where: {
        id: `feature-requirements-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `feature-requirements-${i}-${workspace.id}`,
        title: `Feature Requirements ${i}: ${i === 1 ? "User profile management" : "Payment integration"}`,
        brief: `This feature needs requirements review. ${i === 1 ? "Allow users to update their profiles" : "Integrate Stripe for payments"}`,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.MEDIUM,
      },
    });

    await prisma.stakworkRun.create({
      data: {
        webhookUrl: `https://example.com/webhook/requirements-${i}`,
        projectId: 5000 + i,
        type: StakworkRunType.REQUIREMENTS,
        featureId: feature.id,
        workspaceId: workspace.id,
        status: WorkflowStatus.COMPLETED,
        result: `Requirements analysis completed for ${feature.title}. Ready for review.`,
        decision: null,
      },
    });

    summary.features.requirements++;
    summary.features.total++;
  }

  // 2 features with StakworkRun: type: 'ARCHITECTURE', status: 'COMPLETED', decision: null
  for (let i = 1; i <= 2; i++) {
    const feature = await prisma.feature.upsert({
      where: {
        id: `feature-architecture-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `feature-architecture-${i}-${workspace.id}`,
        title: `Feature Architecture ${i}: ${i === 1 ? "Notification system" : "Analytics dashboard"}`,
        brief: `This feature needs architecture review. ${i === 1 ? "Real-time notifications for users" : "Comprehensive analytics dashboard"}`,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
      },
    });

    await prisma.stakworkRun.create({
      data: {
        webhookUrl: `https://example.com/webhook/architecture-${i}`,
        projectId: 6000 + i,
        type: StakworkRunType.ARCHITECTURE,
        featureId: feature.id,
        workspaceId: workspace.id,
        status: WorkflowStatus.COMPLETED,
        result: `Architecture design completed for ${feature.title}. Awaiting approval.`,
        decision: null,
      },
    });

    summary.features.architecture++;
    summary.features.total++;
  }

  // 1 feature with StakworkRun: type: 'REQUIREMENTS', result contains tool_use: "ask_clarifying_questions"
  const featureWithQuestions = await prisma.feature.upsert({
    where: {
      id: `feature-requirements-questions-${workspace.id}`,
    },
    update: {},
    create: {
      id: `feature-requirements-questions-${workspace.id}`,
      title: "Feature Needs Clarification: Social sharing",
      brief:
        "Social media sharing feature with platform integrations (Twitter, Facebook, LinkedIn)",
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
    },
  });

  await prisma.stakworkRun.create({
    data: {
      webhookUrl: "https://example.com/webhook/requirements-questions",
      projectId: 7001,
      type: StakworkRunType.REQUIREMENTS,
      featureId: featureWithQuestions.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result: JSON.stringify({
        tool_use: "ask_clarifying_questions",
        questions: [
          "Which social media platforms should be prioritized?",
          "Should sharing be available for all content types or specific ones?",
          "Do we need custom sharing messages or use default content?",
        ],
        context:
          "Requirements analysis needs clarification on scope and platform priorities",
      }),
      dataType: "json",
      decision: null,
    },
  });

  summary.features.requirementsWithQuestions++;
  summary.features.total++;

  // 1 feature with StakworkRun: type: 'TASK_GENERATION', status: 'COMPLETED', decision: null
  const featureTaskGen = await prisma.feature.upsert({
    where: {
      id: `feature-task-generation-${workspace.id}`,
    },
    update: {},
    create: {
      id: `feature-task-generation-${workspace.id}`,
      title: "Feature Task Generation: Search functionality",
      brief: "Advanced search with filters and autocomplete",
      workspaceId: workspace.id,
      createdById: user.id,
      updatedById: user.id,
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.HIGH,
    },
  });

  await prisma.stakworkRun.create({
    data: {
      webhookUrl: "https://example.com/webhook/task-generation",
      projectId: 8001,
      type: StakworkRunType.TASK_GENERATION,
      featureId: featureTaskGen.id,
      workspaceId: workspace.id,
      status: WorkflowStatus.COMPLETED,
      result:
        "Task generation completed. 12 tasks created across all layers (frontend, backend, tests). Ready for review.",
      decision: null,
    },
  });

  summary.features.taskGeneration++;
  summary.features.total++;

  // 2 features with StakworkRun: decision: 'ACCEPTED' or 'REJECTED' (should NOT appear)
  for (let i = 1; i <= 2; i++) {
    const feature = await prisma.feature.upsert({
      where: {
        id: `feature-decided-${i}-${workspace.id}`,
      },
      update: {},
      create: {
        id: `feature-decided-${i}-${workspace.id}`,
        title: `Feature With Decision ${i}: ${i === 1 ? "Export functionality" : "Mobile app"}`,
        brief: `This feature has been ${i === 1 ? "accepted" : "rejected"} and should not appear.`,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status:
          i === 1 ? FeatureStatus.IN_PROGRESS : FeatureStatus.CANCELLED,
        priority: FeaturePriority.LOW,
      },
    });

    await prisma.stakworkRun.create({
      data: {
        webhookUrl: `https://example.com/webhook/decided-${i}`,
        projectId: 9000 + i,
        type: StakworkRunType.REQUIREMENTS,
        featureId: feature.id,
        workspaceId: workspace.id,
        status: WorkflowStatus.COMPLETED,
        result: `Requirements ${i === 1 ? "approved" : "rejected"}.`,
        decision:
          i === 1
            ? StakworkRunDecision.ACCEPTED
            : StakworkRunDecision.REJECTED,
        feedback:
          i === 1
            ? "Looks good, proceed with implementation"
            : "Not aligned with current priorities",
      },
    });

    summary.features.withDecisions++;
    summary.features.total++;
  }

  console.log(`✅ Created ${summary.features.total} features\n`);

  // Print summary
  console.log("📊 SEED SUMMARY");
  console.log("=====================================");
  console.log(`Workspace: ${summary.workspace.slug}`);
  console.log(`User: ${summary.user.email}`);
  console.log("\nTasks Created:");
  console.log(
    `  - In Progress (should appear): ${summary.tasks.inProgress}`,
  );
  console.log(`  - Halted (should appear): ${summary.tasks.halted}`);
  console.log(
    `  - Done with PR (should appear): ${summary.tasks.done}`,
  );
  console.log(
    `  - Completed (should NOT appear): ${summary.tasks.completed}`,
  );
  console.log(
    `  - Halted + Archived (should NOT appear): ${summary.tasks.archivedHalted}`,
  );
  console.log(`  TOTAL: ${summary.tasks.total}`);
  console.log("\nFeatures Created:");
  console.log(
    `  - Requirements Review (should appear): ${summary.features.requirements}`,
  );
  console.log(
    `  - Architecture Review (should appear): ${summary.features.architecture}`,
  );
  console.log(
    `  - Requirements with Questions (should appear): ${summary.features.requirementsWithQuestions}`,
  );
  console.log(
    `  - Task Generation Review (should appear): ${summary.features.taskGeneration}`,
  );
  console.log(
    `  - With Decisions (should NOT appear): ${summary.features.withDecisions}`,
  );
  console.log(`  TOTAL: ${summary.features.total}`);
  console.log("=====================================\n");

  console.log("✨ Seeding complete!");

  return summary;
}

main()
  .catch((error) => {
    console.error("❌ Error seeding database:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { main as seedActionNodes };

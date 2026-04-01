import {
  PrismaClient,
  TaskStatus,
  WorkflowStatus,
  Priority,
  ArtifactType,
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
    awaitingFeedback: number;
    notAwaitingFeedback: number;
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
      awaitingFeedback: 0,
      notAwaitingFeedback: 0,
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
        updatedById: user.id,
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
        updatedById: user.id,
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
        updatedById: user.id,
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
        updatedById: user.id,
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
      updatedById: user.id,
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
  // 4 features that SHOULD appear: last chat message = ASSISTANT, no tasks
  const awaitingFeatureConfigs = [
    { id: `feature-awaiting-1-${workspace.id}`, title: "Feature Awaiting Feedback 1: User profile management", brief: "Allow users to update their profiles", priority: FeaturePriority.MEDIUM },
    { id: `feature-awaiting-2-${workspace.id}`, title: "Feature Awaiting Feedback 2: Payment integration", brief: "Integrate Stripe for payments", priority: FeaturePriority.MEDIUM },
    { id: `feature-awaiting-3-${workspace.id}`, title: "Feature Awaiting Feedback 3: Notification system", brief: "Real-time notifications for users", priority: FeaturePriority.HIGH },
    { id: `feature-awaiting-4-${workspace.id}`, title: "Feature Awaiting Feedback 4: Search functionality", brief: "Advanced search with filters and autocomplete", priority: FeaturePriority.HIGH },
  ];

  for (const cfg of awaitingFeatureConfigs) {
    const feature = await prisma.feature.upsert({
      where: { id: cfg.id },
      update: {},
      create: {
        id: cfg.id,
        title: cfg.title,
        brief: cfg.brief,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: FeatureStatus.PLANNED,
        priority: cfg.priority,
      },
    });

    await prisma.chatMessage.create({
      data: {
        featureId: feature.id,
        role: ChatRole.ASSISTANT,
        message: `I've analyzed the requirements for "${feature.title}". Could you provide more details about your specific needs?`,
        status: ChatStatus.SENT,
      },
    });

    summary.features.awaitingFeedback++;
    summary.features.total++;
  }

  // 2 features that should NOT appear: last message is USER (user already replied)
  for (let i = 1; i <= 2; i++) {
    const feature = await prisma.feature.upsert({
      where: { id: `feature-not-awaiting-${i}-${workspace.id}` },
      update: {},
      create: {
        id: `feature-not-awaiting-${i}-${workspace.id}`,
        title: `Feature Not Awaiting ${i}: ${i === 1 ? "Export functionality" : "Mobile app"}`,
        brief: `This feature has a USER reply as last message and should not appear.`,
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: i === 1 ? FeatureStatus.IN_PROGRESS : FeatureStatus.PLANNED,
        priority: FeaturePriority.LOW,
      },
    });

    // Create ASSISTANT message first, then USER reply — so last message is USER
    await prisma.chatMessage.create({
      data: {
        featureId: feature.id,
        role: ChatRole.ASSISTANT,
        message: "What are your requirements for this feature?",
        status: ChatStatus.SENT,
      },
    });
    await prisma.chatMessage.create({
      data: {
        featureId: feature.id,
        role: ChatRole.USER,
        message: "Here are my requirements...",
        status: ChatStatus.SENT,
      },
    });

    summary.features.notAwaitingFeedback++;
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
    `  - Awaiting Feedback / last msg=ASSISTANT, no tasks (should appear): ${summary.features.awaitingFeedback}`,
  );
  console.log(
    `  - Not Awaiting / last msg=USER (should NOT appear): ${summary.features.notAwaitingFeedback}`,
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

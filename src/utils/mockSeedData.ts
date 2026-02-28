import { config } from "@/config/env";
import { db } from "@/lib/db";
import { mockPoolState } from "@/lib/mock/pool-manager-state";
import {
  ArtifactType,
  FeaturePriority,
  FeatureStatus,
  JanitorStatus,
  JanitorTrigger,
  JanitorType,
  PhaseStatus,
  Priority,
  RecommendationStatus,
  RepositoryStatus,
  StakworkRunDecision,
  StakworkRunType,
  TaskSourceType,
  TaskStatus,
  WorkflowStatus,
  WorkspaceRole,
} from "@prisma/client";

/**
 * Seeds mock data for development/testing.
 * Only runs when USE_MOCKS=true.
 * Idempotent - checks for existing data before seeding.
 */
export async function seedMockData(
  userId: string,
  workspaceId: string
): Promise<void> {
  // Only seed when USE_MOCKS is enabled and not in production
  if (!config.USE_MOCKS || process.env.NODE_ENV === "production") {
    return;
  }

  // Idempotency check - if features exist, skip seeding
  const existingFeatures = await db.feature.count({
    where: { workspaceId, deleted: false },
  });

  if (existingFeatures > 0) {
    console.log("[MockSeed] Workspace already has data, skipping seed");
    return;
  }

  console.log("[MockSeed] Seeding mock data for workspace:", workspaceId);

  // Create fake team members
  const teamMemberIds = await seedTeamMembers(workspaceId);

  // Create additional repositories for multi-repo workspace scenarios
  const additionalRepositories = await seedAdditionalRepositories(workspaceId);

  // Create features with phases and user stories
  const features = await seedFeatures(userId, workspaceId, teamMemberIds);

  // Create tasks of various types (with team member assignments and pod links)
  const { tasksWithPods, allTasks } = await seedTasks(userId, workspaceId, features, teamMemberIds, additionalRepositories);

  // Pre-seed pool state for capacity page
  preseedPoolState(tasksWithPods);

  // Create janitor config, runs, and recommendations
  await seedJanitorData(userId, workspaceId);

  // Seed StakworkRuns for AI generation history
  await seedStakworkRuns(workspaceId, features);

  // Seed Screenshots for USER_JOURNEY tasks
  const userJourneyTasks = allTasks.filter(
    (t) => t.sourceType === TaskSourceType.USER_JOURNEY
  );
  if (userJourneyTasks.length > 0) {
    await seedScreenshots(workspaceId, userJourneyTasks);
  }

  // Seed Attachments linked to chat messages
  await seedAttachments(workspaceId, allTasks);

  console.log("[MockSeed] Mock data seeding complete");
}

/**
 * Seeds additional repositories with varied statuses and configurations
 * Creates 2 repositories to demonstrate multi-repo workspace scenarios
 */
async function seedAdditionalRepositories(workspaceId: string): Promise<Array<{ id: string; name: string; repositoryUrl: string }>> {
  const repositories = [
    {
      name: "backend-api",
      repositoryUrl: "https://github.com/stakwork/backend-api",
      branch: "main",
      status: RepositoryStatus.SYNCED,
      testingFrameworkSetup: true,
      playwrightSetup: false,
      unitGlob: "src/**/*.test.ts",
      integrationGlob: "tests/integration/**/*.test.ts",
      e2eGlob: null,
    },
    {
      name: "mobile-app",
      repositoryUrl: "https://github.com/stakwork/mobile-app",
      branch: "develop",
      status: RepositoryStatus.PENDING,
      testingFrameworkSetup: false,
      playwrightSetup: false,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
    },
  ];

  const createdRepos: Array<{ id: string; name: string; repositoryUrl: string }> = [];

  for (const repo of repositories) {
    // Check if repository already exists for idempotency
    const existing = await db.repository.findFirst({
      where: {
        workspaceId,
        repositoryUrl: repo.repositoryUrl,
      },
      select: { id: true, name: true, repositoryUrl: true },
    });

    if (existing) {
      createdRepos.push(existing);
      continue;
    }

    const created = await db.repository.create({
      data: {
        ...repo,
        workspaceId,
      },
      select: { id: true, name: true, repositoryUrl: true },
    });

    createdRepos.push(created);
  }

  console.log(`[MockSeed] Created ${createdRepos.length} additional repositories`);
  return createdRepos;
}

/**
 * Creates fake team members with various roles
 * Uses unique emails per workspace to avoid conflicts in parallel tests
 */
async function seedTeamMembers(workspaceId: string): Promise<string[]> {
  // Generate unique suffix to avoid email conflicts in tests
  const uniqueSuffix = `${workspaceId.slice(0, 8)}`;
  
  const fakeMembers = [
    { name: "Alice Chen", email: `alice.chen+${uniqueSuffix}@example.com`, role: WorkspaceRole.ADMIN },
    { name: "Bob Martinez", email: `bob.martinez+${uniqueSuffix}@example.com`, role: WorkspaceRole.PM },
    { name: "Carol Johnson", email: `carol.johnson+${uniqueSuffix}@example.com`, role: WorkspaceRole.DEVELOPER },
    { name: "David Kim", email: `david.kim+${uniqueSuffix}@example.com`, role: WorkspaceRole.DEVELOPER },
  ];

  const userIds: string[] = [];

  for (const member of fakeMembers) {
    // Create user
    const user = await db.user.create({
      data: {
        name: member.name,
        email: member.email,
        image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(member.email)}`,
      },
    });
    userIds.push(user.id);

    // Add as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        role: member.role,
      },
    });
  }

  console.log(`[MockSeed] Created ${userIds.length} team members`);
  return userIds;
}

async function seedFeatures(
  userId: string,
  workspaceId: string,
  userIds: string[]
): Promise<Array<{ id: string; title: string; phaseId: string }>> {
  const featureData = [
    {
      title: "User Authentication",
      brief: "Implement secure user authentication with OAuth support",
      status: FeatureStatus.COMPLETED,
      priority: FeaturePriority.CRITICAL,
      requirements:
        "Support GitHub OAuth, email/password, and SSO. Implement secure session management.",
      architecture:
        "NextAuth.js with JWT sessions, Prisma adapter for user storage",
      personas: ["Developer", "Admin", "End User"],
      assigneeId: userIds[0],
    },
    {
      title: "Dashboard Analytics",
      brief: "Build real-time analytics dashboard for workspace metrics",
      status: FeatureStatus.IN_PROGRESS,
      priority: FeaturePriority.HIGH,
      requirements:
        "Show task completion rates, team velocity, code coverage trends",
      architecture: "React Query for data fetching, Recharts for visualization",
      personas: ["PM", "Team Lead", "Developer"],
      assigneeId: userIds[1],
    },
    {
      title: "API Rate Limiting",
      brief: "Implement rate limiting for public API endpoints",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
      requirements:
        "Configurable limits per endpoint, graceful degradation, monitoring",
      personas: ["Developer", "DevOps"],
      assigneeId: userIds[2],
    },
    {
      title: "Advanced Search Filters",
      brief: "Enhanced search with filters and saved queries",
      status: FeatureStatus.BACKLOG,
      priority: FeaturePriority.LOW,
      requirements:
        "Full-text search, filter by date/status/assignee, save custom queries for quick access",
      architecture: "ElasticSearch integration with React Query for frontend",
      personas: ["Developer", "PM", "Admin"],
    },
    {
      title: "Legacy Report Generator",
      brief: "Deprecated PDF report generation system",
      status: FeatureStatus.CANCELLED,
      priority: FeaturePriority.LOW,
      requirements:
        "Originally planned for PDF/Excel export of metrics. Cancelled due to low demand and maintenance overhead.",
      architecture: "N/A - Cancelled before implementation",
      personas: ["PM", "Stakeholder"],
    },
  ];

  const features: Array<{ id: string; title: string; phaseId: string }> = [];

  for (let index = 0; index < featureData.length; index++) {
    const data = featureData[index];
    const creatorId = userIds[index % userIds.length];
    
    const feature = await db.feature.create({
      data: {
        ...data,
        workspaceId,
        createdById: creatorId,
        updatedById: creatorId,
      },
      select: { id: true, title: true },
    });

    // Create phases for each feature (returns the first phase ID for task linking)
    const phaseId = await seedPhases(feature.id, data.status);

    features.push({ ...feature, phaseId });

    // Create user stories
    await seedUserStories(creatorId, feature.id);
  }

  return features;
}

async function seedPhases(
  featureId: string,
  featureStatus: FeatureStatus
): Promise<string> {
  // Determine phase statuses based on feature status
  let phaseStatuses: PhaseStatus[];
  switch (featureStatus) {
    case FeatureStatus.COMPLETED:
      phaseStatuses = [
        PhaseStatus.DONE,
        PhaseStatus.DONE,
        PhaseStatus.DONE,
        PhaseStatus.DONE,
      ];
      break;
    case FeatureStatus.IN_PROGRESS:
      phaseStatuses = [
        PhaseStatus.DONE,
        PhaseStatus.IN_PROGRESS,
        PhaseStatus.NOT_STARTED,
        PhaseStatus.NOT_STARTED,
      ];
      break;
    default:
      phaseStatuses = [
        PhaseStatus.NOT_STARTED,
        PhaseStatus.NOT_STARTED,
        PhaseStatus.NOT_STARTED,
        PhaseStatus.NOT_STARTED,
      ];
  }

  // Create the first phase separately to get its ID (tasks go here)
  const planningPhase = await db.phase.create({
    data: {
      featureId,
      name: "Planning",
      description: "Requirements gathering and design",
      status: phaseStatuses[0],
      order: 0,
    },
    select: { id: true },
  });

  // Create remaining phases
  await db.phase.createMany({
    data: [
      {
        featureId,
        name: "Implementation",
        description: "Core development work",
        status: phaseStatuses[1],
        order: 1,
      },
      {
        featureId,
        name: "Testing",
        description: "QA and automated testing",
        status: phaseStatuses[2],
        order: 2,
      },
      {
        featureId,
        name: "Deployment",
        description: "Production release and monitoring",
        status: phaseStatuses[3],
        order: 3,
      },
    ],
  });

  return planningPhase.id;
}

async function seedUserStories(userId: string, featureId: string): Promise<void> {
  await db.userStory.createMany({
    data: [
      {
        featureId,
        title: "As a user, I want to quickly access the main features",
        order: 0,
        completed: true,
        createdById: userId,
        updatedById: userId,
      },
      {
        featureId,
        title: "As an admin, I want to manage user permissions easily",
        order: 1,
        completed: false,
        createdById: userId,
        updatedById: userId,
      },
      {
        featureId,
        title: "As a developer, I want clear API documentation",
        order: 2,
        completed: false,
        createdById: userId,
        updatedById: userId,
      },
    ],
  });
}

interface TaskWithPod {
  podId: string;
  title: string;
}

async function seedTasks(
  userId: string,
  workspaceId: string,
  features: Array<{ id: string; title: string; phaseId: string }>,
  teamMemberIds: string[],
  repositories: Array<{ id: string; name: string; repositoryUrl: string }> = []
): Promise<{ tasksWithPods: TaskWithPod[]; allTasks: Array<{ id: string; title: string; status: TaskStatus; sourceType: TaskSourceType }> }> {
  // Check if tasks already exist for this workspace to avoid duplicate bounty codes
  const existingTasksCount = await db.task.count({
    where: { workspaceId, deleted: false },
  });
  
  if (existingTasksCount > 0) {
    console.log(`Tasks already exist for workspace ${workspaceId}, skipping seed`);
    const existingTasks = await db.task.findMany({
      where: { workspaceId, deleted: false },
      select: { id: true, title: true, status: true, sourceType: true },
    });
    return { tasksWithPods: [], allTasks: existingTasks };
  }

  const mockPodUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const taskTemplates = [
    // USER tasks - various statuses
    {
      title: "Review authentication PR #42",
      description:
        "Review the pull request for the new OAuth implementation. Check for security issues and code quality.",
      status: TaskStatus.IN_PROGRESS, // Changed from TODO to trigger notification
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER,
      priority: Priority.HIGH,
      assignToTeamMember: 0, // Alice (ADMIN)
    },
    {
      title: "Update API documentation",
      description:
        "Document the new endpoints added in the last sprint. Include request/response examples.",
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER,
      priority: Priority.MEDIUM,
      assignToTeamMember: 2, // Carol (DEVELOPER)
      withPod: true,
    },
    {
      title: "Fix login redirect bug",
      description:
        "Users are being redirected to the wrong page after login. Fixed by updating the callback URL handling.",
      status: TaskStatus.IN_PROGRESS, // Changed from DONE to trigger notification
      workflowStatus: WorkflowStatus.PENDING, // Changed from COMPLETED
      sourceType: TaskSourceType.USER,
      priority: Priority.CRITICAL,
      assignToTeamMember: 3, // David (DEVELOPER)
    },
    {
      title: "Optimize database queries",
      description:
        "Profile and optimize slow queries identified in the performance report.",
      status: TaskStatus.TODO,
      sourceType: TaskSourceType.USER,
      priority: Priority.LOW,
    },
    {
      title: "Implement caching layer",
      description: "Add Redis caching for frequently accessed data.",
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER,
      priority: Priority.MEDIUM,
      assignToTeamMember: 2, // Carol (DEVELOPER)
      withPod: true,
    },
    {
      title: "Refactor user service",
      description:
        "Clean up the user service module and improve error handling.",
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
      sourceType: TaskSourceType.USER,
      priority: Priority.MEDIUM,
      assignToTeamMember: 3, // David (DEVELOPER)
    },

    // JANITOR tasks
    {
      title: "Add unit tests for UserService",
      description:
        "The UserService class has low test coverage. Add comprehensive unit tests.",
      status: TaskStatus.TODO,
      sourceType: TaskSourceType.JANITOR,
      priority: Priority.HIGH,
      janitorType: JanitorType.UNIT_TESTS,
    },
    {
      title: "Integration tests for API endpoints",
      description:
        "Add integration tests for the authentication and workspace API endpoints.",
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.JANITOR,
      priority: Priority.MEDIUM,
      janitorType: JanitorType.INTEGRATION_TESTS,
      withPod: true,
    },
    {
      title: "E2E test for checkout flow",
      description:
        "Create end-to-end test covering the complete checkout user journey.",
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
      sourceType: TaskSourceType.JANITOR,
      priority: Priority.HIGH,
      janitorType: JanitorType.E2E_TESTS,
    },

    // USER_JOURNEY tasks
    {
      title: "Login Flow Test",
      description: "E2E test for user login with GitHub OAuth",
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
      sourceType: TaskSourceType.USER_JOURNEY,
      testFilePath: "src/__tests__/e2e/specs/auth/login.spec.ts",
      testFileUrl:
        "https://github.com/stakwork/hive/blob/main/src/__tests__/e2e/specs/auth/login.spec.ts",
    },
    {
      title: "Signup Flow Test",
      description: "E2E test for new user registration flow",
      status: TaskStatus.IN_PROGRESS,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER_JOURNEY,
      // No testFilePath yet - test is still being generated
    },

    // BLOCKED/CANCELLED
    {
      title: "Migrate to new API version",
      description:
        "Blocked: Waiting for the third-party API v2 to be released.",
      status: TaskStatus.BLOCKED,
      sourceType: TaskSourceType.USER,
      priority: Priority.MEDIUM,
      assignToTeamMember: 1, // Bob (PM)
    },
    {
      title: "Legacy feature removal",
      description:
        "Cancelled: Decided to keep the legacy feature for backward compatibility.",
      status: TaskStatus.CANCELLED,
      sourceType: TaskSourceType.USER,
      priority: Priority.LOW,
    },

    // ARCHIVED
    {
      title: "Deprecated Feature Cleanup",
      description:
        "Remove deprecated feature code that was replaced by the new implementation.",
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
      sourceType: TaskSourceType.USER,
      priority: Priority.LOW,
      archived: true,
    },

    // BOUNTY CODE
    {
      title: "Fix critical security vulnerability in auth module",
      description:
        "Address the security issue reported by external security researcher. Bounty reward available.",
      status: TaskStatus.TODO,
      sourceType: TaskSourceType.USER,
      priority: Priority.CRITICAL,
      bountyCode: "BNT-12345",
      assignToTeamMember: 3, // David (DEVELOPER)
    },

    // TEST MODE
    {
      title: "Setup automated test infrastructure",
      description:
        "Configure CI/CD pipeline for running automated tests on every commit.",
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER,
      priority: Priority.HIGH,
      mode: "test",
      withPod: true,
    },

    // TASK_COORDINATOR type
    {
      title: "Coordinate dependent tasks for multi-service deployment",
      description:
        "System-generated task to coordinate deployment sequence across backend-api and mobile-app repositories. Ensures API deployment completes before mobile app release.",
      status: TaskStatus.TODO,
      sourceType: TaskSourceType.TASK_COORDINATOR,
      priority: Priority.HIGH,
      assignToTeamMember: 1, // Bob (PM)
    },

    // Repository-linked task
    {
      title: "Refactor authentication module in backend-api",
      description:
        "Refactor the authentication module to use the new OAuth 2.0 provider. This task is linked to the backend-api repository.",
      status: TaskStatus.IN_PROGRESS,
      sourceType: TaskSourceType.USER,
      priority: Priority.HIGH,
      assignToTeamMember: 2, // Carol (DEVELOPER)
      withPod: true,
      linkedRepositoryIndex: 0, // Link to backend-api repository
    },

    // Detailed BLOCKED task
    {
      title: "Implement real-time notifications in mobile app",
      description:
        "Add push notification support for task updates, comments, and mentions. Requires WebSocket infrastructure deployment.",
      status: TaskStatus.BLOCKED,
      sourceType: TaskSourceType.USER,
      priority: Priority.HIGH,
      assignToTeamMember: 3, // David (DEVELOPER)
      blockingReason: "Blocked: WebSocket infrastructure deployment pending DevOps approval. Security review in progress for real-time data streaming. Expected resolution: 2 weeks.",
    },
  ];

  const createdTasks: Array<{ id: string; title: string; status: TaskStatus; sourceType: TaskSourceType }> = [];
  const tasksWithPods: TaskWithPod[] = [];
  let podIndex = 0;

  for (let i = 0; i < taskTemplates.length; i++) {
    const template = taskTemplates[i];
    // Link USER tasks to features and their first phase (distribute across available features)
    const featureIndex = i % features.length;
    const linkedFeature =
      template.sourceType === TaskSourceType.USER && features.length > 0
        ? features[featureIndex]
        : null;

    // Assign to team member if specified
    const assigneeId =
      template.assignToTeamMember !== undefined && teamMemberIds[template.assignToTeamMember]
        ? teamMemberIds[template.assignToTeamMember]
        : null;

    // Assign pod for IN_PROGRESS tasks with withPod flag
    let podId: string | null = null;
    let agentUrl: string | null = null;
    if (template.withPod && template.status === TaskStatus.IN_PROGRESS) {
      podId = `mock-pool-pod-${podIndex}`;
      agentUrl = mockPodUrl;
      podIndex++;
    }

    // Link to repository if specified
    const linkedRepository = template.linkedRepositoryIndex !== undefined && repositories[template.linkedRepositoryIndex]
      ? repositories[template.linkedRepositoryIndex]
      : null;

    const task = await db.task.create({
      data: {
        title: template.title,
        description: template.description,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        assigneeId,
        status: template.status,
        workflowStatus: template.withPod
          ? WorkflowStatus.IN_PROGRESS
          : template.workflowStatus || WorkflowStatus.PENDING,
        priority: template.priority || Priority.MEDIUM,
        sourceType: template.sourceType,
        featureId: linkedFeature?.id || null,
        phaseId: linkedFeature?.phaseId || null, // Link to feature's first phase for Tasks tab
        janitorType: template.janitorType || null,
        testFilePath: template.testFilePath || null,
        testFileUrl: template.testFileUrl || null,
        archived: template.archived || false,
        bountyCode: template.bountyCode || null,
        mode: template.mode || undefined,
        podId,
        agentUrl,
        repositoryId: linkedRepository?.id || null,
      },
      select: { id: true, title: true, status: true, sourceType: true },
    });

    createdTasks.push(task);

    if (podId) {
      tasksWithPods.push({ podId, title: task.title });
    }
  }

  // Add chat messages with artifacts to some tasks
  await seedChatMessagesWithArtifacts(createdTasks.slice(0, 5));

  // Add diverse PR artifacts for last 72 hours testing
  await seedPullRequestArtifacts(userId, workspaceId, features);

  // Second pass: Add task dependencies
  // Create diverse dependency scenarios as specified in requirements
  const dependencyUpdates = [];

  if (createdTasks.length >= 10) {
    // Scenario 1: Simple chain A→B→C (tasks 0, 1, 2)
    // Task 2 depends on Task 1, Task 1 depends on Task 0
    dependencyUpdates.push(
      db.task.update({
        where: { id: createdTasks[1].id },
        data: { dependsOnTaskIds: [createdTasks[0].id] },
      }),
      db.task.update({
        where: { id: createdTasks[2].id },
        data: { dependsOnTaskIds: [createdTasks[1].id] },
      })
    );

    // Scenario 2: Parallel dependencies - task depends on 2 others (task 5 depends on tasks 3 and 4)
    dependencyUpdates.push(
      db.task.update({
        where: { id: createdTasks[5].id },
        data: { dependsOnTaskIds: [createdTasks[3].id, createdTasks[4].id] },
      })
    );

    // Scenario 3: Cross-feature dependencies (task 7 depends on task 6)
    // These are from different features due to feature distribution in main loop
    dependencyUpdates.push(
      db.task.update({
        where: { id: createdTasks[7].id },
        data: { dependsOnTaskIds: [createdTasks[6].id] },
      })
    );

    // Scenario 4: Complex - task depends on multiple, including from a chain (task 9 depends on tasks 2 and 8)
    if (createdTasks.length > 9) {
      dependencyUpdates.push(
        db.task.update({
          where: { id: createdTasks[9].id },
          data: { dependsOnTaskIds: [createdTasks[2].id, createdTasks[8].id] },
        })
      );
    }

    // Scenario 5: Another simple dependency (task 8 depends on task 6)
    dependencyUpdates.push(
      db.task.update({
        where: { id: createdTasks[8].id },
        data: { dependsOnTaskIds: [createdTasks[6].id] },
      })
    );

    // Execute all dependency updates
    await Promise.all(dependencyUpdates);
    console.log(`[MockSeed] Added dependencies to ${dependencyUpdates.length} tasks`);
  }

  console.log(`[MockSeed] Created ${createdTasks.length} tasks, ${tasksWithPods.length} with pods`);
  return { tasksWithPods, allTasks: createdTasks };
}

/**
 * Creates chat messages with artifacts for tasks
 * Each task gets BROWSER, IDE, and DIFF artifacts at minimum
 */
async function seedChatMessagesWithArtifacts(
  tasks: Array<{ id: string; title: string; status: TaskStatus }>
): Promise<void> {
  for (const task of tasks) {
    // User starts the conversation
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: `I need help with: ${task.title}`,
        role: "USER",
      },
    });

    // Assistant responds with browser preview
    const browserMsg = await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "I've started working on the task. Here's a preview of the changes in the browser:",
        role: "ASSISTANT",
      },
    });

    // Add BROWSER artifact
    await db.artifact.create({
      data: {
        messageId: browserMsg.id,
        type: ArtifactType.BROWSER,
        content: {
          url: "http://localhost:3000/preview",
          screenshot: null,
          title: `Preview: ${task.title}`,
        },
      },
    });

    // User asks for implementation details
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Looks good! Can you show me what files you're working on?",
        role: "USER",
      },
    });

    // Assistant shows IDE artifact
    const ideMsg = await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Here are the files I've been editing:",
        role: "ASSISTANT",
      },
    });

    // Add IDE artifact
    await db.artifact.create({
      data: {
        messageId: ideMsg.id,
        type: ArtifactType.IDE,
        content: {
          files: [
            { path: "src/components/Dashboard.tsx", language: "typescript" },
            { path: "src/services/api.ts", language: "typescript" },
            { path: "src/styles/main.css", language: "css" },
          ],
          activeFile: "src/components/Dashboard.tsx",
        },
      },
    });

    // User asks for diff
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Can you show me the git diff of your changes?",
        role: "USER",
      },
    });

    // Assistant shows diff
    const diffMsg = await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Here's the diff of all changes made:",
        role: "ASSISTANT",
      },
    });

    // Add DIFF artifact
    await db.artifact.create({
      data: {
        messageId: diffMsg.id,
        type: ArtifactType.DIFF,
        content: {
          diffs: [
            {
              file: "src/components/Dashboard.tsx",
              action: "modify",
              repoName: "test/repo",
              content: `diff --git a/src/components/Dashboard.tsx b/src/components/Dashboard.tsx
index 1234567..abcdefg 100644
--- a/src/components/Dashboard.tsx
+++ b/src/components/Dashboard.tsx
@@ -1,8 +1,25 @@
-import React from 'react';
+import React, { useState, useEffect } from 'react';
+import { useData } from '@/hooks/useData';
 
 export function Dashboard() {
+  const [isLoading, setIsLoading] = useState(true);
+  const { data, error } = useData();
+
+  useEffect(() => {
+    if (data || error) {
+      setIsLoading(false);
+    }
+  }, [data, error]);
+
+  if (isLoading) {
+    return <div>Loading...</div>;
+  }
+
   return (
-    <div>Dashboard</div>
+    <div className="dashboard-container">
+      <h1>Dashboard</h1>
+      {data && <DataDisplay data={data} />}
+    </div>
   );
 }`,
            },
            {
              file: "public/logo.png",
              action: "create",
              repoName: "test/repo",
              content: `--- /dev/null
+++ b/public/logo.png
Binary image file (image/png, 68 B)
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
            },
          ],
        } as any,
      },
    });

    // User provides feedback
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Great progress! Let me review and get back to you.",
        role: "USER",
      },
    });

    // Add GRAPH artifact (for first 2 tasks)
    if (tasks.indexOf(task) < 2) {
      const graphMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I've also updated the dependency graph to show the new relationships:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: graphMsg.id,
          type: ArtifactType.GRAPH,
          content: {
            nodes: [
              { id: "Dashboard", label: "Dashboard Component" },
              { id: "useData", label: "useData Hook" },
              { id: "DataDisplay", label: "DataDisplay Component" },
            ],
            edges: [
              { from: "Dashboard", to: "useData" },
              { from: "Dashboard", to: "DataDisplay" },
            ],
          },
        },
      });
    }

    // Add WORKFLOW artifact (for task index 1 and 3)
    if (tasks.indexOf(task) === 1 || tasks.indexOf(task) === 3) {
      const workflowMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Here's the CI/CD workflow status for this task:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: workflowMsg.id,
          type: ArtifactType.WORKFLOW,
          content: {
            workflowName: "CI Pipeline",
            status: "success",
            jobs: [
              { name: "Build", status: "success", duration: "2m 15s" },
              { name: "Test", status: "success", duration: "5m 30s" },
              { name: "Deploy", status: "success", duration: "3m 45s" },
            ],
          },
        },
      });
    }

    // Add PULL_REQUEST artifact (for done tasks)
    if (task.status === TaskStatus.DONE) {
      const prMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "The pull request has been successfully merged:",
          role: "ASSISTANT",
        },
      });

      const prNum = Math.floor(Math.random() * 1000) + 1;
      await db.artifact.create({
        data: {
          messageId: prMsg.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            repo: "stakwork/hive",
            url: `https://github.com/stakwork/hive/pull/${prNum}`,
            status: "DONE",
            number: prNum,
            title: `feat: ${task.title}`,
            additions: 125,
            deletions: 45,
            changedFiles: 8,
          },
        },
      });
    }

    // Add CODE artifact FIRST for task index 4 (will add FORM later as older message)
    if (tasks.indexOf(task) === 4) {
      const oldFormMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I need some configuration details. Please fill out this form:",
          role: "ASSISTANT",
          createdAt: new Date(Date.now() - 3600000), // 1 hour ago (OLD)
        },
      });

      await db.artifact.create({
        data: {
          messageId: oldFormMsg.id,
          type: ArtifactType.FORM,
          content: {
            formId: "config-form-v1",
            title: "Configuration Settings",
            fields: [
              { name: "apiKey", type: "text", required: true, label: "API Key" },
              { name: "environment", type: "select", required: true, label: "Environment", options: ["development", "staging", "production"] },
            ],
            schema: {
              type: "object",
              properties: {
                apiKey: { type: "string" },
                environment: { type: "string", enum: ["development", "staging", "production"] },
              },
              required: ["apiKey", "environment"],
            },
          },
          createdAt: new Date(Date.now() - 3600000), // 1 hour ago
        },
      });

      // Add a newer message AFTER the form (so FORM is NOT the latest)
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Thanks! I've received your configuration and started implementing the caching layer.",
          role: "ASSISTANT",
          createdAt: new Date(Date.now() - 1800000), // 30 min ago (NEWER than FORM)
        },
      });
    }

    // Add CODE artifact (for task index 1 and 4)
    if (tasks.indexOf(task) === 1 || tasks.indexOf(task) === 4) {
      const codeMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Here's the code snippet I've been working on:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: codeMsg.id,
          type: ArtifactType.CODE,
          content: {
            language: "typescript",
            filename: "useAuth.ts",
            snippet: `import { useSession } from 'next-auth/react';

export function useAuth() {
  const { data: session, status } = useSession();
  
  return {
    user: session?.user,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
  };
}`,
          },
        },
      });
    }

    // Add MEDIA artifact (for task index 0 and 3)
    if (tasks.indexOf(task) === 0 || tasks.indexOf(task) === 3) {
      const mediaMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Here's a preview of the UI changes:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: mediaMsg.id,
          type: ArtifactType.MEDIA,
          content: {
            url: "https://placehold.co/800x600/png",
            type: "image",
            metadata: {
              width: 800,
              height: 600,
              format: "png",
              title: `UI Preview: ${task.title}`,
            },
          },
        },
      });
    }

    // Add BUG_REPORT artifact (for task index 2)
    if (tasks.indexOf(task) === 2) {
      const bugMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I've identified and documented the bug with a full stack trace:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: bugMsg.id,
          type: ArtifactType.BUG_REPORT,
          content: {
            title: "Null Pointer Exception in User Service",
            severity: "HIGH",
            reproduction: "1. Navigate to /users\n2. Click on user profile\n3. Error occurs when fetching preferences",
            stackTrace: `Error: Cannot read property 'preferences' of null
    at UserService.getPreferences (user.service.ts:45)
    at UserController.getProfile (user.controller.ts:23)
    at processTicksAndRejections (internal/process/task_queues.js:95)`,
            environment: {
              browser: "Chrome 120.0",
              os: "macOS 14.2",
              nodeVersion: "v20.10.0",
            },
          },
        },
      });
    }

    // Add LONGFORM artifact (for task index 1 and 3)
    if (tasks.indexOf(task) === 1 || tasks.indexOf(task) === 3) {
      const longformMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I've prepared detailed documentation for this feature:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: longformMsg.id,
          type: ArtifactType.LONGFORM,
          content: {
            title: `Technical Documentation: ${task.title}`,
            format: "markdown",
            body: `# ${task.title}

## Overview
This document provides comprehensive technical details about the implementation.

## Architecture
The feature follows a microservices architecture with the following components:
- API Gateway for routing
- Authentication Service for security
- Data Service for persistence

## Implementation Details
### Backend
The backend is implemented using Node.js with Express framework. Key endpoints include:
- \`/api/users\` - User management
- \`/api/auth\` - Authentication
- \`/api/data\` - Data access

### Frontend
The frontend uses React with TypeScript for type safety. Components are organized by feature.

## Testing Strategy
- Unit tests: Jest with React Testing Library
- Integration tests: Supertest for API testing
- E2E tests: Playwright for user flows

## Deployment
Deployed via Docker containers on AWS ECS with auto-scaling enabled.`,
          },
        },
      });
    }

    // Add PUBLISH_WORKFLOW artifact (for task index 0 and 4)
    if (tasks.indexOf(task) === 0 || tasks.indexOf(task) === 4) {
      const publishMsg = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "The deployment workflow has been configured and published:",
          role: "ASSISTANT",
        },
      });

      await db.artifact.create({
        data: {
          messageId: publishMsg.id,
          type: ArtifactType.PUBLISH_WORKFLOW,
          content: {
            workflowName: "Production Deploy",
            status: "published",
            version: "v1.2.3",
            environment: "production",
            triggers: ["push", "manual"],
            steps: [
              {
                name: "Checkout code",
                status: "completed",
                duration: "5s",
              },
              {
                name: "Build application",
                status: "completed",
                duration: "2m 30s",
              },
              {
                name: "Run tests",
                status: "completed",
                duration: "4m 15s",
              },
              {
                name: "Build Docker image",
                status: "completed",
                duration: "1m 45s",
              },
              {
                name: "Push to registry",
                status: "completed",
                duration: "45s",
              },
              {
                name: "Deploy to production",
                status: "completed",
                duration: "3m 20s",
              },
            ],
            publishedAt: new Date().toISOString(),
            publishedBy: "automation-bot",
          },
        },
      });
    }

    // If task is done, add completion message
    if (task.status === TaskStatus.DONE) {
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "All changes have been reviewed and merged. The task is complete!",
          role: "ASSISTANT",
        },
      });
    }
  }

  // NOW add FORM artifacts for tasks 0 and 2 as the LATEST messages (to trigger notification)
  // These are created AFTER all other artifacts to ensure they are the most recent
  if (tasks.length > 0) {
    const formMsg0 = await db.chatMessage.create({
      data: {
        taskId: tasks[0].id,
        message: "I need your input on the PR review. Please fill out this feedback form:",
        role: "ASSISTANT",
        createdAt: new Date(), // Current time - LATEST message
      },
    });

    await db.artifact.create({
      data: {
        messageId: formMsg0.id,
        type: ArtifactType.FORM,
        content: {
          formId: "pr-review-form-v1",
          title: "PR Review Feedback",
          fields: [
            { name: "approved", type: "select", required: true, label: "Approval Status", options: ["Approved", "Changes Requested", "Comment"] },
            { name: "securityConcerns", type: "textarea", required: false, label: "Security Concerns" },
            { name: "codeQuality", type: "select", required: true, label: "Code Quality", options: ["Excellent", "Good", "Needs Improvement"] },
          ],
          schema: {
            type: "object",
            properties: {
              approved: { type: "string", enum: ["Approved", "Changes Requested", "Comment"] },
              securityConcerns: { type: "string" },
              codeQuality: { type: "string", enum: ["Excellent", "Good", "Needs Improvement"] },
            },
            required: ["approved", "codeQuality"],
          },
        },
        createdAt: new Date(),
      },
    });
  }

  if (tasks.length > 2) {
    const formMsg2 = await db.chatMessage.create({
      data: {
        taskId: tasks[2].id,
        message: "I need clarification on the redirect bug fix. Please answer these questions:",
        role: "ASSISTANT",
        createdAt: new Date(), // Current time - LATEST message
      },
    });

    await db.artifact.create({
      data: {
        messageId: formMsg2.id,
        type: ArtifactType.FORM,
        content: {
          formId: "bug-fix-clarification-v1",
          title: "Bug Fix Clarification",
          fields: [
            { name: "targetUrl", type: "text", required: true, label: "What should the correct redirect URL be?" },
            { name: "affectsAllUsers", type: "select", required: true, label: "Does this affect all users?", options: ["Yes", "No", "Only specific roles"] },
            { name: "urgency", type: "select", required: true, label: "Urgency Level", options: ["Critical", "High", "Medium", "Low"] },
          ],
          schema: {
            type: "object",
            properties: {
              targetUrl: { type: "string" },
              affectsAllUsers: { type: "string", enum: ["Yes", "No", "Only specific roles"] },
              urgency: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
            },
            required: ["targetUrl", "affectsAllUsers", "urgency"],
          },
        },
        createdAt: new Date(),
      },
    });
  }

  console.log(`[MockSeed] Created chat messages with artifacts for ${tasks.length} tasks`);
  console.log(`[MockSeed] Added FORM artifacts as LATEST messages for tasks 0 and 2 (will trigger notification)`);
  console.log(`[MockSeed] Added OLD FORM artifact for task 4 (should NOT trigger notification)`);
}

/**
 * Seeds diverse PR artifacts for last 72 hours testing
 * Creates 10+ tasks with PR artifacts:
 * - 6-8 with status='DONE' (merged PRs within last 72 hours)
 * - 2-3 with status='open' (open PRs within last 72 hours)
 * - 2-3 with status='closed' (closed PRs within last 72 hours)
 * - 3-4 with PRs older than 72 hours
 * Varied createdAt and updatedAt timestamps simulate realistic PR timelines
 */
async function seedPullRequestArtifacts(
  userId: string,
  workspaceId: string,
  features: Array<{ id: string; title: string; phaseId: string }>
): Promise<void> {
  const now = Date.now();
  const HOUR_MS = 3600000;
  const HOURS_72_MS = 72 * HOUR_MS;

  // PR templates with varied statuses and timestamps
  const prTemplates = [
    // MERGED PRs within last 72 hours (6-8 tasks)
    {
      title: "Add user profile page with avatar upload",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 48,
      mergedHoursAgo: 46,
      additions: 245,
      deletions: 32,
      changedFiles: 12,
    },
    {
      title: "Implement real-time notifications with WebSocket",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 68,
      mergedHoursAgo: 65,
      additions: 520,
      deletions: 78,
      changedFiles: 18,
    },
    {
      title: "Fix memory leak in data polling service",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 24,
      mergedHoursAgo: 22,
      additions: 65,
      deletions: 98,
      changedFiles: 4,
    },
    {
      title: "Add dark mode theme support",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 56,
      mergedHoursAgo: 54,
      additions: 380,
      deletions: 145,
      changedFiles: 22,
    },
    {
      title: "Optimize database queries for user dashboard",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 36,
      mergedHoursAgo: 34,
      additions: 112,
      deletions: 87,
      changedFiles: 8,
    },
    {
      title: "Implement password reset flow with email verification",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 12,
      mergedHoursAgo: 10,
      additions: 295,
      deletions: 41,
      changedFiles: 14,
    },
    {
      title: "Add integration tests for webhook handlers",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 60,
      mergedHoursAgo: 58,
      additions: 450,
      deletions: 22,
      changedFiles: 10,
    },
    {
      title: "Refactor authentication middleware for better error handling",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 40,
      mergedHoursAgo: 38,
      additions: 180,
      deletions: 165,
      changedFiles: 6,
    },

    // OPEN PRs within last 72 hours (2-3 tasks)
    {
      title: "Add GraphQL API support for advanced queries",
      status: "IN_PROGRESS" as const,
      prStatus: "open" as const,
      createdHoursAgo: 18,
      additions: 680,
      deletions: 95,
      changedFiles: 28,
    },
    {
      title: "Implement rate limiting for public API endpoints",
      status: "IN_PROGRESS" as const,
      prStatus: "open" as const,
      createdHoursAgo: 32,
      additions: 215,
      deletions: 48,
      changedFiles: 11,
    },
    {
      title: "Add file upload progress indicators",
      status: "IN_PROGRESS" as const,
      prStatus: "open" as const,
      createdHoursAgo: 52,
      additions: 340,
      deletions: 62,
      changedFiles: 9,
    },

    // CLOSED PRs within last 72 hours (2-3 tasks)
    {
      title: "Experiment with new caching strategy (abandoned)",
      status: "CANCELLED" as const,
      prStatus: "closed" as const,
      createdHoursAgo: 44,
      closedHoursAgo: 42,
      additions: 425,
      deletions: 280,
      changedFiles: 16,
    },
    {
      title: "Alternative approach to user permissions (superseded)",
      status: "CANCELLED" as const,
      prStatus: "closed" as const,
      createdHoursAgo: 28,
      closedHoursAgo: 26,
      additions: 310,
      deletions: 195,
      changedFiles: 13,
    },

    // PRs older than 72 hours (3-4 tasks)
    {
      title: "Legacy feature migration to new architecture",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 168, // 7 days ago
      mergedHoursAgo: 165,
      additions: 1250,
      deletions: 980,
      changedFiles: 45,
    },
    {
      title: "Initial CI/CD pipeline setup",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 240, // 10 days ago
      mergedHoursAgo: 235,
      additions: 520,
      deletions: 120,
      changedFiles: 18,
    },
    {
      title: "Add comprehensive E2E test suite",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 120, // 5 days ago
      mergedHoursAgo: 117,
      additions: 850,
      deletions: 45,
      changedFiles: 32,
    },
    {
      title: "Database schema migration for multi-tenancy",
      status: "DONE" as const,
      prStatus: "DONE" as const,
      createdHoursAgo: 192, // 8 days ago
      mergedHoursAgo: 188,
      additions: 680,
      deletions: 420,
      changedFiles: 25,
    },
  ];

  let prNumber = 100; // Starting PR number

  for (let i = 0; i < prTemplates.length; i++) {
    const template = prTemplates[i];
    const featureIndex = i % features.length;
    const linkedFeature = features[featureIndex];

    // Calculate timestamps
    const createdAt = new Date(now - template.createdHoursAgo * HOUR_MS);
    let updatedAt: Date;

    if (template.prStatus === "DONE" && template.mergedHoursAgo) {
      updatedAt = new Date(now - template.mergedHoursAgo * HOUR_MS);
    } else if (template.prStatus === "closed" && template.closedHoursAgo) {
      updatedAt = new Date(now - template.closedHoursAgo * HOUR_MS);
    } else {
      // For open PRs, updatedAt is recent (last update)
      updatedAt = new Date(now - Math.random() * 2 * HOUR_MS);
    }

    // Create task
    const task = await db.task.create({
      data: {
        title: template.title,
        description: `Implementation of ${template.title.toLowerCase()}. PR #${prNumber} - ${template.prStatus}`,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        status: template.status,
        workflowStatus:
          template.status === "DONE"
            ? WorkflowStatus.COMPLETED
            : template.status === "IN_PROGRESS"
            ? WorkflowStatus.IN_PROGRESS
            : WorkflowStatus.HALTED,
        priority: Priority.MEDIUM,
        sourceType: TaskSourceType.USER,
        featureId: linkedFeature.id,
        phaseId: linkedFeature.phaseId,
        createdAt,
        updatedAt,
      },
      select: { id: true, title: true },
    });

    // Create chat message
    const prMsg = await db.chatMessage.create({
      data: {
        taskId: task.id,
        message:
          template.prStatus === "DONE"
            ? "Pull request has been successfully merged!"
            : template.prStatus === "open"
            ? "Pull request is ready for review. Please check the changes."
            : "Pull request was closed without merging.",
        role: "ASSISTANT",
        createdAt,
        updatedAt,
      },
    });

    // Create PR artifact with proper PullRequestContent interface
    await db.artifact.create({
      data: {
        messageId: prMsg.id,
        type: ArtifactType.PULL_REQUEST,
        content: {
          repo: "stakwork/hive",
          url: `https://github.com/stakwork/hive/pull/${prNumber}`,
          status: template.prStatus,
          number: prNumber,
          title: `feat: ${template.title}`,
          additions: template.additions,
          deletions: template.deletions,
          changedFiles: template.changedFiles,
        },
        createdAt,
        updatedAt,
      },
    });

    prNumber++;
  }

  console.log(
    `[MockSeed] Created ${prTemplates.length} tasks with PR artifacts for last 72 hours testing`
  );
  console.log(
    `  - ${prTemplates.filter((t) => t.prStatus === "DONE" && t.createdHoursAgo <= 72).length} merged within 72h`
  );
  console.log(
    `  - ${prTemplates.filter((t) => t.prStatus === "open").length} open PRs`
  );
  console.log(
    `  - ${prTemplates.filter((t) => t.prStatus === "closed").length} closed PRs`
  );
  console.log(
    `  - ${prTemplates.filter((t) => t.createdHoursAgo > 72).length} older than 72h`
  );
}

/**
 * Pre-seeds the mock pool state with task information for capacity page
 */
function preseedPoolState(tasksWithPods: TaskWithPod[]): void {
  if (tasksWithPods.length === 0) return;

  const pool = mockPoolState.getOrCreatePool("mock-pool");

  for (const task of tasksWithPods) {
    const pod = pool.pods.find((p) => p.id === task.podId);
    if (pod) {
      pod.usage_status = "in_use";
      pod.userInfo = `Working on: ${task.title}`;
      pod.claimedAt = new Date();
    }
  }

  console.log(`[MockSeed] Pre-seeded ${tasksWithPods.length} pods with task info`);
}

async function seedJanitorData(
  userId: string,
  workspaceId: string
): Promise<void> {
  // Create JanitorConfig
  const janitorConfig = await db.janitorConfig.create({
    data: {
      workspaceId,
      unitTestsEnabled: true,
      integrationTestsEnabled: true,
      e2eTestsEnabled: false,
      securityReviewEnabled: true,
      mockGenerationEnabled: false,
      taskCoordinatorEnabled: true,
      recommendationSweepEnabled: true,
    },
  });

  // Create a completed JanitorRun
  const janitorRun = await db.janitorRun.create({
    data: {
      janitorConfigId: janitorConfig.id,
      janitorType: JanitorType.UNIT_TESTS,
      status: JanitorStatus.COMPLETED,
      triggeredBy: JanitorTrigger.MANUAL,
      startedAt: new Date(Date.now() - 3600000), // 1 hour ago
      completedAt: new Date(Date.now() - 3500000), // 50 min ago
      metadata: { filesAnalyzed: 42, coverage: 78.5 },
    },
  });

  // Create recommendations
  const recommendations = [
    {
      title: "Add unit tests for UserService",
      description:
        "The UserService class has 0% test coverage. Critical business logic should be tested.",
      priority: Priority.HIGH,
      impact: "Improves reliability of user operations and prevents regressions",
    },
    {
      title: "Mock external API calls in tests",
      description:
        "Tests are making real HTTP calls to external services, causing flakiness.",
      priority: Priority.CRITICAL,
      impact: "Reduces test flakiness and execution time by 60%",
    },
    {
      title: "Add integration tests for webhooks",
      description:
        "GitHub webhook handlers lack integration tests. Edge cases are untested.",
      priority: Priority.MEDIUM,
      impact: "Ensures webhook reliability and catches payload format changes",
    },
  ];

  for (const rec of recommendations) {
    await db.janitorRecommendation.create({
      data: {
        janitorRunId: janitorRun.id,
        workspaceId,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        impact: rec.impact,
        status: RecommendationStatus.PENDING,
      },
    });
  }

  // Add SECURITY_REVIEW and GENERAL_REFACTORING recommendations
  const securityRun = await db.janitorRun.create({
    data: {
      janitorConfigId: janitorConfig.id,
      janitorType: JanitorType.SECURITY_REVIEW,
      status: JanitorStatus.COMPLETED,
      triggeredBy: JanitorTrigger.SCHEDULED,
      startedAt: new Date(Date.now() - 7200000), // 2 hours ago
      completedAt: new Date(Date.now() - 7000000), // 1h 56m ago
      metadata: { filesScanned: 156, issuesFound: 3 },
    },
  });

  await db.janitorRecommendation.create({
    data: {
      janitorRunId: securityRun.id,
      workspaceId,
      title: "Update dependencies with security vulnerabilities",
      description:
        "Found 3 packages with known security vulnerabilities. Update to latest secure versions.",
      priority: Priority.CRITICAL,
      impact: "Prevents potential security exploits and data breaches",
      status: RecommendationStatus.PENDING,
    },
  });

  const refactoringRun = await db.janitorRun.create({
    data: {
      janitorConfigId: janitorConfig.id,
      janitorType: JanitorType.GENERAL_REFACTORING,
      status: JanitorStatus.COMPLETED,
      triggeredBy: JanitorTrigger.MANUAL,
      startedAt: new Date(Date.now() - 10800000), // 3 hours ago
      completedAt: new Date(Date.now() - 10200000), // 2h 50m ago
      metadata: { filesAnalyzed: 89, refactoringOpportunities: 12 },
    },
  });

  await db.janitorRecommendation.create({
    data: {
      janitorRunId: refactoringRun.id,
      workspaceId,
      title: "Extract duplicate code into shared utilities",
      description:
        "Found 12 instances of duplicate code that could be extracted into reusable utility functions.",
      priority: Priority.MEDIUM,
      impact: "Improves code maintainability and reduces technical debt",
      status: RecommendationStatus.PENDING,
    },
  });

  // Add FAILED JanitorRun
  const failedRun = await db.janitorRun.create({
    data: {
      janitorConfigId: janitorConfig.id,
      janitorType: JanitorType.INTEGRATION_TESTS,
      status: JanitorStatus.FAILED,
      triggeredBy: JanitorTrigger.SCHEDULED,
      startedAt: new Date(Date.now() - 5400000), // 1.5 hours ago
      completedAt: new Date(Date.now() - 5100000), // 1h 25m ago
      metadata: { error: "Database connection timeout", filesAnalyzed: 15 },
    },
  });

  // Add RUNNING JanitorRun
  await db.janitorRun.create({
    data: {
      janitorConfigId: janitorConfig.id,
      janitorType: JanitorType.SECURITY_REVIEW,
      status: JanitorStatus.RUNNING,
      triggeredBy: JanitorTrigger.MANUAL,
      startedAt: new Date(Date.now() - 1800000), // 30 min ago
      metadata: { progress: 65, filesScanned: 98, currentFile: "src/services/auth.ts" },
    },
  });

  // Add DISMISSED JanitorRecommendation
  await db.janitorRecommendation.create({
    data: {
      janitorRunId: failedRun.id,
      workspaceId,
      title: "Add type annotations to legacy JavaScript files",
      description:
        "Found 45 JavaScript files without TypeScript type annotations. Consider migrating to TypeScript.",
      priority: Priority.LOW,
      impact: "Improves type safety and developer experience",
      status: RecommendationStatus.DISMISSED,
    },
  });

  // Add ACCEPTED JanitorRecommendation with linked task
  const acceptedRecommendation = await db.janitorRecommendation.create({
    data: {
      janitorRunId: janitorRun.id,
      workspaceId,
      title: "Implement error boundary components",
      description:
        "Add React Error Boundaries to catch and handle component errors gracefully. This will improve user experience when errors occur.",
      priority: Priority.HIGH,
      impact: "Prevents entire app crashes and provides better error handling UX",
      status: RecommendationStatus.ACCEPTED,
    },
  });

  // Create linked task for accepted recommendation
  await db.task.create({
    data: {
      title: acceptedRecommendation.title,
      description: acceptedRecommendation.description,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: TaskStatus.TODO,
      workflowStatus: WorkflowStatus.PENDING,
      priority: acceptedRecommendation.priority,
      sourceType: TaskSourceType.JANITOR,
      janitorType: JanitorType.GENERAL_REFACTORING,
    },
  });
}

/**
 * Seeds StakworkRuns for AI generation history
 * Creates 2-3 runs per feature with realistic types and statuses
 * Some runs have decision=null to test "needs attention" feature
 */
async function seedStakworkRuns(
  workspaceId: string,
  features: Array<{ id: string; title: string }>
): Promise<void> {
  const mockWebhookUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  for (const feature of features) {
    // Determine if this feature should need attention (first 2 features)
    const needsAttention = features.indexOf(feature) < 2;

    // Architecture run (completed - needs attention for some features)
    await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId: feature.id,
        type: StakworkRunType.ARCHITECTURE,
        webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
        projectId: Math.floor(Math.random() * 10000),
        status: WorkflowStatus.COMPLETED,
        result: JSON.stringify({
          architecture: "Microservices with event-driven communication",
          components: ["API Gateway", "Auth Service", "Data Service"],
          technologies: ["Node.js", "PostgreSQL", "Redis", "Docker"],
        }),
        dataType: "json",
        decision: needsAttention ? null : StakworkRunDecision.ACCEPTED, // null = needs attention
        createdAt: new Date(Date.now() - 86400000 * 2), // 2 days ago
        updatedAt: new Date(Date.now() - 86400000 * 2),
      },
    });

    // Requirements run (completed)
    await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId: feature.id,
        type: StakworkRunType.REQUIREMENTS,
        webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
        projectId: Math.floor(Math.random() * 10000),
        status: WorkflowStatus.COMPLETED,
        result: `Functional Requirements:
- User authentication with OAuth 2.0
- Session management with secure cookies
- Role-based access control (RBAC)
- Multi-factor authentication support

Non-Functional Requirements:
- Response time < 200ms for authentication
- 99.9% uptime
- GDPR compliance for user data`,
        dataType: "string",
        decision: StakworkRunDecision.ACCEPTED,
        createdAt: new Date(Date.now() - 86400000 * 1.5), // 1.5 days ago
        updatedAt: new Date(Date.now() - 86400000 * 1.5),
      },
    });

    // User stories run (in progress for some, completed for others)
    const userStoriesStatus =
      feature.title === "Dashboard Analytics"
        ? WorkflowStatus.IN_PROGRESS
        : WorkflowStatus.COMPLETED;

    await db.stakworkRun.create({
      data: {
        workspaceId,
        featureId: feature.id,
        type: StakworkRunType.USER_STORIES,
        webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
        projectId: Math.floor(Math.random() * 10000),
        status: userStoriesStatus,
        result:
          userStoriesStatus === WorkflowStatus.COMPLETED
            ? JSON.stringify([
                {
                  title: "As a user, I want to log in quickly",
                  acceptance: "Login completes in under 2 seconds",
                },
                {
                  title: "As an admin, I want to manage user roles",
                  acceptance: "Can assign/revoke roles from admin panel",
                },
              ])
            : null,
        dataType: "json",
        decision:
          userStoriesStatus === WorkflowStatus.COMPLETED
            ? StakworkRunDecision.ACCEPTED
            : null,
        createdAt: new Date(Date.now() - 86400000), // 1 day ago
        updatedAt: new Date(Date.now() - 86400000),
      },
    });

    // Task generation run (only for completed features)
    if (feature.title === "User Authentication") {
      await db.stakworkRun.create({
        data: {
          workspaceId,
          featureId: feature.id,
          type: StakworkRunType.TASK_GENERATION,
          webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
          projectId: Math.floor(Math.random() * 10000),
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({
            tasks: [
              {
                title: "Implement OAuth provider integration",
                description: "Set up GitHub OAuth provider",
                priority: "HIGH",
              },
              {
                title: "Create user session management",
                description: "Implement JWT-based sessions",
                priority: "HIGH",
              },
              {
                title: "Add password reset flow",
                description: "Email-based password reset",
                priority: "MEDIUM",
              },
            ],
          }),
          dataType: "json",
          decision: StakworkRunDecision.ACCEPTED,
          createdAt: new Date(Date.now() - 86400000 * 0.5), // 12 hours ago
          updatedAt: new Date(Date.now() - 86400000 * 0.5),
        },
      });
    }

    // Pod repair run (for first feature)
    if (features.indexOf(feature) === 0) {
      await db.stakworkRun.create({
        data: {
          workspaceId,
          featureId: feature.id,
          type: StakworkRunType.POD_REPAIR,
          webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
          projectId: Math.floor(Math.random() * 10000),
          status: WorkflowStatus.COMPLETED,
          result: JSON.stringify({
            podId: "pod-123-repair",
            diagnostics: {
              cpuUsage: "85%",
              memoryUsage: "92%",
              diskUsage: "78%",
              networkLatency: "45ms",
              healthCheckStatus: "degraded",
            },
            repairActions: [
              "Restarted pod due to memory leak",
              "Cleared application cache (2.3 GB freed)",
              "Updated environment configuration",
              "Restarted nginx service",
              "Validated database connections",
            ],
            successMetrics: {
              uptime: "99.9%",
              averageLatency: "45ms",
              throughput: "5000 req/s",
              errorRate: "0.01%",
              recoveryTime: "120s",
            },
            timestamp: new Date().toISOString(),
            resolution: "Pod successfully repaired and returned to healthy state",
          }),
          dataType: "json",
          decision: StakworkRunDecision.ACCEPTED,
          createdAt: new Date(Date.now() - 86400000 * 0.25), // 6 hours ago
          updatedAt: new Date(Date.now() - 86400000 * 0.25),
        },
      });
    }

    // Pod launch failure run (for second feature)
    if (features.indexOf(feature) === 1) {
      await db.stakworkRun.create({
        data: {
          workspaceId,
          featureId: feature.id,
          type: StakworkRunType.POD_LAUNCH_FAILURE,
          webhookUrl: `${mockWebhookUrl}/api/stakwork/webhook`,
          projectId: Math.floor(Math.random() * 10000),
          status: WorkflowStatus.FAILED,
          result: JSON.stringify({
            podId: "pod-456-failed",
            error: {
              code: "LAUNCH_FAILURE",
              message: "Failed to launch pod due to insufficient resources",
              details: "Pool capacity exceeded. No available pods in the specified instance type.",
            },
            diagnostics: {
              requestedInstanceType: "XL",
              availableCapacity: 0,
              queuePosition: 3,
              estimatedWaitTime: "15-20 minutes",
            },
            failureReason: "INSUFFICIENT_CAPACITY",
            attemptCount: 3,
            lastAttempt: new Date().toISOString(),
            suggestedActions: [
              "Wait for capacity to become available",
              "Try a different instance type (L or M)",
              "Contact support to increase pool capacity",
              "Schedule launch during off-peak hours",
            ],
          }),
          dataType: "json",
          decision: StakworkRunDecision.REJECTED,
          createdAt: new Date(Date.now() - 86400000 * 0.1), // 2.4 hours ago
          updatedAt: new Date(Date.now() - 86400000 * 0.1),
        },
      });
    }
  }

  console.log(`[MockSeed] Created StakworkRuns for ${features.length} features`);
}

/**
 * Seeds Screenshots for USER_JOURNEY tasks
 * Creates 2-3 screenshots per task with realistic metadata
 */
async function seedScreenshots(
  workspaceId: string,
  userJourneyTasks: Array<{ id: string; title: string }>
): Promise<void> {
  for (const task of userJourneyTasks) {
    // Screenshot 1: Initial page load
    await db.screenshot.create({
      data: {
        workspaceId,
        taskId: task.id,
        s3Key: `screenshots/${workspaceId}/mock-${task.id}-step1.jpg`,
        actionIndex: 0,
        pageUrl: "http://localhost:3000/login",
        timestamp: BigInt(Date.now() - 60000), // 1 minute ago
        hash: `hash-${task.id}-1`,
        width: 1920,
        height: 1080,
      },
    });

    // Screenshot 2: Form interaction
    await db.screenshot.create({
      data: {
        workspaceId,
        taskId: task.id,
        s3Key: `screenshots/${workspaceId}/mock-${task.id}-step2.jpg`,
        actionIndex: 1,
        pageUrl: "http://localhost:3000/login",
        timestamp: BigInt(Date.now() - 45000), // 45 seconds ago
        hash: `hash-${task.id}-2`,
        width: 1920,
        height: 1080,
      },
    });

    // Screenshot 3: Success state (only for completed tasks)
    if (task.title.includes("Login")) {
      await db.screenshot.create({
        data: {
          workspaceId,
          taskId: task.id,
          s3Key: `screenshots/${workspaceId}/mock-${task.id}-step3.jpg`,
          actionIndex: 2,
          pageUrl: "http://localhost:3000/dashboard",
          timestamp: BigInt(Date.now() - 30000), // 30 seconds ago
          hash: `hash-${task.id}-3`,
          width: 1920,
          height: 1080,
        },
      });
    }
  }

  console.log(
    `[MockSeed] Created screenshots for ${userJourneyTasks.length} USER_JOURNEY tasks`
  );
}

/**
 * Seeds Attachments linked to chat messages
 * Creates 3-5 attachments (screenshot, log, config) with realistic metadata
 */
async function seedAttachments(
  workspaceId: string,
  tasks: Array<{ id: string; title: string }>
): Promise<void> {
  // Get chat messages to link attachments to
  const messagesWithTasks = await db.chatMessage.findMany({
    where: {
      taskId: { in: tasks.slice(0, 6).map(t => t.id) },
      role: "ASSISTANT",
    },
    select: { id: true, taskId: true },
    take: 6,
  });

  if (messagesWithTasks.length === 0) {
    console.log("[MockSeed] No chat messages found for attachments");
    return;
  }

  const attachmentTemplates = [
    {
      filename: "screenshot.png",
      mimeType: "image/png",
      size: 245000,
    },
    {
      filename: "error.log",
      mimeType: "text/plain",
      size: 8500,
    },
    {
      filename: "config.json",
      mimeType: "application/json",
      size: 3200,
    },
    {
      filename: "debug-trace.txt",
      mimeType: "text/plain",
      size: 12400,
    },
    {
      filename: "api-response.json",
      mimeType: "application/json",
      size: 5600,
    },
    {
      filename: "recording.mp4",
      mimeType: "video/mp4",
      size: 1240000,
    },
  ];

  let attachmentCount = 0;

  for (let i = 0; i < Math.min(messagesWithTasks.length, attachmentTemplates.length); i++) {
    const message = messagesWithTasks[i];
    const template = attachmentTemplates[i];

    // Check if attachment already exists for idempotency
    const exists = await db.attachment.findFirst({
      where: {
        AND: [
          { messageId: message.id },
          { filename: template.filename },
        ],
      },
    });

    if (exists) {
      continue;
    }

    // Create attachment
    await db.attachment.create({
      data: {
        messageId: message.id,
        filename: template.filename,
        mimeType: template.mimeType,
        size: template.size,
        path: `attachments/${workspaceId}/${message.taskId}/${template.filename}`,
      },
    });

    attachmentCount++;
  }

  console.log(`[MockSeed] Created ${attachmentCount} attachments`);
}

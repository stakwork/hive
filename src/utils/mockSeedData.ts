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

  // Create features with phases and user stories
  const features = await seedFeatures(userId, workspaceId);

  // Create tasks of various types (with team member assignments and pod links)
  const { tasksWithPods, allTasks } = await seedTasks(userId, workspaceId, features, teamMemberIds);

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

  console.log("[MockSeed] Mock data seeding complete");
}

/**
 * Creates fake team members with various roles
 */
async function seedTeamMembers(workspaceId: string): Promise<string[]> {
  const fakeMembers = [
    { name: "Alice Chen", email: "alice.chen@example.com", role: WorkspaceRole.ADMIN },
    { name: "Bob Martinez", email: "bob.martinez@example.com", role: WorkspaceRole.PM },
    { name: "Carol Johnson", email: "carol.johnson@example.com", role: WorkspaceRole.DEVELOPER },
    { name: "David Kim", email: "david.kim@example.com", role: WorkspaceRole.DEVELOPER },
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
  workspaceId: string
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
    },
    {
      title: "API Rate Limiting",
      brief: "Implement rate limiting for public API endpoints",
      status: FeatureStatus.PLANNED,
      priority: FeaturePriority.MEDIUM,
      requirements:
        "Configurable limits per endpoint, graceful degradation, monitoring",
      personas: ["Developer", "DevOps"],
    },
  ];

  const features: Array<{ id: string; title: string; phaseId: string }> = [];

  for (const data of featureData) {
    const feature = await db.feature.create({
      data: {
        ...data,
        workspaceId,
        createdById: userId,
        updatedById: userId,
      },
      select: { id: true, title: true },
    });

    // Create phases for each feature (returns the first phase ID for task linking)
    const phaseId = await seedPhases(feature.id, data.status);

    features.push({ ...feature, phaseId });

    // Create user stories
    await seedUserStories(userId, feature.id);
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
  teamMemberIds: string[]
): Promise<{ tasksWithPods: TaskWithPod[]; allTasks: Array<{ id: string; title: string; status: TaskStatus; sourceType: TaskSourceType }> }> {
  const mockPodUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const taskTemplates = [
    // USER tasks - various statuses
    {
      title: "Review authentication PR #42",
      description:
        "Review the pull request for the new OAuth implementation. Check for security issues and code quality.",
      status: TaskStatus.TODO,
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
      status: TaskStatus.DONE,
      workflowStatus: WorkflowStatus.COMPLETED,
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
        podId,
        agentUrl,
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
          files: [
            {
              path: "src/components/Dashboard.tsx",
              additions: 25,
              deletions: 8,
              diff: `@@ -1,8 +1,25 @@
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
          ],
          summary: `Changes for: ${task.title}`,
        },
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

      await db.artifact.create({
        data: {
          messageId: prMsg.id,
          type: ArtifactType.PULL_REQUEST,
          content: {
            number: Math.floor(Math.random() * 1000) + 1,
            title: `feat: ${task.title}`,
            state: "merged",
            url: `https://github.com/stakwork/hive/pull/${Math.floor(Math.random() * 1000) + 1}`,
            additions: 125,
            deletions: 45,
            changedFiles: 8,
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

  console.log(`[MockSeed] Created chat messages with artifacts for ${tasks.length} tasks`);
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
}

/**
 * Seeds StakworkRuns for AI generation history
 * Creates 2-3 runs per feature with realistic types and statuses
 */
async function seedStakworkRuns(
  workspaceId: string,
  features: Array<{ id: string; title: string }>
): Promise<void> {
  const mockWebhookUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  for (const feature of features) {
    // Architecture run (completed)
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
        decision: StakworkRunDecision.ACCEPTED,
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

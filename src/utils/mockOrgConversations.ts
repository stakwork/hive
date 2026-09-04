/**
 * Mock org-canvas Jamie chats for the control panel demo.
 *
 * Seeds three conversations for the mock user on an org they can open,
 * wired the way real ones are: two of them spawned plans (the plans
 * point back via `Feature.parentCanvasConversationId`, the chat carries
 * the outbound `send_to_feature_planner` tool call and the planner's
 * fan-out rows), one plan has tasks, and one planner is waiting on a
 * clarifying question. So chat → plan → task is a real chain on the
 * control panel, and the state glyphs light up for real reasons.
 *
 * The plans hang off the seeded features (`seedMockData`) in whichever
 * of the org's workspaces the user owns or belongs to — the personal
 * mock org has one (`mock-stakgraph`), `mock-org` has two. Idempotent
 * on its own chats (they carry a `settings.seed` marker), so a user who
 * started chats of their own first still gets the demo on the next mock
 * sign-in.
 */
import { db } from "@/lib/db";
import { ArtifactType, ChatRole, Priority, TaskSourceType, TaskStatus, WorkflowStatus } from "@prisma/client";

const SEND_TO_FEATURE_PLANNER = "send_to_feature_planner";
const SEED_SETTINGS = { seed: "control-panel" };
const SEED_TITLES = {
  kickoff: "Q4 platform kickoff",
  rollout: "Advanced search rollout",
  today: "What needs me today",
};

interface FeatureRef {
  id: string;
  title: string;
  taskCount: number;
}

interface WorkspaceRef {
  id: string;
  slug: string;
  name: string;
  features: FeatureRef[];
}

/** A seeded feature and the workspace it lives in. */
interface PlanRef {
  feature: FeatureRef;
  workspace: WorkspaceRef;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

function userRow(id: string, content: string, at: Date) {
  return { id, role: "user", content, timestamp: at.toISOString() };
}

function assistantRow(id: string, content: string, at: Date, extra: Record<string, unknown> = {}) {
  return { id, role: "assistant", content, timestamp: at.toISOString(), ...extra };
}

/** The row `fanOutPlannerMessageToCanvas` appends when a planner posts. */
function plannerRow(id: string, plan: PlanRef, content: string, at: Date, extra: Record<string, unknown> = {}) {
  return assistantRow(id, content, at, {
    source: {
      kind: "planner",
      featureId: plan.feature.id,
      plannerMessageId: `mock-planner-${id}`,
      featureTitle: plan.feature.title,
      workspaceSlug: plan.workspace.slug,
      workspaceName: plan.workspace.name,
      ...extra,
    },
  });
}

/** The outbound tool call the canvas agent makes when it hands a plan to its planner. */
function sendToPlannerCall(plan: PlanRef, message: string) {
  return {
    id: `mock-tc-${plan.feature.id}`,
    toolName: SEND_TO_FEATURE_PLANNER,
    status: "output-available",
    input: { featureId: plan.feature.id, message },
    output: {
      status: "sent",
      featureId: plan.feature.id,
      featureTitle: plan.feature.title,
      workspaceSlug: plan.workspace.slug,
      workspaceName: plan.workspace.name,
    },
  };
}

/**
 * Spread creation and update times over the past week so the control
 * panel's day groups read like real activity instead of one "Today"
 * block. `updatedAt` is set explicitly: a plan's activity is what the
 * panel sorts by, and a seed run must not make every plan "just now".
 */
async function backdateOrgThreads(workspaces: WorkspaceRef[]): Promise<void> {
  for (const ws of workspaces) {
    await Promise.all(
      ws.features.map((f, i) => {
        const at = hoursAgo(24 * (i + 1) + 2);
        return db.feature.update({ where: { id: f.id }, data: { createdAt: at, updatedAt: at } });
      }),
    );
  }
  const tasks = await db.task.findMany({
    where: { workspaceId: { in: workspaces.map((w) => w.id) }, deleted: false },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  await Promise.all(
    tasks.map((t, j) => {
      const at = hoursAgo(24 * (j % 6) + (j % 9) + 1);
      return db.task.update({ where: { id: t.id }, data: { createdAt: at, updatedAt: at } });
    }),
  );
}

export async function ensureMockOrgConversations(orgId: string, userId: string): Promise<void> {
  const existing = await db.sharedConversation.count({
    where: {
      sourceControlOrgId: orgId,
      userId,
      source: "org-canvas",
      settings: { path: ["seed"], equals: SEED_SETTINGS.seed },
    },
  });
  if (existing > 0) return;

  const rows = await db.workspace.findMany({
    where: {
      sourceControlOrgId: orgId,
      deleted: false,
      OR: [{ ownerId: userId }, { members: { some: { userId, leftAt: null } } }],
    },
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      features: {
        where: { deleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          _count: { select: { tasks: { where: { deleted: false, archived: false } } } },
        },
      },
    },
  });
  const workspaces: WorkspaceRef[] = rows.map((w) => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    features: w.features.map((f) => ({ id: f.id, title: f.title, taskCount: f._count.tasks })),
  }));
  if (workspaces.length === 0) return;

  // Spread the plans across the org's workspaces when it has more than
  // one; otherwise they all live in the one it has.
  const planFor = (title: string, slot: number): PlanRef | null => {
    const preferred = workspaces[slot % workspaces.length];
    for (const workspace of [preferred, ...workspaces]) {
      const feature = workspace.features.find((f) => f.title === title);
      if (feature) return { feature, workspace };
    }
    return null;
  };
  const dashboard = planFor("Dashboard Analytics", 0);
  const rateLimit = planFor("API Rate Limiting", 1);
  const search = planFor("Advanced Search Filters", 0);
  if (!dashboard || !rateLimit || !search) return;

  await backdateOrgThreads(workspaces);

  // ── Chat 1: kickoff → two plans; one planner is waiting on an answer ──
  const kickoff = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      workspaceId: null,
      source: "org-canvas",
      title: SEED_TITLES.kickoff,
      isShared: false,
      followUpQuestions: [],
      settings: SEED_SETTINGS,
      createdAt: hoursAgo(26),
      lastMessageAt: hoursAgo(3),
      // Seen before the planner's question landed → unread on the panel.
      ownerSeenAt: hoursAgo(4),
      messages: [
        userRow(
          "kickoff-1",
          "Let's kick off Q4 platform modernization. Start with the analytics dashboard and API rate limiting.",
          hoursAgo(26),
        ),
        assistantRow(
          "kickoff-2",
          "Two plans, two planners. I've sent both briefs; their updates land here as they post.",
          hoursAgo(25.9),
          {
            toolCalls: [
              sendToPlannerCall(
                dashboard,
                "Plan the real-time analytics dashboard: completion rates, velocity, coverage trends.",
              ),
              sendToPlannerCall(rateLimit, "Plan API rate limiting with per-key limits and a workspace cap."),
            ],
          },
        ),
        plannerRow(
          "kickoff-3",
          dashboard,
          "Posted the plan. Brief, user stories, requirements and architecture are ready, and the tasks are generated.",
          hoursAgo(24),
          { workflowStatus: WorkflowStatus.IN_PROGRESS, hasTasks: true },
        ),
        userRow("kickoff-4", "How's rate limiting going?", hoursAgo(5)),
        plannerRow(
          "kickoff-5",
          rateLimit,
          "Before I split this into tasks: should limits apply per API key or per workspace?",
          hoursAgo(3),
          {
            workflowStatus: WorkflowStatus.PENDING,
            hasForm: true,
            formQuestions: [
              {
                question: "Should rate limits apply per API key or per workspace?",
                type: "single_choice",
                options: ["Per API key", "Per workspace", "Both, key limit under a workspace cap"],
              },
            ],
          },
        ),
      ],
    },
    select: { id: true },
  });

  // The planners last touched their plans when their fan-out rows say.
  await db.feature.update({
    where: { id: dashboard.feature.id },
    data: {
      parentCanvasConversationId: kickoff.id,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      updatedAt: hoursAgo(24),
    },
  });
  await db.feature.update({
    where: { id: rateLimit.feature.id },
    data: {
      parentCanvasConversationId: kickoff.id,
      workflowStatus: WorkflowStatus.PENDING,
      updatedAt: hoursAgo(3),
    },
  });

  // The rate-limit plan chat: the user spoke, then the planner asked a
  // question (FORM artifact) → "Question waiting" on the plan row.
  await db.chatMessage.create({
    data: {
      featureId: rateLimit.feature.id,
      userId,
      role: ChatRole.USER,
      message: "Prioritize the enterprise tier first; free tier can wait.",
      timestamp: hoursAgo(6),
    },
  });
  const rateLimitQuestion = await db.chatMessage.create({
    data: {
      featureId: rateLimit.feature.id,
      role: ChatRole.ASSISTANT,
      message: "Before I split this into tasks: should limits apply per API key or per workspace?",
      timestamp: hoursAgo(3),
    },
  });
  await db.artifact.create({
    data: {
      messageId: rateLimitQuestion.id,
      type: ArtifactType.FORM,
      content: {
        formId: "rate-limit-scope-v1",
        title: "Rate limit scope",
        fields: [
          {
            name: "scope",
            type: "select",
            required: true,
            label: "Apply limits",
            options: ["Per API key", "Per workspace", "Both"],
          },
        ],
        schema: {
          type: "object",
          properties: { scope: { type: "string", enum: ["Per API key", "Per workspace", "Both"] } },
          required: ["scope"],
        },
      },
    },
  });

  // ── Chat 2: one plan, tasks running under it ─────────────────────────
  const rollout = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      workspaceId: null,
      source: "org-canvas",
      title: SEED_TITLES.rollout,
      isShared: false,
      followUpQuestions: [],
      settings: SEED_SETTINGS,
      createdAt: hoursAgo(72),
      lastMessageAt: hoursAgo(49.9),
      ownerSeenAt: hoursAgo(49),
      messages: [
        userRow("search-1", "Plan the advanced search filters rollout.", hoursAgo(72)),
        assistantRow("search-2", "Sent to the planner with the brief as written.", hoursAgo(71.9), {
          toolCalls: [sendToPlannerCall(search, "Plan the advanced search filters rollout.")],
        }),
        plannerRow("search-3", search, "Posted the plan and generated the task breakdown.", hoursAgo(70), {
          workflowStatus: WorkflowStatus.COMPLETED,
          hasTasks: true,
        }),
        userRow("search-4", "Start the tasks.", hoursAgo(50)),
        assistantRow(
          "search-5",
          "Started. Two agents picked up the first tasks; the plan shows their progress.",
          hoursAgo(49.9),
        ),
      ],
    },
    select: { id: true },
  });

  await db.feature.update({
    where: { id: search.feature.id },
    data: {
      parentCanvasConversationId: rollout.id,
      workflowStatus: WorkflowStatus.COMPLETED,
      updatedAt: hoursAgo(70),
    },
  });

  if (search.feature.taskCount < 3) {
    const taskSeeds = [
      {
        title: "Filter chips for status and assignee",
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        mode: "agent",
        createdAt: hoursAgo(48),
      },
      {
        title: "Saved filter presets",
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.COMPLETED,
        mode: "live",
        createdAt: hoursAgo(47),
      },
      {
        title: "Filter query parser",
        status: TaskStatus.TODO,
        workflowStatus: WorkflowStatus.PENDING,
        mode: "live",
        createdAt: hoursAgo(46),
      },
    ];
    for (const seed of taskSeeds) {
      const task = await db.task.create({
        data: {
          title: seed.title,
          description: `${seed.title} — part of the advanced search rollout.`,
          workspaceId: search.workspace.id,
          featureId: search.feature.id,
          createdById: userId,
          updatedById: userId,
          status: seed.status,
          workflowStatus: seed.workflowStatus,
          mode: seed.mode,
          priority: Priority.MEDIUM,
          sourceType: TaskSourceType.USER,
          createdAt: seed.createdAt,
          updatedAt: seed.createdAt,
        },
        select: { id: true },
      });
      if (seed.title === "Filter chips for status and assignee") {
        await db.chatMessage.create({
          data: {
            taskId: task.id,
            userId,
            role: ChatRole.USER,
            message: "Use the existing chip component; don't add a new one.",
            timestamp: hoursAgo(20),
          },
        });
      }
    }
  }

  // ── Chat 3: today's check-in, no plans ───────────────────────────────
  await db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      workspaceId: null,
      source: "org-canvas",
      title: SEED_TITLES.today,
      isShared: false,
      followUpQuestions: [],
      settings: SEED_SETTINGS,
      createdAt: hoursAgo(0.7),
      lastMessageAt: hoursAgo(0.68),
      ownerSeenAt: new Date(),
      messages: [
        userRow("today-1", "What needs me today?", hoursAgo(0.7)),
        assistantRow(
          "today-2",
          "Three things:\n\n1. **API Rate Limiting** — the planner is waiting on a limits decision.\n2. **Saved filter presets** — the agent finished; it's ready for your review.\n3. **Fix login redirect bug** — halted on a failing test.\n\nWant me to open any of them?",
          hoursAgo(0.68),
        ),
      ],
    },
  });
}

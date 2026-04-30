/**
 * One-off dev script to backfill the "attention-card showcase" data
 * onto already-seeded mock-org workspaces. Existing seeds in
 * `src/utils/mockSeedData.ts` early-return when a workspace already
 * has features, so users who signed in before the showcase rows
 * landed never get them. This script tops up just those missing
 * rows without re-running the full seed.
 *
 * Idempotent: each insertion checks for an existing row by title /
 * predicate first. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-attention-showcase.ts --userId <id>
 *   npx tsx scripts/backfill-attention-showcase.ts --email you@example.com
 *   npx tsx scripts/backfill-attention-showcase.ts --githubUsername <handle>
 *   npx tsx scripts/backfill-attention-showcase.ts        # picks most recent GH user
 */
import {
  ArtifactType,
  FeaturePriority,
  FeatureStatus,
  PrismaClient,
  Priority,
  TaskSourceType,
  TaskStatus,
  WorkflowStatus,
} from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const db = new PrismaClient();

interface Args {
  userId?: string;
  email?: string;
  githubUsername?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--userId" && value) out.userId = value;
    else if (flag === "--email" && value) out.email = value;
    else if (flag === "--githubUsername" && value) out.githubUsername = value;
  }
  return out;
}

async function resolveUser(args: Args) {
  if (args.userId) {
    const u = await db.user.findUnique({ where: { id: args.userId } });
    if (!u) throw new Error(`No user found for id ${args.userId}`);
    return u;
  }
  if (args.email) {
    const u = await db.user.findUnique({ where: { email: args.email } });
    if (!u) throw new Error(`No user found for email ${args.email}`);
    return u;
  }
  if (args.githubUsername) {
    const gh = await db.gitHubAuth.findFirst({
      where: { githubUsername: args.githubUsername },
      include: { user: true },
    });
    if (!gh?.user) throw new Error(`No user for githubUsername ${args.githubUsername}`);
    return gh.user;
  }
  // Default: most recent GitHubAuth.
  const latest = await db.gitHubAuth.findFirst({
    orderBy: { updatedAt: "desc" },
    include: { user: true },
  });
  if (!latest?.user) throw new Error("No users found in DB");
  return latest.user;
}

/**
 * Per-workspace seed variants. Each workspace gets a DIFFERENT
 * showcase item per signal type so the org-canvas attention card
 * surfaces distinct work across multi-workspace orgs (rather than
 * the same title repeated). Variants cycle by workspace index.
 */
interface ShowcaseVariant {
  halted: { title: string; description: string };
  failed: { title: string; description: string };
  review: { title: string; description: string };
  form: {
    title: string;
    description: string;
    formMessage: string;
    formId: string;
    formTitle: string;
    fields: Array<{ name: string; type: string; required: boolean; label: string; options?: string[] }>;
  };
  feature: { title: string; brief: string; requirements: string; assistantMessage: string };
}

const VARIANTS: ShowcaseVariant[] = [
  {
    halted: {
      title: "Migrate billing webhook to Stripe v2024-04-10",
      description:
        "Agent hit an unrecoverable error: Stripe API returned 401 on the new event signature. Needs a refreshed restricted key.",
    },
    failed: {
      title: "Backfill display names for legacy users",
      description:
        "Schema migration script raised a unique-constraint violation. Transaction rolled back; needs deterministic fallback.",
    },
    review: {
      title: "Add CSV export to billing reports",
      description:
        "Agent implemented streaming CSV export with the requested columns. PR opened; awaits human review before merge.",
    },
    form: {
      title: "Configure new staging environment domain",
      description:
        "Agent paused for confirmation: which subdomain should the staging environment use, and which Vercel project owns it?",
      formMessage:
        "Before I provision the staging domain, I need a couple of decisions from you:",
      formId: "staging-domain-config-v1",
      formTitle: "Staging environment configuration",
      fields: [
        { name: "subdomain", type: "text", required: true, label: "Subdomain (e.g. staging-eu)" },
        {
          name: "vercelProject",
          type: "select",
          required: true,
          label: "Vercel project",
          options: ["web-app", "marketing-site", "admin-portal"],
        },
      ],
    },
    feature: {
      title: "Onboarding flow redesign",
      brief:
        "Refresh the post-signup checklist with progressive disclosure and a 'snooze' affordance for skipped steps.",
      requirements:
        "Three-step checklist, animated transitions, persistent dismissal state per step.",
      assistantMessage:
        "I started a draft of the new onboarding flow. Quick question before I keep going: do we want to support a fourth 'team setup' step for org accounts, or keep it strictly 3 steps for everyone?",
    },
  },
  {
    halted: {
      title: "Rotate expired DataDog API keys across services",
      description:
        "Agent halted: detected mismatched parent/child key prefixes between staging and prod. Needs human to confirm rotation order.",
    },
    failed: {
      title: "Reindex search corpus after schema rename",
      description:
        "Reindex job crashed mid-run with OOM. Last successful checkpoint was 4h ago; needs decision on resume vs full rebuild.",
    },
    review: {
      title: "Bulk-tag inactive accounts for retention emails",
      description:
        "Agent finished tagging 8,432 candidate accounts. Review the sample distribution before the email send fires.",
    },
    form: {
      title: "Pick a sender domain for transactional email",
      description:
        "Agent stopped to confirm DNS ownership before configuring SES — pick the verified domain to use as From address.",
      formMessage:
        "I'm ready to wire up the transactional email service. Two quick choices:",
      formId: "email-sender-v1",
      formTitle: "Transactional email sender",
      fields: [
        {
          name: "domain",
          type: "select",
          required: true,
          label: "Sender domain",
          options: ["mail.example.com", "transactional.example.com", "no-reply.example.com"],
        },
        { name: "replyTo", type: "text", required: false, label: "Reply-To address (optional)" },
      ],
    },
    feature: {
      title: "Per-team usage dashboard",
      brief:
        "Roll up workspace activity into a per-team dashboard with weekly/monthly toggles and CSV export.",
      requirements:
        "Aggregate by team, support time-range filters, surface trend lines for tasks/features/PR throughput.",
      assistantMessage:
        "I sketched the data model for the team dashboard. One open question before I scaffold the UI: should the time-range default be the last 7 days or the current calendar month?",
    },
  },
  {
    halted: {
      title: "Reconcile Stripe-vs-internal MRR drift",
      description:
        "Agent detected $4,210 MRR delta this period; halted before posting an adjustment. Needs human sign-off on attribution.",
    },
    failed: {
      title: "Auto-archive stale workspaces (>90 days idle)",
      description:
        "Cron run failed: archival hit a foreign-key constraint on dependent webhook configs. Rollback completed; need updated archival order.",
    },
    review: {
      title: "Lift dashboard query to materialized view",
      description:
        "Agent migrated the slowest dashboard query to a materialized view. p95 dropped 87%; awaits review before merging the migration.",
    },
    form: {
      title: "Choose Slack workspace + channel for build alerts",
      description:
        "Agent has the Slack OAuth token; just needs the target channel and severity threshold for posting build alerts.",
      formMessage:
        "Quick configuration before I enable Slack build alerts:",
      formId: "slack-alerts-v1",
      formTitle: "Slack build alert configuration",
      fields: [
        { name: "channel", type: "text", required: true, label: "Channel (e.g. #builds)" },
        {
          name: "severity",
          type: "select",
          required: true,
          label: "Minimum severity to post",
          options: ["info", "warn", "error"],
        },
      ],
    },
    feature: {
      title: "Inline command palette",
      brief:
        "Cmd-K command palette with workspace switcher, quick-create, and recent-pages history.",
      requirements:
        "Keyboard-only navigation, fuzzy match across workspaces/tasks/features, recent-pages list per user.",
      assistantMessage:
        "I outlined the command palette's command registry shape. Before I commit to the structure: do we want plugins to register commands, or keep it a closed in-app list for v1?",
    },
  },
];

async function backfillWorkspace(
  userId: string,
  workspaceId: string,
  variantIndex: number,
) {
  // Cycle through variants by workspace index. With 3 variants
  // defined and N workspaces, the modulo wraps cleanly — orgs with
  // 4+ workspaces will see one variant repeat, which is fine: cards
  // are still distinct DB rows in distinct workspaces.
  const variant = VARIANTS[variantIndex % VARIANTS.length];

  // ── HALTED task ─────────────────────────────────────────────────
  const existingHalted = await db.task.findFirst({
    where: { workspaceId, title: variant.halted.title, deleted: false },
    select: { id: true },
  });
  if (!existingHalted) {
    await db.task.create({
      data: {
        title: variant.halted.title,
        description: variant.halted.description,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.HALTED,
        sourceType: TaskSourceType.USER,
        priority: Priority.HIGH,
      },
    });
    console.log(`  + halted task: ${variant.halted.title}`);
  }

  // ── FAILED task ─────────────────────────────────────────────────
  const existingFailed = await db.task.findFirst({
    where: { workspaceId, title: variant.failed.title, deleted: false },
    select: { id: true },
  });
  if (!existingFailed) {
    await db.task.create({
      data: {
        title: variant.failed.title,
        description: variant.failed.description,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.FAILED,
        sourceType: TaskSourceType.USER,
        priority: Priority.MEDIUM,
      },
    });
    console.log(`  + failed task: ${variant.failed.title}`);
  }

  // ── READY-TO-REVIEW task (COMPLETED but not DONE) ──────────────
  const existingReview = await db.task.findFirst({
    where: { workspaceId, title: variant.review.title, deleted: false },
    select: { id: true },
  });
  if (!existingReview) {
    await db.task.create({
      data: {
        title: variant.review.title,
        description: variant.review.description,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.COMPLETED,
        sourceType: TaskSourceType.USER,
        priority: Priority.MEDIUM,
      },
    });
    console.log(`  + ready-to-review task: ${variant.review.title}`);
  }

  // ── PLAN-QUESTION task with FORM artifact as latest msg ────────
  let formTask = await db.task.findFirst({
    where: { workspaceId, title: variant.form.title, deleted: false },
    select: { id: true },
  });
  if (!formTask) {
    formTask = await db.task.create({
      data: {
        title: variant.form.title,
        description: variant.form.description,
        workspaceId,
        createdById: userId,
        updatedById: userId,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        sourceType: TaskSourceType.USER,
        priority: Priority.HIGH,
      },
      select: { id: true },
    });
    console.log(`  + plan-question task: ${variant.form.title}`);
  }
  const existingForm = await db.chatMessage.findFirst({
    where: { taskId: formTask.id, artifacts: { some: { type: ArtifactType.FORM } } },
    select: { id: true },
  });
  if (!existingForm) {
    const formMsg = await db.chatMessage.create({
      data: {
        taskId: formTask.id,
        message: variant.form.formMessage,
        role: "ASSISTANT",
      },
    });
    await db.artifact.create({
      data: {
        messageId: formMsg.id,
        type: ArtifactType.FORM,
        content: {
          formId: variant.form.formId,
          title: variant.form.formTitle,
          fields: variant.form.fields,
        },
      },
    });
    console.log(`  + FORM artifact on plan-question task`);
  }

  // ── AWAITING-REPLY feature (user-owned, last-msg ASSISTANT, no tasks) ──
  let feat = await db.feature.findFirst({
    where: { workspaceId, title: variant.feature.title, deleted: false },
    select: { id: true },
  });
  if (!feat) {
    feat = await db.feature.create({
      data: {
        title: variant.feature.title,
        brief: variant.feature.brief,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
        requirements: variant.feature.requirements,
        personas: ["End User", "PM"],
        workspaceId,
        createdById: userId,
        updatedById: userId,
        assigneeId: userId,
      },
      select: { id: true },
    });
    console.log(`  + awaiting-reply feature: ${variant.feature.title}`);
  }
  const existingMsg = await db.chatMessage.findFirst({
    where: { featureId: feat.id },
    select: { id: true, role: true },
    orderBy: { timestamp: "desc" },
  });
  if (!existingMsg || existingMsg.role !== "ASSISTANT") {
    await db.chatMessage.create({
      data: {
        featureId: feat.id,
        message: variant.feature.assistantMessage,
        role: "ASSISTANT",
      },
    });
    console.log(`  + ASSISTANT msg on awaiting-reply feature`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const user = await resolveUser(args);
  console.log(`Backfilling for user ${user.email ?? user.id} (${user.id})`);

  // Find all workspaces the user owns OR is a member of.
  const workspaces = await db.workspace.findMany({
    where: {
      deleted: false,
      OR: [
        { ownerId: user.id },
        { members: { some: { userId: user.id, leftAt: null } } },
      ],
    },
    select: { id: true, slug: true, name: true },
  });

  console.log(`Found ${workspaces.length} workspaces: ${workspaces.map((w) => w.slug).join(", ")}`);

  // Stable variant assignment: sort by slug so re-runs put the same
  // variant in the same workspace.
  workspaces.sort((a, b) => a.slug.localeCompare(b.slug));

  for (let i = 0; i < workspaces.length; i++) {
    const ws = workspaces[i];
    console.log(`\n→ ${ws.slug} (${ws.name}) [variant ${i % VARIANTS.length}]`);
    await backfillWorkspace(user.id, ws.id, i);
  }

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

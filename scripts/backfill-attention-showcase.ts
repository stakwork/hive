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

/**
 * Seed a representative spread of artifacts onto the ready-to-review
 * task so the canvas-sidebar TaskChat surfaces every render path.
 *
 * The mix mirrors the artifact zoo `mockSeedData.ts:seedChatMessagesWithArtifacts`
 * builds for the personal mock workspace, just adapted to a single
 * task and using the `seedMockData` content shapes verbatim. Idempotent
 * by message-content match — re-running the backfill won't duplicate
 * messages.
 *
 * Artifact coverage exercised:
 *   - PULL_REQUEST → inline render via `<PullRequestArtifact>`
 *   - CODE / DIFF / LONGFORM / BOUNTY / PUBLISH_WORKFLOW → pill →
 *     modal (renders via reused panels from
 *     `src/app/w/[slug]/task/[...taskParams]/artifacts/`)
 *   - BROWSER / IDE / WORKFLOW / GRAPH / MEDIA / BUG_REPORT → pill
 *     → external link (`window.open` to the full task page)
 */
async function seedReviewTaskArtifacts(taskId: string, taskTitle: string) {
  // Idempotency key: a unique opener line tied to the task title.
  // Safer than a separate marker row — re-runs match on this and
  // bail without writing anything visible.
  const OPENER = `I've finished the implementation. Here's a quick recap of what I made for "${taskTitle}":`;
  const existing = await db.chatMessage.findFirst({
    where: { taskId, message: OPENER },
    select: { id: true },
  });
  if (existing) return;

  // Opening assistant turn introducing the work.
  await db.chatMessage.create({
    data: { taskId, message: OPENER, role: "ASSISTANT" },
  });

  // ── PULL_REQUEST (inline card) ────────────────────────────────────
  const prMsg = await db.chatMessage.create({
    data: {
      taskId,
      message: "Opened a pull request — CI is green, ready for review:",
      role: "ASSISTANT",
    },
  });
  const prNumber = Math.floor(Math.random() * 900) + 100;
  await db.artifact.create({
    data: {
      messageId: prMsg.id,
      type: ArtifactType.PULL_REQUEST,
      content: {
        repo: "stakwork/hive",
        url: `https://github.com/stakwork/hive/pull/${prNumber}`,
        status: "IN_PROGRESS", // open
        number: prNumber,
        title: `feat: ${taskTitle}`,
        additions: 187,
        deletions: 42,
        changedFiles: 6,
        progress: {
          state: "healthy",
          ciStatus: "success",
          ciSummary: "12/12 checks passed",
        },
      },
    },
  });

  // ── CODE artifact (pill → modal) ──────────────────────────────────
  const codeMsg = await db.chatMessage.create({
    data: {
      taskId,
      message: "Here's the core helper I extracted:",
      role: "ASSISTANT",
    },
  });
  await db.artifact.create({
    data: {
      messageId: codeMsg.id,
      type: ArtifactType.CODE,
      content: {
        language: "typescript",
        filename: "src/lib/billing/csv.ts",
        snippet: `import { Readable } from "node:stream";
import type { BillingRow } from "./types";

/**
 * Stream-write billing rows as CSV. Backpressure-friendly: the
 * upstream Prisma cursor pulls one row at a time and we flush each
 * line eagerly so the response holds at most one row in memory.
 */
export function streamBillingCsv(rows: AsyncIterable<BillingRow>): Readable {
  return Readable.from(
    (async function* () {
      yield "id,workspace,plan,amount_cents,currency,billed_at\\n";
      for await (const r of rows) {
        yield [r.id, r.workspaceSlug, r.plan, r.amountCents, r.currency, r.billedAt.toISOString()].join(",") + "\\n";
      }
    })(),
  );
}`,
      },
    },
  });

  // ── DIFF artifact (pill → modal) ──────────────────────────────────
  const diffMsg = await db.chatMessage.create({
    data: { taskId, message: "Diff summary across the touched files:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: diffMsg.id,
      type: ArtifactType.DIFF,
      content: {
        diffs: [
          {
            file: "src/lib/billing/csv.ts",
            action: "create",
            repoName: "stakwork/hive",
            content: `--- /dev/null
+++ b/src/lib/billing/csv.ts
@@ -0,0 +1,18 @@
+import { Readable } from "node:stream";
+import type { BillingRow } from "./types";
+
+export function streamBillingCsv(rows: AsyncIterable<BillingRow>): Readable {
+  return Readable.from(
+    (async function* () {
+      yield "id,workspace,plan,amount_cents,currency,billed_at\\n";
+      for await (const r of rows) {
+        yield [r.id, r.workspaceSlug, r.plan, r.amountCents, r.currency, r.billedAt.toISOString()].join(",") + "\\n";
+      }
+    })(),
+  );
+}`,
          },
          {
            file: "src/app/api/billing/export/route.ts",
            action: "modify",
            repoName: "stakwork/hive",
            content: `diff --git a/src/app/api/billing/export/route.ts b/src/app/api/billing/export/route.ts
@@ -1,6 +1,12 @@
-export async function GET() {
-  const rows = await db.billingRow.findMany();
-  const csv = rowsToCsv(rows);
-  return new Response(csv, { headers: { "Content-Type": "text/csv" } });
+import { streamBillingCsv } from "@/lib/billing/csv";
+
+export async function GET() {
+  const cursor = db.billingRow.streamMany();
+  const stream = streamBillingCsv(cursor);
+  return new Response(stream as unknown as ReadableStream, {
+    headers: { "Content-Type": "text/csv; charset=utf-8" },
+  });
 }`,
          },
        ],
      },
    },
  });

  // ── LONGFORM artifact (pill → modal) ──────────────────────────────
  const longformMsg = await db.chatMessage.create({
    data: { taskId, message: "Wrote up a quick design note:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: longformMsg.id,
      type: ArtifactType.LONGFORM,
      content: {
        title: `Design note: ${taskTitle}`,
        format: "markdown",
        body: `# ${taskTitle}

## Approach
Streamed the row-set instead of materializing it. The previous endpoint hit a 60s Vercel limit on workspaces with > 30k rows; the streaming version finishes in single-digit seconds for any workspace size because backpressure throttles the writer to the client's read speed.

## Trade-offs
- **No total Content-Length** until the upstream finishes. CDN can't preload, but \`text/csv\` clients don't expect length.
- **No retries on partial failure.** If the upstream cursor errors mid-stream the client sees a truncated CSV with no JSON envelope. Acceptable for an export endpoint; we add an \`x-rows-emitted\` trailer for clients that want to verify completeness.

## Follow-ups
- Add the same pattern to \`/api/billing/usage/export\` (next sprint).
- Consider gzipping the response — 4× smaller payloads in the staging benchmark.`,
      },
    },
  });

  // ── BOUNTY artifact (pill → modal) ────────────────────────────────
  const bountyMsg = await db.chatMessage.create({
    data: { taskId, message: "Logged a small bounty for the follow-up gzip work:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: bountyMsg.id,
      type: ArtifactType.BOUNTY,
      content: {
        bountyCode: "BNT-CSV-GZIP-1",
        title: "Gzip the streaming CSV response",
        amount: 50,
        currency: "USD",
        status: "open",
        description:
          "Wire `zlib.createGzip()` into the streaming response when the client `Accept-Encoding` includes `gzip`. Bench against the 30k-row staging fixture; expect ~4× smaller payload.",
      },
    },
  });

  // ── PUBLISH_WORKFLOW artifact (pill → modal) ──────────────────────
  const publishMsg = await db.chatMessage.create({
    data: { taskId, message: "Promoted the deploy workflow to production:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: publishMsg.id,
      type: ArtifactType.PUBLISH_WORKFLOW,
      content: {
        workflowName: "Production Deploy",
        status: "published",
        version: "v1.2.4",
        environment: "production",
        triggers: ["push", "manual"],
        steps: [
          { name: "Checkout code", status: "completed", duration: "5s" },
          { name: "Install deps", status: "completed", duration: "42s" },
          { name: "Run tests", status: "completed", duration: "1m 12s" },
          { name: "Build", status: "completed", duration: "38s" },
          { name: "Deploy", status: "completed", duration: "1m 03s" },
        ],
      },
    },
  });

  // ── BROWSER artifact (pill → external) ────────────────────────────
  const browserMsg = await db.chatMessage.create({
    data: { taskId, message: "Captured a quick browser session reproducing the fix:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: browserMsg.id,
      type: ArtifactType.BROWSER,
      content: {
        url: "http://localhost:3000/billing/export",
        screenshot: null,
        title: `Preview: ${taskTitle}`,
      },
    },
  });

  // ── IDE artifact (pill → external) ────────────────────────────────
  await db.artifact.create({
    data: {
      messageId: browserMsg.id,
      type: ArtifactType.IDE,
      content: {
        files: [
          { path: "src/lib/billing/csv.ts", language: "typescript" },
          { path: "src/app/api/billing/export/route.ts", language: "typescript" },
        ],
        activeFile: "src/lib/billing/csv.ts",
      },
    },
  });

  // ── WORKFLOW artifact (pill → external) ───────────────────────────
  const workflowMsg = await db.chatMessage.create({
    data: { taskId, message: "Wired the export into the nightly billing workflow:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: workflowMsg.id,
      type: ArtifactType.WORKFLOW,
      content: {
        projectId: "wf-billing-export-nightly",
      },
    },
  });

  // ── GRAPH artifact (pill → external) ──────────────────────────────
  const graphMsg = await db.chatMessage.create({
    data: { taskId, message: "Updated the dependency graph to include the new module:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: graphMsg.id,
      type: ArtifactType.GRAPH,
      content: {
        nodeIds: ["billing/csv", "billing/types", "api/billing/export"],
        focusNodeId: "billing/csv",
      },
    },
  });

  // ── MEDIA artifact (pill → external) ──────────────────────────────
  const mediaMsg = await db.chatMessage.create({
    data: { taskId, message: "Here's a chart of p95 export latency before/after:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: mediaMsg.id,
      type: ArtifactType.MEDIA,
      content: {
        url: "https://placehold.co/800x500/png",
        type: "image",
        metadata: { width: 800, height: 500, format: "png", title: "Export latency before/after" },
      },
    },
  });

  // ── BUG_REPORT artifact (pill → external) ─────────────────────────
  const bugMsg = await db.chatMessage.create({
    data: { taskId, message: "Filed a bug report for the edge case I noticed:", role: "ASSISTANT" },
  });
  await db.artifact.create({
    data: {
      messageId: bugMsg.id,
      type: ArtifactType.BUG_REPORT,
      content: {
        title: "Empty cursor produces a CSV with header-only line",
        severity: "LOW",
        reproduction:
          "1. Hit /api/billing/export with a workspace that has 0 rows\n2. Response body is just the header row + LF\n3. Some downstream parsers (Looker connector) reject this as 'no data'",
        stackTrace: "n/a — behavioral bug, no exception thrown.",
        environment: { browser: "n/a", os: "Linux (Vercel runtime)", nodeVersion: "v20" },
      },
    },
  });

  // Closing assistant turn so the scroll ends on a natural prompt.
  await db.chatMessage.create({
    data: {
      taskId,
      message:
        "All set — give the PR a look when you have a sec. Happy to revise anything before merge.",
      role: "ASSISTANT",
    },
  });
  console.log(`  + 11 chat messages with artifact spread on review task`);
}

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
  // This is the "agent finished a bunch of stuff, you should look at
  // what they made" task — we attach a representative spread of
  // artifacts to it so the canvas-sidebar TaskChat exercises every
  // rendering path: inline FORM, inline PR card, click-to-modal pills
  // (CODE / DIFF / LONGFORM / BOUNTY / PUBLISH_WORKFLOW), and
  // external-fallback pills (BROWSER / IDE / WORKFLOW / GRAPH /
  // MEDIA / BUG_REPORT). See `seedReviewTaskArtifacts` below.
  let reviewTask = await db.task.findFirst({
    where: { workspaceId, title: variant.review.title, deleted: false },
    select: { id: true },
  });
  if (!reviewTask) {
    reviewTask = await db.task.create({
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
      select: { id: true },
    });
    console.log(`  + ready-to-review task: ${variant.review.title}`);
  }
  await seedReviewTaskArtifacts(reviewTask.id, variant.review.title);

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

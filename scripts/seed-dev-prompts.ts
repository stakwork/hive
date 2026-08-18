/**
 * Dev-only seed script: write synthetic Prompt / PromptVersion rows for
 * manually verifying the PublishPromptSlot render states.
 *
 * PURPOSE  : populate all four slot states (publishable, superseded,
 *            already-published, ambiguous-legacy) plus the NOT_CONFIGURED
 *            and non-null-stakworkId sync paths — with no Stakwork
 *            credentials and no outbound network calls.
 *
 * DEV-ONLY : Never run this in staging or production. The rows it creates
 *            have obviously-fake bodies and synthetic stakworkIds.
 *
 * IDEMPOTENT: Safe to run multiple times. All writes use upsert keyed on
 *             the prompt `name` (globally unique). Re-running will update
 *             mutable fields but will not create duplicate rows.
 *
 * Usage:
 *   npm run seed:prompts:dev
 *   (or directly: tsx scripts/seed-dev-prompts.ts)
 */

import { PrismaClient, PromptSyncStatus, WorkspaceRole } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return an ISO timestamp offset by `minutesAgo` from now. */
function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Workspace + user bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure the `stakwork` workspace exists and the first available User is its
 * owner and a member. This mirrors what the API route gate requires:
 * `slug: "stakwork"` workspace with caller as owner-or-member.
 */
async function ensureStakworkWorkspace(): Promise<void> {
  // Grab any user to act as owner (prefer the dev mock user if it exists).
  const user =
    (await prisma.user.findFirst({
      where: { email: "dev-user@mock.dev" },
    })) ?? (await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }));

  if (!user) {
    console.log(
      "[seed:prompts:dev] No users found in the database.\n" +
        "  Run `npm run seed:db` first to create base users, then re-run this script."
    );
    return;
  }

  const workspace = await prisma.workspace.upsert({
    where: { slug: "stakwork" },
    update: {},
    create: {
      name: "stakwork",
      slug: "stakwork",
      ownerId: user.id,
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
    },
    update: { role: WorkspaceRole.OWNER },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: WorkspaceRole.OWNER,
    },
  });

  console.log(
    `[seed:prompts:dev] stakwork workspace ready (id=${workspace.id}, owner=${user.email ?? user.id})`
  );
}

// ---------------------------------------------------------------------------
// Prompt fixtures
// ---------------------------------------------------------------------------

/**
 * Fixture 1 — PUBLISHABLE path
 * Published v1 + one unpublished MCP draft v2.
 * stakworkId = null → slot renders NOT_CONFIGURED (nothing to push).
 */
async function seedPublishablePrompt(): Promise<void> {
  const name = "DEV_SEED_PUBLISHABLE_PROMPT";

  // Create v1 first so we can reference its id for publishedVersionId.
  const v1 = await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: {
        promptId: (
          await prisma.prompt.upsert({
            where: { name },
            update: {},
            create: {
              name,
              value: "You are a test prompt v1. {{input}}",
              description:
                "DEV SEED — publishable path (published v1, draft v2)",
              syncStatus: PromptSyncStatus.OK,
            },
          })
        ).id,
        versionNumber: 1,
      },
    },
    update: {
      value: "You are a test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(120),
      publishedBy: "dev-seed",
      source: "UI",
    },
    create: {
      versionNumber: 1,
      value: "You are a test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(120),
      publishedBy: "dev-seed",
      source: "UI",
      whodunnit: "dev-seed",
      prompt: { connect: { name } },
    },
  });

  // Now upsert the prompt row to set publishedVersionId = v1.id.
  const prompt = await prisma.prompt.update({
    where: { name },
    data: { publishedVersionId: v1.id, value: "You are a test prompt v1. {{input}}" },
  });

  // Draft v2 — MCP source, created 5 minutes ago (within the 10-min window).
  await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: prompt.id, versionNumber: 2 },
    },
    update: {
      value: "You are a test prompt v2 (draft). {{input}}",
      published: false,
      source: "MCP",
      createdAt: minutesAgo(5),
    },
    create: {
      promptId: prompt.id,
      versionNumber: 2,
      value: "You are a test prompt v2 (draft). {{input}}",
      published: false,
      source: "MCP",
      whodunnit: "dev-seed",
      createdAt: minutesAgo(5),
    },
  });

  console.log(
    `[seed:prompts:dev] Fixture 1 — PUBLISHABLE: ${name} (id=${prompt.id})`
  );
}

/**
 * Fixture 2 — SUPERSEDED path
 * Published v1 + unpublished MCP draft v2 (older) + unpublished MCP draft v3 (newer).
 * When targeting v2, a newer draft (v3) exists → slot shows inline warning.
 * stakworkId set to a synthetic non-null value → exercises the PUSHED/PUSH_FAILED paths.
 * syncStatus = PENDING (leftover from a prior draft-save) to verify it doesn't
 * bleed into the publish card's sync-honesty display (PublishOutcome is per-call).
 */
async function seedSupersededPrompt(): Promise<void> {
  const name = "DEV_SEED_SUPERSEDED_PROMPT";

  const promptBase = await prisma.prompt.upsert({
    where: { name },
    update: {
      description: "DEV SEED — superseded path (published v1, drafts v2+v3)",
      syncStatus: PromptSyncStatus.PENDING,
      stakworkId: 99901,
    },
    create: {
      name,
      value: "You are a superseded test prompt v1. {{input}}",
      description: "DEV SEED — superseded path (published v1, drafts v2+v3)",
      syncStatus: PromptSyncStatus.PENDING,
      stakworkId: 99901,
    },
  });

  const v1 = await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 1 },
    },
    update: {
      value: "You are a superseded test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(180),
      publishedBy: "dev-seed",
      source: "UI",
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 1,
      value: "You are a superseded test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(180),
      publishedBy: "dev-seed",
      source: "UI",
      whodunnit: "dev-seed",
    },
  });

  await prisma.prompt.update({
    where: { name },
    data: {
      publishedVersionId: v1.id,
      value: "You are a superseded test prompt v1. {{input}}",
    },
  });

  // Draft v2 — MCP source, created 30 minutes ago (the "target" version).
  await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 2 },
    },
    update: {
      value: "You are a superseded test prompt v2 (draft). {{input}}",
      published: false,
      source: "MCP",
      createdAt: minutesAgo(30),
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 2,
      value: "You are a superseded test prompt v2 (draft). {{input}}",
      published: false,
      source: "MCP",
      whodunnit: "dev-seed",
      createdAt: minutesAgo(30),
    },
  });

  // Draft v3 — MCP source, created 8 minutes ago (newer than v2, within window).
  // Two MCP candidates within 10 min of each other → ambiguous-legacy case.
  await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 3 },
    },
    update: {
      value: "You are a superseded test prompt v3 (newer draft). {{input}}",
      published: false,
      source: "MCP",
      createdAt: minutesAgo(8),
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 3,
      value: "You are a superseded test prompt v3 (newer draft). {{input}}",
      published: false,
      source: "MCP",
      whodunnit: "dev-seed",
      createdAt: minutesAgo(8),
    },
  });

  console.log(
    `[seed:prompts:dev] Fixture 2 — SUPERSEDED (+ ambiguous-legacy): ${name} (id=${promptBase.id}, stakworkId=99901, syncStatus=PENDING)`
  );
}

/**
 * Fixture 3 — ALREADY PUBLISHED path
 * Published v1 = latest version — slot renders "Published ✓" with no button.
 * stakworkId set to a different synthetic value so both non-null-id cases
 * (PUSHED on success, PUSH_FAILED on throw) are reachable locally.
 */
async function seedAlreadyPublishedPrompt(): Promise<void> {
  const name = "DEV_SEED_ALREADY_PUBLISHED_PROMPT";

  const promptBase = await prisma.prompt.upsert({
    where: { name },
    update: {
      description: "DEV SEED — already-published path (published v1 = latest)",
      syncStatus: PromptSyncStatus.OK,
      stakworkId: 99902,
      lastSyncedAt: minutesAgo(60),
    },
    create: {
      name,
      value: "You are an already-published test prompt. {{input}}",
      description: "DEV SEED — already-published path (published v1 = latest)",
      syncStatus: PromptSyncStatus.OK,
      stakworkId: 99902,
      lastSyncedAt: minutesAgo(60),
    },
  });

  const v1 = await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 1 },
    },
    update: {
      value: "You are an already-published test prompt. {{input}}",
      published: true,
      publishedAt: minutesAgo(60),
      publishedBy: "dev-seed",
      source: "UI",
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 1,
      value: "You are an already-published test prompt. {{input}}",
      published: true,
      publishedAt: minutesAgo(60),
      publishedBy: "dev-seed",
      source: "UI",
      whodunnit: "dev-seed",
    },
  });

  await prisma.prompt.update({
    where: { name },
    data: {
      publishedVersionId: v1.id,
      value: "You are an already-published test prompt. {{input}}",
    },
  });

  console.log(
    `[seed:prompts:dev] Fixture 3 — ALREADY PUBLISHED: ${name} (id=${promptBase.id}, stakworkId=99902)`
  );
}

/**
 * Fixture 4 — AMBIGUOUS-LEGACY path (no promptVersionId in ApprovalResult)
 * Published v1 + two MCP drafts (v2 and v3) both created within the 10-minute
 * window of a simulated "approval timestamp" (now). Neither wins uniquely →
 * slot must fall back to read-only text with no Publish button.
 *
 * NOTE: Fixture 2 (superseded) also doubles as an ambiguous-legacy case when
 * its v2 and v3 are both within 10 min. This fixture provides a standalone,
 * unambiguous ambiguous-only scenario.
 */
async function seedAmbiguousLegacyPrompt(): Promise<void> {
  const name = "DEV_SEED_AMBIGUOUS_LEGACY_PROMPT";

  const promptBase = await prisma.prompt.upsert({
    where: { name },
    update: {
      description:
        "DEV SEED — ambiguous-legacy path (two MCP drafts in window, no unique candidate)",
      syncStatus: PromptSyncStatus.OK,
    },
    create: {
      name,
      value: "You are an ambiguous legacy test prompt v1. {{input}}",
      description:
        "DEV SEED — ambiguous-legacy path (two MCP drafts in window, no unique candidate)",
      syncStatus: PromptSyncStatus.OK,
    },
  });

  const v1 = await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 1 },
    },
    update: {
      value: "You are an ambiguous legacy test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(240),
      publishedBy: "dev-seed",
      source: "UI",
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 1,
      value: "You are an ambiguous legacy test prompt v1. {{input}}",
      published: true,
      publishedAt: minutesAgo(240),
      publishedBy: "dev-seed",
      source: "UI",
      whodunnit: "dev-seed",
    },
  });

  await prisma.prompt.update({
    where: { name },
    data: {
      publishedVersionId: v1.id,
      value: "You are an ambiguous legacy test prompt v1. {{input}}",
    },
  });

  // v2 — MCP, 4 minutes ago (within 10-min window of "now").
  await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 2 },
    },
    update: {
      value: "You are an ambiguous legacy test prompt v2 (draft A). {{input}}",
      published: false,
      source: "MCP",
      createdAt: minutesAgo(4),
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 2,
      value: "You are an ambiguous legacy test prompt v2 (draft A). {{input}}",
      published: false,
      source: "MCP",
      whodunnit: "dev-seed",
      createdAt: minutesAgo(4),
    },
  });

  // v3 — MCP, 2 minutes ago (also within the window → ambiguous).
  await prisma.promptVersion.upsert({
    where: {
      promptId_versionNumber: { promptId: promptBase.id, versionNumber: 3 },
    },
    update: {
      value: "You are an ambiguous legacy test prompt v3 (draft B). {{input}}",
      published: false,
      source: "MCP",
      createdAt: minutesAgo(2),
    },
    create: {
      promptId: promptBase.id,
      versionNumber: 3,
      value: "You are an ambiguous legacy test prompt v3 (draft B). {{input}}",
      published: false,
      source: "MCP",
      whodunnit: "dev-seed",
      createdAt: minutesAgo(2),
    },
  });

  console.log(
    `[seed:prompts:dev] Fixture 4 — AMBIGUOUS LEGACY: ${name} (id=${promptBase.id})`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[seed:prompts:dev] Starting dev prompt seed...\n");

  await ensureStakworkWorkspace();

  console.log("");

  await seedPublishablePrompt();
  await seedSupersededPrompt();
  await seedAlreadyPublishedPrompt();
  await seedAmbiguousLegacyPrompt();

  console.log("\n[seed:prompts:dev] Done.");
  console.log(
    "  Slot states now reproducible locally:\n" +
      "    publishable      → DEV_SEED_PUBLISHABLE_PROMPT (stakworkId=null → NOT_CONFIGURED)\n" +
      "    superseded       → DEV_SEED_SUPERSEDED_PROMPT  (stakworkId=99901, syncStatus=PENDING)\n" +
      "    already-published→ DEV_SEED_ALREADY_PUBLISHED_PROMPT (stakworkId=99902)\n" +
      "    ambiguous-legacy → DEV_SEED_AMBIGUOUS_LEGACY_PROMPT (no unique MCP candidate)\n" +
      "  Fixture 2 also doubles as the ambiguous-legacy case (v2+v3 both in window)."
  );
}

main()
  .catch((err) => {
    console.error("[seed:prompts:dev] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

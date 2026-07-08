/**
 * Backfill the Stakwork prompt graph-recorder for every existing Hive prompt.
 *
 * Prompts created before `recordPromptOnGraph` was wired up are absent from the
 * knowledge graph. This script closes that gap by calling `sendPromptGraphRequest`
 * (the single-source-of-truth payload builder) for each existing prompt/version.
 *
 * Usage:
 *   npm run backfill:prompt-graph [--published-only | --all-versions]
 *   (or: npx dotenv-cli -e .env.prod -- npm run backfill:prompt-graph)
 *
 * Flags:
 *   (default)         fire published version + latest unpublished draft (up to 2 per prompt)
 *   --published-only  fire published version only; skip draft
 *   --all-versions    iterate every PromptVersion row; mutually exclusive with --published-only
 *
 * No DB rows are written — safe to re-run any number of times.
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

// Import after dotenv so env vars are available
import { sendPromptGraphRequest } from "../src/services/prompts/prompt-sync";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const BATCH_SIZE = 50;

const prisma = new PrismaClient();

async function main() {
  const publishedOnly = hasFlag("published-only");
  const allVersions = hasFlag("all-versions");

  if (publishedOnly && allVersions) {
    console.error(
      "[backfill:prompt-graph] Error: --published-only and --all-versions are mutually exclusive.",
    );
    process.exit(1);
  }

  const workspace = await prisma.workspace.findFirst({ where: { name: "stakwork" } });
  if (!workspace) {
    console.warn("[backfill:prompt-graph] No stakwork workspace found; graph writes will be skipped for all prompts");
  }

  const totals = { saved: 0, skipped: 0, failed: 0 };
  let batchNum = 0;

  if (allVersions) {
    // ── Mode: all versions ──────────────────────────────────────────────────
    let cursor: string | undefined;

    for (;;) {
      const versions = await prisma.promptVersion.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        include: { prompt: true },
      });

      if (versions.length === 0) break;
      batchNum++;

      const batchTotals = { saved: 0, skipped: 0, failed: 0 };

      for (const version of versions) {
        const trigger = version.published ? "publish" : "update";
        try {
          await sendPromptGraphRequest(
            {
              prompt: {
                id: version.prompt.id,
                name: version.prompt.name,
                description: version.prompt.description,
                createdAt: version.prompt.createdAt,
              },
              versionId: version.id,
              value: version.value,
              workspaceId: workspace?.id,
            },
            trigger,
          );
          batchTotals.saved++;
        } catch (err) {
          batchTotals.failed++;
          console.error(
            `[backfill:prompt-graph] Failed version ${version.id} (prompt ${version.promptId}):`,
            err,
          );
        }
      }

      totals.saved += batchTotals.saved;
      totals.skipped += batchTotals.skipped;
      totals.failed += batchTotals.failed;

      console.info(
        `[backfill:prompt-graph] batch ${batchNum}: +${batchTotals.saved} saved, +${batchTotals.skipped} skipped, +${batchTotals.failed} failed` +
          ` (running totals: saved=${totals.saved} skipped=${totals.skipped} failed=${totals.failed})`,
      );

      cursor = versions[versions.length - 1].id;
      if (versions.length < BATCH_SIZE) break;
    }
  } else {
    // ── Mode: default (published + latest draft) or --published-only ────────
    let cursor: string | undefined;

    for (;;) {
      const prompts = await prisma.prompt.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        include: { publishedVersion: true },
      });

      if (prompts.length === 0) break;
      batchNum++;

      const batchTotals = { saved: 0, skipped: 0, failed: 0 };

      for (const prompt of prompts) {
        const published = prompt.publishedVersion ?? null;

        let latestDraft: { id: string; value: string } | null = null;
        if (!publishedOnly) {
          latestDraft = await prisma.promptVersion.findFirst({
            where: { promptId: prompt.id, published: false },
            orderBy: { versionNumber: "desc" },
            select: { id: true, value: true },
          });
        }

        if (!published && !latestDraft) {
          batchTotals.skipped++;
          continue;
        }

        const promptParams = {
          id: prompt.id,
          name: prompt.name,
          description: prompt.description,
          createdAt: prompt.createdAt,
        };

        if (published) {
          try {
            await sendPromptGraphRequest(
              { prompt: promptParams, versionId: published.id, value: published.value, workspaceId: workspace?.id },
              "publish",
            );
            batchTotals.saved++;
          } catch (err) {
            batchTotals.failed++;
            console.error(
              `[backfill:prompt-graph] Failed published version for prompt ${prompt.id} (${prompt.name}):`,
              err,
            );
          }
        }

        if (latestDraft) {
          try {
            await sendPromptGraphRequest(
              { prompt: promptParams, versionId: latestDraft.id, value: latestDraft.value, workspaceId: workspace?.id },
              "update",
            );
            batchTotals.saved++;
          } catch (err) {
            batchTotals.failed++;
            console.error(
              `[backfill:prompt-graph] Failed latest draft for prompt ${prompt.id} (${prompt.name}):`,
              err,
            );
          }
        }
      }

      totals.saved += batchTotals.saved;
      totals.skipped += batchTotals.skipped;
      totals.failed += batchTotals.failed;

      console.info(
        `[backfill:prompt-graph] batch ${batchNum}: +${batchTotals.saved} saved, +${batchTotals.skipped} skipped, +${batchTotals.failed} failed` +
          ` (running totals: saved=${totals.saved} skipped=${totals.skipped} failed=${totals.failed})`,
      );

      cursor = prompts[prompts.length - 1].id;
      if (prompts.length < BATCH_SIZE) break;
    }
  }

  console.info(
    `[backfill:prompt-graph] done — saved=${totals.saved} skipped=${totals.skipped} failed=${totals.failed}`,
  );
  process.exit(totals.failed > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("[backfill:prompt-graph] Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Scorer Debug Script
 *
 * Diagnoses why plan precision/recall might be 0% by inspecting
 * actual Feature.architecture text and DIFF artifact content.
 *
 * Usage:
 *   npx dotenv-cli -e .env.prod -- npx tsx scripts/scorer/debug-metrics.ts hive
 *
 * Reads DATABASE_URL from .env.prod (read-only queries only).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Same regex used in src/lib/scorer/metrics.ts
const FILE_PATH_RE = /(?:^|[\s`"'(,])([a-zA-Z][\w./-]*\/[\w./-]+\.\w{1,10})(?:[\s`"'),]|$)/gm;

/** Strip repo-name prefix from DIFF paths: "hive/src/foo.ts" → "src/foo.ts" */
function normalizeFilePath(path: string): string {
  const firstSlash = path.indexOf("/");
  if (firstSlash > 0) {
    const firstSegment = path.slice(0, firstSlash);
    if (!firstSegment.includes(".")) {
      return path.slice(firstSlash + 1);
    }
  }
  return path;
}

/** Extract file list from DIFF artifact content (handles {diffs:[...]} and [...] shapes) */
function extractDiffFiles(content: unknown): Array<{ file: string; action: string }> {
  let items: Array<{ file?: string; action?: string }>;
  if (Array.isArray(content)) {
    items = content;
  } else if (
    content &&
    typeof content === "object" &&
    Array.isArray((content as Record<string, unknown>).diffs)
  ) {
    items = (content as Record<string, unknown>).diffs as Array<{ file?: string; action?: string }>;
  } else {
    return [];
  }
  return items
    .filter((item) => item.file)
    .map((item) => ({ file: normalizeFilePath(item.file!), action: item.action || "modify" }));
}

function extractFilePaths(text: string | null): string[] {
  if (!text) return [];
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    paths.add(match[1]);
  }
  return Array.from(paths);
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/scorer-debug.ts <workspace-slug>");
    process.exit(1);
  }

  const workspace = await prisma.workspace.findFirst({
    where: { slug, deleted: false },
    select: { id: true, name: true, slug: true },
  });

  if (!workspace) {
    console.error(`Workspace "${slug}" not found`);
    process.exit(1);
  }

  console.log(`\n=== Scorer Debug: ${workspace.name} (${workspace.slug}) ===\n`);

  // -----------------------------------------------------------------------
  // 1. Feature architecture stats
  // -----------------------------------------------------------------------
  const totalFeatures = await prisma.feature.count({
    where: { workspaceId: workspace.id, deleted: false },
  });

  const withArch = await prisma.feature.count({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      architecture: { not: null },
    },
  });

  const withNonEmptyArch = await prisma.feature.count({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      architecture: { not: "" },
    },
  });

  console.log(`--- 1. FEATURE ARCHITECTURE ---`);
  console.log(`Total features: ${totalFeatures}`);
  console.log(`With architecture (non-null): ${withArch}`);
  console.log(`With architecture (non-empty): ${withNonEmptyArch}`);

  // Sample architecture text + regex extraction
  const archSamples = await prisma.feature.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      architecture: { not: null },
    },
    select: { id: true, title: true, architecture: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  if (archSamples.length === 0) {
    console.log(`\nNo features with architecture text found.`);
    console.log(`>>> This explains 0% precision/recall — nothing to compare against.\n`);
  } else {
    console.log(`\nSample architecture texts:\n`);
    for (const f of archSamples) {
      const paths = extractFilePaths(f.architecture);
      console.log(`  Feature: ${f.title} (${f.id})`);
      console.log(`  Architecture (first 500 chars):`);
      console.log(`    ${f.architecture?.slice(0, 500)?.replace(/\n/g, "\n    ")}`);
      console.log(`  Regex extracted ${paths.length} file paths:`);
      if (paths.length > 0) {
        for (const p of paths.slice(0, 10)) {
          console.log(`    - ${p}`);
        }
        if (paths.length > 10) console.log(`    ... and ${paths.length - 10} more`);
      } else {
        console.log(`    (none — regex found no file paths)`);
      }
      console.log();
    }
  }

  // -----------------------------------------------------------------------
  // 2. DIFF artifact stats
  // -----------------------------------------------------------------------
  console.log(`--- 2. DIFF ARTIFACTS ---`);

  const taskIds = await prisma.task.findMany({
    where: { workspaceId: workspace.id, deleted: false },
    select: { id: true },
  });
  const taskIdList = taskIds.map((t) => t.id);

  const diffCount = taskIdList.length > 0
    ? await prisma.artifact.count({
        where: {
          type: "DIFF",
          message: { taskId: { in: taskIdList } },
        },
      })
    : 0;

  const prCount = taskIdList.length > 0
    ? await prisma.artifact.count({
        where: {
          type: "PULL_REQUEST",
          message: { taskId: { in: taskIdList } },
        },
      })
    : 0;

  console.log(`Total tasks: ${taskIdList.length}`);
  console.log(`DIFF artifacts: ${diffCount}`);
  console.log(`PULL_REQUEST artifacts: ${prCount}`);

  // Sample DIFF content shape
  const diffSamples = taskIdList.length > 0
    ? await prisma.artifact.findMany({
        where: {
          type: "DIFF",
          message: { taskId: { in: taskIdList } },
        },
        select: {
          content: true,
          message: { select: { taskId: true } },
        },
        take: 5,
        orderBy: { id: "desc" },
      })
    : [];

  if (diffSamples.length === 0) {
    console.log(`\nNo DIFF artifacts found.`);
    console.log(`>>> This means filesTouched is always empty.\n`);
  } else {
    console.log(`\nSample DIFF artifacts:\n`);
    for (const d of diffSamples) {
      const content = d.content;
      const taskId = d.message.taskId;
      console.log(`  Task: ${taskId}`);
      console.log(`  Content type: ${typeof content}`);
      console.log(`  Is array: ${Array.isArray(content)}`);
      if (Array.isArray(content)) {
        console.log(`  Length: ${content.length}`);
        if (content.length > 0) {
          const first = content[0] as Record<string, unknown>;
          console.log(`  First item keys: ${Object.keys(first).join(", ")}`);
          console.log(`  First item: ${JSON.stringify(first).slice(0, 300)}`);
          // Show all file paths
          const files = (content as Array<{ file?: string; action?: string }>)
            .filter((item) => item.file)
            .map((item) => `${item.file} (${item.action || "?"})`);
          console.log(`  Files: ${files.slice(0, 10).join(", ")}`);
          if (files.length > 10) console.log(`    ... and ${files.length - 10} more`);
        }
      } else if (content && typeof content === "object") {
        console.log(`  Keys: ${Object.keys(content as object).join(", ")}`);
        console.log(`  Sample: ${JSON.stringify(content).slice(0, 300)}`);
      } else {
        console.log(`  Raw: ${String(content).slice(0, 300)}`);
      }
      console.log();
    }
  }

  // Sample PULL_REQUEST content shape
  const prSamples = taskIdList.length > 0
    ? await prisma.artifact.findMany({
        where: {
          type: "PULL_REQUEST",
          message: { taskId: { in: taskIdList } },
        },
        select: { content: true },
        take: 3,
        orderBy: { id: "desc" },
      })
    : [];

  if (prSamples.length > 0) {
    console.log(`Sample PULL_REQUEST artifacts:\n`);
    for (const p of prSamples) {
      console.log(`  ${JSON.stringify(p.content).slice(0, 300)}`);
    }
    console.log();
  }

  // -----------------------------------------------------------------------
  // 3. Side-by-side comparison
  // -----------------------------------------------------------------------
  console.log(`--- 3. SIDE-BY-SIDE COMPARISON ---`);

  // Find a feature that has architecture AND tasks with DIFF artifacts
  const featuresWithArch = await prisma.feature.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      architecture: { not: null },
    },
    select: {
      id: true,
      title: true,
      architecture: true,
      tasks: {
        where: { deleted: false },
        select: { id: true },
        take: 20,
      },
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  let foundComparison = false;
  for (const f of featuresWithArch) {
    const fTaskIds = f.tasks.map((t) => t.id);
    if (fTaskIds.length === 0) continue;

    const diffs = await prisma.artifact.findMany({
      where: {
        type: "DIFF",
        message: { taskId: { in: fTaskIds } },
      },
      select: { content: true },
    });

    if (diffs.length === 0) continue;

    foundComparison = true;
    const planned = extractFilePaths(f.architecture);
    const touched = new Set<string>();
    for (const d of diffs) {
      for (const item of extractDiffFiles(d.content)) {
        touched.add(item.file);
      }
    }

    const touchedArr = Array.from(touched);
    const plannedSet = new Set(planned);
    const overlap = touchedArr.filter((f) => plannedSet.has(f));

    console.log(`\nFeature: ${f.title} (${f.id})`);
    console.log(`\nPlanned files (from architecture regex): ${planned.length}`);
    for (const p of planned.slice(0, 15)) {
      console.log(`  ${touched.has(p) ? "✓" : "✗"} ${p}`);
    }
    if (planned.length > 15) console.log(`  ... and ${planned.length - 15} more`);

    console.log(`\nTouched files (from DIFF artifacts): ${touchedArr.length}`);
    for (const t of touchedArr.slice(0, 15)) {
      console.log(`  ${plannedSet.has(t) ? "✓" : "✗"} ${t}`);
    }
    if (touchedArr.length > 15) console.log(`  ... and ${touchedArr.length - 15} more`);

    console.log(`\nOverlap: ${overlap.length}`);
    console.log(`Precision: ${touchedArr.length > 0 ? Math.round((overlap.length / touchedArr.length) * 100) : "N/A"}%`);
    console.log(`Recall: ${planned.length > 0 ? Math.round((overlap.length / planned.length) * 100) : "N/A"}%`);
    break;
  }

  if (!foundComparison) {
    console.log(`\nNo feature found with both architecture text AND DIFF artifacts.`);
    console.log(`>>> Cannot compare planned vs touched files.\n`);
  }

  // -----------------------------------------------------------------------
  // 4. Summary table for first 20 features
  // -----------------------------------------------------------------------
  console.log(`\n--- 4. FEATURE SUMMARY (first 20) ---\n`);
  console.log(
    `${"ID".padEnd(28)} ${"ARCH?".padEnd(6)} ${"PLANNED".padEnd(8)} ${"TOUCHED".padEnd(8)} ${"PREC".padEnd(6)} ${"RECALL".padEnd(6)}`
  );
  console.log("-".repeat(70));

  const summaryFeatures = await prisma.feature.findMany({
    where: { workspaceId: workspace.id, deleted: false },
    select: {
      id: true,
      architecture: true,
      tasks: {
        where: { deleted: false },
        select: { id: true },
      },
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  for (const f of summaryFeatures) {
    const planned = extractFilePaths(f.architecture);
    const fTaskIds = f.tasks.map((t) => t.id);

    let touchedCount = 0;
    let overlapCount = 0;

    if (fTaskIds.length > 0) {
      const diffs = await prisma.artifact.findMany({
        where: {
          type: "DIFF",
          message: { taskId: { in: fTaskIds } },
        },
        select: { content: true },
      });

      const touched = new Set<string>();
      for (const d of diffs) {
        for (const item of extractDiffFiles(d.content)) {
          touched.add(item.file);
        }
      }

      touchedCount = touched.size;
      const plannedSet = new Set(planned);
      overlapCount = Array.from(touched).filter((f) => plannedSet.has(f)).length;
    }

    const hasArch = f.architecture ? "yes" : "no";
    const prec =
      planned.length === 0
        ? "N/A"
        : touchedCount > 0
          ? `${Math.round((overlapCount / touchedCount) * 100)}%`
          : "N/A";
    const recall =
      planned.length === 0
        ? "N/A"
        : `${Math.round((overlapCount / planned.length) * 100)}%`;

    console.log(
      `${f.id.padEnd(28)} ${hasArch.padEnd(6)} ${String(planned.length).padEnd(8)} ${String(touchedCount).padEnd(8)} ${prec.padEnd(6)} ${recall.padEnd(6)}`
    );
  }

  console.log(`\n=== Done ===\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

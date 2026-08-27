#!/usr/bin/env npx tsx
/**
 * Regenerates src/lib/workflow-benchmark-tasks.generated.ts AND
 * src/lib/workflow-benchmarks/expected-outputs.server.generated.ts from the
 * benchmarks/workflow-editor/tasks/ directory tree.
 *
 * The directory IS the taxonomy: a task's grouping is simply where its
 * task.json sits. There is no category field, no closed union of directory
 * names, and the grouping directory is never emitted as data — only used for
 * diagnostics (summary log line, collision error messages).
 *
 * Ported from scripts/generate-harvey-lab-tasks.ts, minus all GitHub-fetching
 * logic (ghFetch/TreeResponse/truncation guard/GITHUB_TOKEN — this walks the
 * local filesystem instead) and minus LABEL_OVERRIDES/label() (no category
 * field here).
 *
 * Two transforms are applied to authored `task.json` source on the way to the
 * emitted index (everything else is a pure JSON.stringify pass-through):
 *   1. When `workflow_input` is declared, an INPUT block is appended to
 *      `instructions` (see task-schema.ts's INPUT_BLOCK_HEADING/SENTENCE).
 *   2. `expected_output`, when declared, is routed to the SEPARATE
 *      server-boundary `expected-outputs.server.generated.ts` map and
 *      omitted from the client-imported index entirely.
 *
 * Usage:
 *   npx tsx scripts/generate-workflow-benchmark-tasks.ts
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative, resolve, sep } from "path";
import {
  taskSourceSchema,
  checkTaskInvariants,
  checkSlugUniqueness,
  checkSlugFormat,
  renderInputBlock,
  type WorkflowBenchmarkTask,
  type WorkflowBenchmarkTaskSource,
} from "../src/lib/workflow-benchmarks/task-schema";

const SLUG_PREFIX = "wfbench/";

const DEFAULT_ROOT_DIR = join(process.cwd(), "benchmarks/workflow-editor/tasks");
const DEFAULT_OUT_DIR = join(process.cwd(), "src/lib");

/**
 * Matches a task.json's path RELATIVE TO THE TASKS ROOT. The corpus shape is
 * exactly `{dir}/{task-slug}/task.json` — one grouping directory, one leaf
 * task directory. A task.json directly under the root, or nested deeper than
 * this, does not match.
 */
export const TASK_PATH_RE = /^[^/]+\/[^/]+\/task\.json$/;

/**
 * Derives the corpus slug from a task.json's LEAF directory name only.
 *
 * Deliberately does NOT include the grouping directory — moving a task
 * between directories (`git mv`) must never change its slug, since the slug
 * is load-bearing as the graph EvalSet node id (see task-schema.ts). This is
 * the opposite of Harvey's `slugFromPath`, which is category-inclusive; do
 * not port that name or behavior here.
 *
 * @param relPath - task.json path relative to the tasks root, posix-separated
 *                   (e.g. "llm/create-openai-call/task.json").
 */
export function taskSlugFromPath(relPath: string): string {
  const segments = relPath.split("/");
  const leafDir = segments[segments.length - 2];
  return `${SLUG_PREFIX}${leafDir}`;
}

/**
 * Diagnostics-only grouping directory chain for a task.json, relative to the
 * tasks root and excluding the leaf directory. NEVER emitted as data — used
 * only for the summary log line and slug-collision error messages.
 *
 * @param relPath - task.json path relative to the tasks root, posix-separated.
 */
export function directoryFromPath(relPath: string): string {
  const segments = relPath.split("/");
  return segments.slice(0, -2).join("/");
}

// ── Filesystem walk (containment + symlink guarded) ─────────────────────────

interface DiscoveredTaskFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the tasks root, posix-separated. */
  relPath: string;
}

/**
 * Recursively walks `rootDir` collecting every `task.json` file.
 *
 * Guards:
 *   - Rejects any symlinked directory or file encountered (no symlinks
 *     anywhere in the tree) — a symlinked leaf could otherwise pull arbitrary
 *     local file content into a module that ships to the browser.
 *   - Resolves every candidate path and asserts it stays under the resolved
 *     tasks root before it is read (containment check against path
 *     traversal).
 *   - Rejects a task.json that isn't exactly two directory levels below the
 *     root (`{dir}/{task-slug}/task.json`).
 */
function walkForTaskFiles(rootDir: string): DiscoveredTaskFile[] {
  const resolvedRoot = resolve(rootDir);
  const results: DiscoveredTaskFile[] = [];

  function walk(dirAbsPath: string): void {
    const entries = readdirSync(dirAbsPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryAbsPath = resolve(dirAbsPath, entry.name);

      if (
        entryAbsPath !== resolvedRoot &&
        !entryAbsPath.startsWith(resolvedRoot + sep)
      ) {
        throw new Error(
          `Path traversal rejected: "${entryAbsPath}" resolves outside the tasks root "${resolvedRoot}"`,
        );
      }

      if (entry.isSymbolicLink()) {
        throw new Error(
          `Symlinks are not allowed in the tasks tree: "${entryAbsPath}"`,
        );
      }

      if (entry.isDirectory()) {
        walk(entryAbsPath);
      } else if (entry.isFile() && entry.name === "task.json") {
        const relPath = relative(resolvedRoot, entryAbsPath).split(sep).join("/");
        if (!TASK_PATH_RE.test(relPath)) {
          throw new Error(
            `"${entryAbsPath}" is not exactly two directory levels below the tasks root ` +
              `(expected benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json)`,
          );
        }
        results.push({ absPath: entryAbsPath, relPath });
      }
    }
  }

  walk(resolvedRoot);
  return results;
}

// ── Validation + assembly ────────────────────────────────────────────────────

function parseTaskJson(absPath: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read "${absPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in "${absPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateTaskSource(absPath: string): WorkflowBenchmarkTaskSource {
  const raw = parseTaskJson(absPath);
  const result = taskSourceSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`Schema validation failed for "${absPath}": ${issues}`);
  }
  return result.data;
}

export interface GenerateResult {
  tasks: WorkflowBenchmarkTask[];
  /**
   * slug -> expected_output, for tasks that declared one. NEVER emitted into
   * the client-imported index — routed to a separate server-boundary module
   * by `main` (see `renderExpectedOutputsModule`).
   */
  expectedOutputs: Record<string, string>;
  /** Number of task.json files processed. */
  fileCount: number;
  /** Number of distinct grouping directories (diagnostics only). */
  directoryCount: number;
}

/**
 * Walks `rootDir`, validates every task.json against the schema and all
 * invariants, and returns the fully assembled + slug-sorted task array.
 *
 * Throws on the first validation failure, naming the offending file and the
 * failed invariant. Writes nothing — that is the caller's job (`main`).
 */
export function generateWorkflowBenchmarkTasks(rootDir: string): GenerateResult {
  const resolvedRoot = resolve(rootDir);
  const discovered = walkForTaskFiles(resolvedRoot);

  // ── Pass 1: schema validation + per-task parse ─────────────────────────────
  const parsed = discovered.map((file) => ({
    file,
    source: validateTaskSource(file.absPath),
    slug: taskSlugFromPath(file.relPath),
  }));

  // ── Pass 2: slug format, pre-emit, before any string is written ────────────
  for (const { slug, file } of parsed) {
    const slugViolation = checkSlugFormat(slug, file.absPath);
    if (slugViolation) {
      throw new Error(
        `[${slugViolation.invariant}] ${slugViolation.message} (${slugViolation.filePaths.join(", ")})`,
      );
    }
  }

  // ── Pass 3: slug uniqueness across the whole tree ───────────────────────────
  const uniquenessViolations = checkSlugUniqueness(
    parsed.map(({ slug, file }) => ({ slug, filePath: file.absPath })),
  );
  if (uniquenessViolations.length > 0) {
    const v = uniquenessViolations[0];
    throw new Error(`[${v.invariant}] ${v.message} (${v.filePaths.join(", ")})`);
  }

  // ── Pass 4: per-task invariants (ids unique, non-empty criteria, baseline,
  //            workflow_input value types, no hand-authored INPUT block,
  //            declared input keys referenced in criteria) ───────────────────
  const tasks: WorkflowBenchmarkTask[] = [];
  const expectedOutputs: Record<string, string> = {};
  for (const { source, slug, file } of parsed) {
    // Run invariants against the SOURCE (pre-injection instructions) so
    // checkNoHandAuthoredInputBlock sees exactly what the author wrote, and
    // checkInputKeysReferencedInCriteria sees the authored criteria.
    const checkable = { slug, ...source };
    const violations = checkTaskInvariants(checkable, file.absPath);
    if (violations.length > 0) {
      const v = violations[0];
      throw new Error(`[${v.invariant}] ${v.message} (${v.filePaths.join(", ")})`);
    }

    // ── INPUT block injection: append to instructions when workflow_input is
    //    declared. The generator is a pure pass-through for every other field
    //    — see task-schema.ts header. Only two transforms exist: this one and
    //    expected_output routing (below).
    const instructions =
      source.workflow_input !== undefined
        ? `${source.instructions}\n\n${renderInputBlock(source.workflow_input)}`
        : source.instructions;

    // expected_output is routed to the server-boundary map, never emitted
    // into the index (Omit<WorkflowBenchmarkTaskSource, "expected_output">).
    const { expected_output, ...rest } = source;
    if (expected_output !== undefined) {
      expectedOutputs[slug] = expected_output;
    }

    const task: WorkflowBenchmarkTask = { slug, ...rest, instructions };
    tasks.push(task);
  }

  // Deterministic ordering for stable diffs.
  tasks.sort((a, b) => a.slug.localeCompare(b.slug));

  // ── Bidirectional index/map agreement ────────────────────────────────────
  // Every map key must exist in the index, and every task that declared
  // expected_output must have a map entry. A missing entry would silently
  // degrade a task from deterministic to judge-only scoring at dispatch time.
  const indexSlugs = new Set(tasks.map((t) => t.slug));
  for (const slug of Object.keys(expectedOutputs)) {
    if (!indexSlugs.has(slug)) {
      throw new Error(
        `[expected-output-index-agreement] expected_output map has slug "${slug}" with no ` +
          `corresponding task in the index`,
      );
    }
  }

  const directoryCount = new Set(
    discovered.map((f) => directoryFromPath(f.relPath)),
  ).size;

  return { tasks, expectedOutputs, fileCount: discovered.length, directoryCount };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Renders a single task as a TS object literal. Every field is emitted via
 * JSON.stringify — never a hand-built template literal — so a value
 * containing a backtick, `${`, or quote can never inject into the generated
 * module.
 */
function renderTaskLiteral(task: WorkflowBenchmarkTask): string {
  const criteriaLines = task.criteria
    .map(
      (c) =>
        `      { id: ${JSON.stringify(c.id)}, title: ${JSON.stringify(c.title)}, match_criteria: ${JSON.stringify(c.match_criteria)} },`,
    )
    .join("\n");

  const baselineLine =
    task.baseline !== undefined
      ? `\n    baseline: { workflow_id: ${JSON.stringify(task.baseline.workflow_id)}, workflow_version_id: ${JSON.stringify(task.baseline.workflow_version_id)} },`
      : "";

  const workflowInputLine =
    task.workflow_input !== undefined
      ? `\n    workflow_input: ${JSON.stringify(task.workflow_input)},`
      : "";

  return `  {
    slug: ${JSON.stringify(task.slug)},
    title: ${JSON.stringify(task.title)},
    instructions: ${JSON.stringify(task.instructions)},
    criteria: [
${criteriaLines}
    ],
    expectedSecrets: ${JSON.stringify(task.expectedSecrets)},${baselineLine}${workflowInputLine}
  },`;
}

/**
 * Renders the full generated module.
 *
 * The outer template interpolates ONLY the pre-escaped `taskLines` string
 * (itself built entirely from JSON.stringify calls) and generator-computed
 * NUMERIC scalars (`tasks.length`). No generator-computed string (a slug, a
 * directory name) is ever interpolated directly into this template — doing
 * so would let a directory name containing a backtick or `${` inject
 * executable code into the generated file.
 */
export function renderModule(tasks: WorkflowBenchmarkTask[]): string {
  const taskLines = tasks.map(renderTaskLiteral).join("\n");

  return `/**
 * Workflow Editor Benchmark corpus index — auto-generated file. DO NOT EDIT.
 * ${tasks.length} tasks.
 * Source: benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json
 * Regenerated by: scripts/generate-workflow-benchmark-tasks.ts
 * (npm run generate:workflow-benchmark-tasks)
 *
 * expected_output is deliberately NOT part of this index — see
 * ./workflow-benchmarks/expected-outputs.server.generated.ts (server-boundary
 * only; never imported by client-reachable code).
 */

import type { WorkflowBenchmarkTask } from "./workflow-benchmarks/task-schema";

export const WORKFLOW_BENCHMARK_TASKS: WorkflowBenchmarkTask[] = [
${taskLines}
];
`;
}

/**
 * Renders the server-boundary expected-outputs module: a `slug -> answer`
 * map. Every value is emitted via JSON.stringify, same escaping discipline as
 * `renderModule` — a slug or answer containing a backtick or `${` must never
 * inject into this template.
 *
 * BOUNDARY: this file must never be imported by a "use client" module or
 * anything under src/components/**, directly or transitively — see the
 * import-boundary test in
 * src/__tests__/unit/lib/workflow-benchmarks/expected-outputs-boundary.test.ts.
 * Do NOT add the `server-only` npm package (see task-schema.ts header /
 * architecture doc) — it is not installed and would break vitest-based unit
 * tests that transitively import the dispatch route.
 */
export function renderExpectedOutputsModule(expectedOutputs: Record<string, string>): string {
  const entries = Object.keys(expectedOutputs)
    .sort()
    .map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(expectedOutputs[slug])},`)
    .join("\n");

  return `/**
 * Workflow Editor Benchmark — expected rerun answers. AUTO-GENERATED. DO NOT EDIT.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SERVER-BOUNDARY ONLY. This file must NEVER be imported by a "use client"
 * module or anything under src/components/**, directly or transitively.
 * It carries the deterministic rerun answer for each corpus task that
 * declares one — that value must never reach the browser. Enforced by a
 * static import-boundary unit test, not by the (unused, would-break-tests)
 * "server-only" package. See src/lib/workflow-benchmarks/task-schema.ts for
 * the full rationale.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Source: benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json (expected_output field)
 * Regenerated by: scripts/generate-workflow-benchmark-tasks.ts
 */

export const EXPECTED_OUTPUTS: Readonly<Record<string, string>> = {
${entries}
};
`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param rootDir - Tasks tree root. Defaults to the production location;
 *                   tests should pass an `mkdtemp` directory instead.
 * @param outDir  - Directory the generated module is written into. Defaults
 *                   to the production location; tests should pass an
 *                   `mkdtemp` directory instead.
 */
export function main(rootDir: string = DEFAULT_ROOT_DIR, outDir: string = DEFAULT_OUT_DIR): void {
  const { tasks, expectedOutputs, fileCount, directoryCount } =
    generateWorkflowBenchmarkTasks(rootDir);

  const output = renderModule(tasks);
  const outPath = join(outDir, "workflow-benchmark-tasks.generated.ts");
  writeFileSync(outPath, output, "utf-8");

  const expectedOutputsDir = join(outDir, "workflow-benchmarks");
  mkdirSync(expectedOutputsDir, { recursive: true });
  const expectedOutputsOutput = renderExpectedOutputsModule(expectedOutputs);
  const expectedOutputsPath = join(expectedOutputsDir, "expected-outputs.server.generated.ts");
  writeFileSync(expectedOutputsPath, expectedOutputsOutput, "utf-8");

  console.log(
    `Wrote ${outPath} — ${tasks.length} tasks across ${directoryCount} directories (${fileCount} files processed)`,
  );
  console.log(
    `Wrote ${expectedOutputsPath} — ${Object.keys(expectedOutputs).length} expected outputs`,
  );
}

// Only run when executed directly (not when imported by unit tests)
if (process.argv[1]?.includes("generate-workflow-benchmark-tasks")) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

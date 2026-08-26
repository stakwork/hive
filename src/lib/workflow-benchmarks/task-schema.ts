/**
 * Workflow Editor Benchmark corpus — schema, types, and authoring conventions.
 *
 * This module is hand-written and normative. It is the single place that
 * defines what a valid `task.json` looks like, both as a zod schema (shape/type
 * checking) and as a set of pure invariant predicates (cross-field / cross-file
 * rules that a type system alone can't express — e.g. "slugs are unique across
 * the whole tree").
 *
 * The generator (scripts/generate-workflow-benchmark-tasks.ts) and the corpus
 * test suite both import from here rather than re-implementing these rules, so
 * the two can't silently drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Authoring conventions
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A benchmark task measures whether the Workflow Editor agent produces
 * correctly structured workflow JSON from a plain-English instruction. Each
 * task lives at `benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json`.
 * The directory tree IS the taxonomy: a task's grouping is simply where its
 * file sits. There is no category field, no closed union of directory names,
 * and the parent directory chain is never recorded as data or asserted against
 * a list — see `taskSlugFromPath` in the generator.
 *
 * Each `task.json` carries:
 *
 *   - `slug`          — namespaced corpus id, derived by the generator from the
 *                       leaf directory name alone (never hand-authored in the
 *                       file; NOT a field in the schema below). Load-bearing:
 *                       used as the EvalSet node id in the graph, and also
 *                       discriminates BENCHMARK_RUNNER rows from other domains
 *                       since the run type is generic.
 *                       Permitted characters: /^[a-z0-9_\-/]+$/i
 *
 *   - `title`         — display title shown in the UI task list.
 *
 *   - `instructions`  — plain-English instruction sent verbatim to the
 *                       Workflow Editor agent. Must name every entry in
 *                       `expectedSecrets` explicitly so C-004-style criteria
 *                       test instruction-following, not telepathy.
 *
 *   - `criteria`      — behavioural criteria evaluated by the LLM judge. Each
 *                       asserts the artifact (output shape), never the
 *                       mechanism (which builder step produced it). An agent
 *                       that inlines a value directly must still pass.
 *
 *   - `expectedSecrets` — secret names the instructions must reference by
 *                       name. Carried here as corpus data rather than prose
 *                       buried inside a criterion that an LLM judge has to
 *                       parse.
 *
 *   - `baseline`      — OPTIONAL. Absent on CREATE-flavour tasks (the agent
 *                       builds from nothing). EDIT-flavour tasks pin a
 *                       specific workflow_version_id — NEVER the moving
 *                       published default. When present, BOTH fields must be
 *                       supplied; a partial baseline is invalid (enforced by
 *                       `checkBaselineCompleteness` below).
 *
 * Criterion wording conventions (copy-comparable ground truth for an LLM judge):
 *
 *   Step-output reference — REQUIRED form:  [#(step_id).output.variable_name]
 *   Secret reference      — REQUIRED authoring form:  %%SECRET_NAME%%
 *   REJECTED runtime form — bare {{ … }} (same mechanism as %%…%%, just the
 *                           runtime spelling — accepting it would score a
 *                           broken workflow as correct).
 *
 * These three forms are named explicitly inside the criterion bodies so a
 * judge has a copy-comparable string, not prose to interpret.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Adding a task
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Create `benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json` and run
 * the generator. Do not hand-edit `src/lib/workflow-benchmark-tasks.generated.ts`
 * — it is overwritten on every generate. A second top-level directory should
 * only be created when a task genuinely doesn't belong under an existing one —
 * the directory earns its existence from a real task, not from a taxonomy
 * designed up front.
 */

import { z } from "zod";

/**
 * Allowed slug characters — mirrors the legal dispatch route's TASK_SLUG_RE.
 * Validated by the generator pre-emit and in tests; used by the dispatch route
 * corpus lookup.
 */
export const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;

// ── Zod schema (authoring shape) ─────────────────────────────────────────────

export const criterionSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe('Short unique id within this task, e.g. "C-001".'),
  title: z
    .string()
    .min(1)
    .describe("Human-readable display title used as the EvalRequirement `name`."),
  match_criteria: z
    .string()
    .min(1)
    .describe(
      "Behavioural assertion evaluated by the LLM judge. Asserts the artifact " +
        "(output shape), never the mechanism.",
    ),
});

/**
 * Both fields are required within the object itself — only the object as a
 * whole is optional on the task (see `baseline` below). This keeps the
 * schema-inferred type equal to the hand-written interface's `baseline`
 * shape (checked by the compile-time assertion further down).
 *
 * `checkBaselineCompleteness` still exists as an independently-testable pure
 * predicate — useful for hand-constructed fixtures that bypass zod entirely
 * (the negative-fixture table) and as defense-in-depth in the generator
 * pipeline — but a `task.json` with a genuinely partial baseline is already
 * rejected at the schema-parse stage, before invariants ever run.
 */
export const baselineSchema = z
  .object({
    workflow_id: z
      .number()
      .int()
      .positive()
      .describe("Stakwork workflow id pinned for an EDIT-flavour task."),
    workflow_version_id: z
      .number()
      .int()
      .positive()
      .describe(
        "Specific workflow_version_id pinned for an EDIT-flavour task — " +
          "NEVER the moving published default.",
      ),
  })
  .describe(
    "OPTIONAL baseline for EDIT-flavour tasks. When present, BOTH fields are " +
      "required — a partial baseline is invalid.",
  );

/**
 * Authoring shape read from `task.json`. Does NOT include `slug` — the slug
 * is derived by the generator from the leaf directory name, never authored.
 */
export const taskSourceSchema = z.object({
  title: z.string().min(1).describe("Display title shown in the UI task list."),
  instructions: z
    .string()
    .min(1)
    .describe(
      "Plain-English instruction sent verbatim to the Workflow Editor agent.",
    ),
  criteria: z
    .array(criterionSchema)
    .describe("Behavioural criteria evaluated by the LLM judge."),
  expectedSecrets: z
    .array(z.string())
    .describe(
      "Secret names that must appear in `instructions` and whose presence in " +
        "the workflow output criteria tests assertion-by-name.",
    ),
  baseline: baselineSchema.optional(),
});

export type WorkflowBenchmarkTaskSource = z.infer<typeof taskSourceSchema>;

// ── Hand-written index/emitted type ──────────────────────────────────────────

export interface WorkflowBenchmarkCriterion {
  /** Short unique id within this task, e.g. "C-001". */
  id: string;
  /** Human-readable display title used as the EvalRequirement `name`. */
  title: string;
  /**
   * Behavioural assertion evaluated by the LLM judge.
   * Asserts the artifact (output shape), never the mechanism (which builder
   * step produced it). An agent that inlines a value directly must still pass.
   */
  match_criteria: string;
}

export interface WorkflowBenchmarkTask {
  /**
   * Namespaced corpus id, e.g. "wfbench/create-openai-call".
   * Load-bearing in two ways:
   *   (a) The EvalSet graph node `id` is set to this value. resolveEvalSetRefIdBySlug
   *       searches by `attribute: "id", value: taskSlug`, so a mismatch means the
   *       roster is permanently unavailable.
   *   (b) BENCHMARK_RUNNER is a generic run type; result.taskSlug (set to this
   *       value at dispatch) is the discriminator between benchmark domains.
   *       The `wfbench/` prefix prevents collision with other domains.
   */
  slug: string;
  /** Display title shown in the UI task list. */
  title: string;
  /**
   * Plain-English instruction sent verbatim to the Workflow Editor agent.
   * Must name every entry in `expectedSecrets` explicitly so C-004-style
   * criteria test instruction-following, not telepathy.
   */
  instructions: string;
  /** Behavioural criteria evaluated by the LLM judge. */
  criteria: WorkflowBenchmarkCriterion[];
  /**
   * Secret names that must appear in `instructions` and whose presence in the
   * workflow output criteria tests assertion-by-name rather than resolution.
   * Carried here as corpus data so criteria can reference the array without
   * embedding the string in prose.
   */
  expectedSecrets: string[];
  /**
   * OPTIONAL baseline for EDIT-flavour tasks. Absent on CREATE tasks.
   * When present, BOTH fields are required — a partial baseline is invalid.
   * Stakwork workflows carry many versions with one published default; an EDIT
   * task must always pin a specific workflow_version_id, never the moving default.
   */
  baseline?: {
    workflow_id: number;
    workflow_version_id: number;
  };
}

// ── Compile-time mutual-assignability assertion ─────────────────────────────
// If a field is added to the schema without updating the interface (or vice
// versa), this fails to compile. The runtime assertion below (checked by the
// generator) then only needs to guard the JSON boundary, not shape drift.

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * Normalizes a type to a plain mapped type before comparison. `Equal`'s
 * conditional-type trick is sensitive to *how* a shape is represented (a
 * hand-written `interface` vs. a `&` intersection produce distinguishable
 * internal representations even when every resolved property is identical),
 * so both sides are routed through this first to compare resolved shape only.
 */
type Resolve<T> = { [K in keyof T]: T[K] };

type _AssertTaskShapeMatchesSchema = Expect<
  Equal<Resolve<WorkflowBenchmarkTask>, Resolve<WorkflowBenchmarkTaskSource & { slug: string }>>
>;

// ── Invariant predicates (pure; shared by generator + tests) ────────────────

/**
 * A single invariant violation. `filePath`/`filePaths` name the offending
 * source(s) so the generator's hard error can point at exactly what to fix.
 */
export interface InvariantViolation {
  /** Machine-stable name of the violated invariant. */
  invariant: string;
  /** Human-readable explanation. */
  message: string;
  /** The offending file path(s), when known. */
  filePaths: string[];
}

function violation(
  invariant: string,
  message: string,
  filePaths: string[],
): InvariantViolation {
  return { invariant, message, filePaths };
}

/**
 * A minimal shape sufficient to run the invariant predicates below without
 * requiring a full zod-validated object — deliberately loose so tests can
 * construct deliberately-invalid fixtures directly.
 */
export interface InvariantCheckableTask {
  slug?: unknown;
  criteria?: Array<{ id?: unknown; match_criteria?: unknown }>;
  baseline?: { workflow_id?: unknown; workflow_version_id?: unknown } | undefined;
}

/** Slug matches TASK_SLUG_RE. */
export function checkSlugFormat(
  slug: string,
  filePath: string,
): InvariantViolation | null {
  if (!TASK_SLUG_RE.test(slug)) {
    return violation(
      "slug-format",
      `slug "${slug}" does not match TASK_SLUG_RE (${TASK_SLUG_RE})`,
      [filePath],
    );
  }
  return null;
}

/**
 * Slugs are unique across the whole tree — the sole guard against two
 * directories holding the same leaf name. Returns one violation per collision,
 * naming ALL contributing paths.
 */
export function checkSlugUniqueness(
  entries: Array<{ slug: string; filePath: string }>,
): InvariantViolation[] {
  const bySlug = new Map<string, string[]>();
  for (const { slug, filePath } of entries) {
    const paths = bySlug.get(slug) ?? [];
    paths.push(filePath);
    bySlug.set(slug, paths);
  }

  const violations: InvariantViolation[] = [];
  for (const [slug, paths] of bySlug) {
    if (paths.length > 1) {
      violations.push(
        violation(
          "slug-uniqueness",
          `slug "${slug}" is produced by ${paths.length} different task directories`,
          paths,
        ),
      );
    }
  }
  return violations;
}

/** Criterion ids are unique within a single task. */
export function checkCriterionIdsUnique(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  const ids = (task.criteria ?? []).map((c) => c.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    return violation(
      "criterion-ids-unique",
      `duplicate criterion id(s): ${[...new Set(dupes)].join(", ")}`,
      [filePath],
    );
  }
  return null;
}

/**
 * `criteria` is non-empty, and every criterion's `match_criteria` is a
 * non-empty (non-whitespace-only) string.
 */
export function checkNonEmptyMatchCriteria(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  const criteria = task.criteria ?? [];
  if (criteria.length === 0) {
    return violation("non-empty-match-criteria", "criteria array is empty", [
      filePath,
    ]);
  }
  const emptyIds = criteria
    .filter((c) => typeof c.match_criteria !== "string" || c.match_criteria.trim().length === 0)
    .map((c) => String(c.id ?? "<unknown id>"));
  if (emptyIds.length > 0) {
    return violation(
      "non-empty-match-criteria",
      `criterion(s) with empty match_criteria: ${emptyIds.join(", ")}`,
      [filePath],
    );
  }
  return null;
}

/** If `baseline` is present, BOTH fields must be present — no partial baseline. */
export function checkBaselineCompleteness(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  if (task.baseline === undefined) return null;
  const hasWorkflowId = task.baseline.workflow_id !== undefined;
  const hasVersionId = task.baseline.workflow_version_id !== undefined;
  if (hasWorkflowId !== hasVersionId) {
    return violation(
      "baseline-completeness",
      "baseline is present but only one of workflow_id/workflow_version_id is set — " +
        "both are required, or omit baseline entirely",
      [filePath],
    );
  }
  return null;
}

/**
 * Runs every per-task invariant (excludes cross-file slug uniqueness, which
 * needs the whole-tree entry list) against a single task + its file path.
 * Used by both the generator (pre-emit) and tests (against fixtures).
 */
export function checkTaskInvariants(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (typeof task.slug === "string") {
    const slugViolation = checkSlugFormat(task.slug, filePath);
    if (slugViolation) violations.push(slugViolation);
  }
  const idViolation = checkCriterionIdsUnique(task, filePath);
  if (idViolation) violations.push(idViolation);
  const criteriaViolation = checkNonEmptyMatchCriteria(task, filePath);
  if (criteriaViolation) violations.push(criteriaViolation);
  const baselineViolation = checkBaselineCompleteness(task, filePath);
  if (baselineViolation) violations.push(baselineViolation);
  return violations;
}

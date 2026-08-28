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
 * IMPORTANT — client-bundle safety: this module is imported (for `TASK_SLUG_RE`
 * and types) by `src/lib/workflow-benchmark-tasks.ts`, which is in turn imported
 * by the client ("use client") `WorkflowBenchmarksPanel.tsx`. Never import a
 * Node built-in (e.g. `crypto`) at this module's top level — see
 * `criteriaFingerprint` below, which deliberately uses a plain-JS string hash
 * instead of `node:crypto` for exactly this reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Authoring conventions
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A benchmark task measures whether the Workflow Editor agent produces
 * correctly structured workflow JSON from a plain-English instruction. Each
 * task lives at `benchmarks/workflow-editor/tasks/{dir}/{task-slug}/task.json`.
 * The directory tree IS the taxonomy: a task's grouping is simply where its
 * file sits. The generator emits the grouping directory verbatim as `section`
 * (UI grouping only — never authored in task.json, never asserted against a
 * closed union of names, and deliberately excluded from the slug so a
 * `git mv` between directories never changes a task's identity — see
 * `taskSlugFromPath` in the generator).
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
 *   - `instructions`  — a ONE-LINE intent statement: what the produced
 *                       workflow is FOR ("send a user-supplied prompt to an
 *                       LLM and return the model's response"). Deliberately
 *                       NOTHING else — no endpoint URL, no secret name, no
 *                       model name, no body-field enumeration, no structural
 *                       requirements. Criteria must never pin a value the
 *                       intent does not state; they assert either universal
 *                       properties of a correct artifact (structural validity,
 *                      credential hygiene) or capability implied by the intent
 *                      itself (the supplied value actually reaches the model
 *                      call). Declared input key names are NOT typed into this
 *                      field by hand — `workflow_input` declares them and the
 *                      generator injects the INPUT block mechanically.
 *
 *   What `wfbench/create-openai-call` therefore tests: given ONLY an intent,
 *   does the agent produce a structurally valid workflow that makes a
 *   provider call, references its credential in the correct `%%AUTHORING%%`
 *   form below, and leaks no plaintext secret. It is not an
 *   instruction-following test — the days of instructing exact endpoint,
 *   model and header are gone on purpose.
 *
 *   - `criteria`      — behavioural criteria evaluated by the LLM judge. Each
 *                       asserts the artifact (output shape), never the
 *                       mechanism (which builder step produced it). An agent
 *                       that inlines a value directly must still pass.
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
 * Two generate-time invariants police secret handling MECHANICALLY (moving
 * authoring from type-checked TS to hand-written JSON makes a pasted-in live
 * credential strictly more likely, and hand-written `task.json` has no
 * compiler to catch it):
 *
 *   - Every `%%…%%` token in `instructions` must match `^%%[A-Z0-9_]+%%$`
 *     exactly — a malformed or unterminated reference fails the generate
 *     step instead of reaching the external LLM judge undetected. See
 *     `checkSecretReferenceForm`.
 *   - Neither `instructions` nor any `workflow_input` value may carry text
 *     matching a known live-credential shape — reusing `TOKEN_SHAPES` from
 *     `src/lib/run-report/redact.ts` rather than keeping a second pattern
 *     list that would drift from the redactor's. A well-formed
 *     `%%[A-Z0-9_]+%%` reference is explicitly allowed and never flagged.
 *     See `checkNoCredentialShapedContent`.
 *
 * Scoping asymmetry, deliberate: both invariants scan `instructions` and
 * `workflow_input` only — NOT criterion bodies — because criteria
 * legitimately quote malformed/runtime examples (`{{ … }}`, lowercase
 * names) verbatim to teach the judge what to reject.
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
// Pure-JS module (no Node builtins, no side effects) — safe to import into
// this client-reachable file. See the header note below on bundle safety.
import { TOKEN_SHAPES } from "../run-report/redact";

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
  evaluates: z
    .enum(["workflow", "output"])
    .optional()
    .describe(
      'Which evidence this criterion judges. "workflow" (the default when ' +
        "absent) — the static workflow JSON the agent produced. \"output\" — " +
        "the run output produced by executing that workflow with the task's " +
        "`workflow_input`; requires the task to declare `workflow_input` " +
        "(enforced by checkOutputCriteriaRequireWorkflowInput).",
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
 * `workflow_input` — named input values the produced workflow consumes on
 * rerun. Read by TWO consumers: the Workflow Editor agent at build time (via
 * the INPUT block the generator appends to `instructions` — see
 * `INPUT_BLOCK_SENTENCE` below) and the Stakwork rerunner (workflow 58313) at
 * rerun time (via the `workflow_input_json` dispatch var). String-only in v1:
 * `set_var` vars land as strings on the wire, so a number would silently
 * change type across the round trip — zod enforces this at generate time,
 * and `checkWorkflowInputValuesAreStrings` re-asserts it as a runtime
 * predicate for hand-constructed fixtures that bypass zod entirely.
 *
 * Independently optional from `expected_output` — declaring one does not
 * require the other, though in practice a task with no way to check its
 * answer gains little from declaring inputs at all.
 */
const workflowInputSchema = z
  .record(z.string(), z.string())
  .describe(
    "Named input values the produced workflow consumes on rerun. Every key " +
      "must appear verbatim in the INPUT block the generator injects into " +
      "`instructions` (never hand-authored) and in at least one criterion's " +
      "match_criteria, in backticked or quoted delimited form.",
  );

/**
 * `expected_output` — the deterministic answer for a rerun check (e.g.
 * `{ country: "Wales" }` → `"Cardiff"`). Authored alongside `workflow_input`
 * in the same `task.json` for single-file authoring, but the generator
 * routes it to a SEPARATE server-boundary module
 * (`expected-outputs.server.generated.ts`) and OMITS it from the client-
 * imported index — see `WorkflowBenchmarkTask` below, which is
 * `Omit<WorkflowBenchmarkTaskSource, "expected_output">`. Never add this
 * field back to the index type; `WorkflowBenchmarksPanel.tsx` imports the
 * whole index and ships it to the browser.
 */
const expectedOutputSchema = z
  .string()
  .min(1)
  .describe(
    "Deterministic rerun answer, e.g. \"Cardiff\". Server-boundary only — " +
      "routed to expected-outputs.server.generated.ts, never emitted into " +
      "the client-imported index.",
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
      "ONE-LINE intent statement — what the produced workflow is FOR, and " +
        "nothing else: no endpoint URL, secret name, model name, body-field " +
        "enumeration or structural requirement. When `workflow_input` is " +
        "declared, the `instructions` an author writes here is NOT " +
        "byte-identical to what the agent ultimately receives — the generator " +
        "appends an INPUT block (see INPUT_BLOCK_SENTENCE) under its own " +
        "heading at the end.",
    ),
  criteria: z
    .array(criterionSchema)
    .describe("Behavioural criteria evaluated by the LLM judge."),
  baseline: baselineSchema.optional(),
  workflow_input: workflowInputSchema.optional(),
  expected_output: expectedOutputSchema.optional(),
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
  /**
   * Which evidence this criterion judges. `"workflow"` (the default when
   * absent) — the static workflow JSON. `"output"` — the run output produced
   * by executing the workflow with the task's `workflow_input`. Sits in the
   * same `criteria` array as workflow criteria: one roster, one denominator.
   * A task may only declare `"output"` criteria when it declares
   * `workflow_input` — there is otherwise nothing to execute the workflow
   * with (checkOutputCriteriaRequireWorkflowInput).
   */
  evaluates?: "workflow" | "output";
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
  /**
   * Grouping directory the task.json sits under, emitted verbatim from
   * `benchmarks/workflow-editor/tasks/{section}/{task-slug}/task.json`.
   * UI grouping only — never load-bearing: the slug deliberately excludes it
   * (so `git mv` between directories never changes a task's identity), no
   * closed union of section names exists anywhere, and it is derived by the
   * generator, never authored in task.json.
   */
  section: string;
  /** Display title shown in the UI task list. */
  title: string;
  /**
   * ONE-LINE intent statement sent to the Workflow Editor agent — what the
   * produced workflow is FOR, and nothing else: no endpoint URL, no secret
   * name, no model name, no body-field enumeration, no structural
   * requirements. Criteria must never pin a value this intent does not state.
   * Declared inputs are injected at the end by the generator (`workflow_input`
   * -> INPUT block), so when inputs exist this string is not byte-identical
   * to what the agent receives. Every `%%…%%` token here is generate-time
   * validated for well-formedness, and the whole string is scanned against
   * live-credential shapes — see `checkSecretReferenceForm` /
   * `checkNoCredentialShapedContent`.
   */
  instructions: string;
  /** Behavioural criteria evaluated by the LLM judge. */
  criteria: WorkflowBenchmarkCriterion[];
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
  /**
   * Named input values the produced workflow consumes on rerun, e.g.
   * `{ country: "Wales" }`. Independently optional from `expected_output`.
   * Client-visible (part of the index) BY DESIGN — operators should see what
   * a run will be launched with before pressing Run. Never put credentials
   * or customer-derived values here — this field ships to the browser.
   */
  workflow_input?: Record<string, string>;
  /**
   * DELIBERATELY ABSENT from this emitted/index type. `expected_output` is
   * authored in the same `task.json` but the generator routes it to
   * `expected-outputs.server.generated.ts` (a slug -> answer map) rather than
   * here, so the deterministic rerun answer never reaches the client bundle
   * — `WorkflowBenchmarksPanel.tsx` imports this whole type and ships it to
   * the browser. See `WorkflowBenchmarkTaskSource` for the authoring shape
   * that DOES carry it.
   */
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
  Equal<
    Resolve<WorkflowBenchmarkTask>,
    Resolve<
      Omit<WorkflowBenchmarkTaskSource, "expected_output"> & {
        slug: string;
        section: string;
      }
    >
  >
>;

// ── INPUT block injection (Slice 1) ─────────────────────────────────────────

/**
 * Heading the generator writes above the injected INPUT block, at the end of
 * `instructions`, separated from any existing content by a blank line. Pinned
 * here (not inline in the generator) so both the generator and tests reference
 * the exact same string.
 */
export const INPUT_BLOCK_HEADING = "## Workflow Inputs";

/**
 * Declaration sentence the generator writes under `INPUT_BLOCK_HEADING`.
 * The complete injected block is exactly:
 *
 *     ## Workflow Inputs
 *
 *     Declare each of the following as a caller-supplied workflow input, using these exact names:
 *
 *     - `country`
 *
 * i.e. heading, blank line, this sentence, blank line, then each declared
 * `workflow_input` key as a backticked bullet list item (`- \`key\``). Read by
 * the Workflow Editor agent at build time — it is the ONLY channel telling the
 * agent what input key names to declare in the produced workflow. If the agent
 * invents its own names, the rerunner's payload matches nothing: the workflow
 * runs, reports success, and nothing errors.
 */
export const INPUT_BLOCK_SENTENCE =
  "Declare each of the following as a caller-supplied workflow input, using these exact names:";

/**
 * Builds the full INPUT block (heading + sentence + backticked keys) exactly
 * as the generator appends it to `instructions`. Exported so both the
 * generator and tests construct/assert against the identical string — and so
 * `checkNoHandAuthoredInputBlock` can detect an author having typed one by hand.
 */
export function renderInputBlock(workflowInput: Record<string, string>): string {
  const keys = Object.keys(workflowInput);
  const keyLines = keys.map((k) => `- \`${k}\``).join("\n");
  return `${INPUT_BLOCK_HEADING}\n\n${INPUT_BLOCK_SENTENCE}\n\n${keyLines}`;
}

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
  instructions?: unknown;
  criteria?: Array<{ id?: unknown; match_criteria?: unknown; evaluates?: unknown }>;
  baseline?: { workflow_id?: unknown; workflow_version_id?: unknown } | undefined;
  workflow_input?: Record<string, unknown> | undefined;
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
 * Every `workflow_input` value must be a string. Zod already enforces this
 * at parse time for anything routed through `taskSourceSchema`, but this
 * predicate re-asserts it at runtime so hand-constructed fixtures that
 * bypass zod entirely (the negative-fixture table) are still caught, and so
 * the generator and tests share one definition.
 */
export function checkWorkflowInputValuesAreStrings(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  if (task.workflow_input === undefined) return null;
  const nonStringKeys = Object.entries(task.workflow_input)
    .filter(([, v]) => typeof v !== "string")
    .map(([k]) => k);
  if (nonStringKeys.length > 0) {
    return violation(
      "workflow-input-values-are-strings",
      `workflow_input value(s) are not strings: ${nonStringKeys.join(", ")}`,
      [filePath],
    );
  }
  return null;
}

/**
 * Rejects a `task.json` whose authored `instructions` already contains a
 * hand-written version of the INPUT block. The block is INJECTED by the
 * generator from the declared `workflow_input` keys — an author typing one
 * by hand would either double up (confusing the agent with two blocks) or
 * silently diverge from the generator's canonical wording. Detected by
 * presence of the fixed heading, which an author has no legitimate reason
 * to write themselves.
 */
export function checkNoHandAuthoredInputBlock(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  const instructions = task.instructions;
  if (typeof instructions !== "string") return null;
  if (instructions.includes(INPUT_BLOCK_HEADING) || instructions.includes(INPUT_BLOCK_SENTENCE)) {
    return violation(
      "no-hand-authored-input-block",
      `instructions already contain a hand-authored INPUT block (heading "${INPUT_BLOCK_HEADING}" or the ` +
        `injection sentence) — the generator injects this block itself; remove the hand-written version`,
      [filePath],
    );
  }
  return null;
}

/**
 * Every task declaring `workflow_input` must have at least one criterion
 * whose `match_criteria` names each declared key in DELIMITED form —
 * backticked (`` `country` ``) or double-quoted (`"country"`). A bare
 * substring match (`match_criteria.includes("country")`) would false-pass on
 * incidental prose like "the country capital" without the criterion actually
 * asserting anything about the input mechanism, which is exactly the false
 * positive this predicate exists to prevent.
 */
export function checkInputKeysReferencedInCriteria(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  if (task.workflow_input === undefined) return null;
  const keys = Object.keys(task.workflow_input);
  const criteria = task.criteria ?? [];
  const allMatchCriteria = criteria
    .map((c) => (typeof c.match_criteria === "string" ? c.match_criteria : ""))
    .join("\n");

  const missing = keys.filter((key) => {
    const backticked = new RegExp("`" + escapeRegExp(key) + "`");
    const quoted = new RegExp('"' + escapeRegExp(key) + '"');
    return !backticked.test(allMatchCriteria) && !quoted.test(allMatchCriteria);
  });

  if (missing.length > 0) {
    return violation(
      "input-keys-referenced-in-criteria",
      `workflow_input key(s) not named in delimited (backticked or quoted) form in any ` +
        `criterion's match_criteria: ${missing.join(", ")}`,
      [filePath],
    );
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A criterion with `evaluates: "output"` is judged against the run output of
 * the executed workflow — so the task must declare `workflow_input`, or there
 * is nothing to execute the workflow with and the criterion is unevaluable by
 * construction. Values other than "workflow"/"output" are rejected here for
 * hand-constructed fixtures that bypass zod (zod already rejects them at
 * parse time).
 */
export function checkOutputCriteriaRequireWorkflowInput(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  const criteria = task.criteria ?? [];
  const badValueIds = criteria
    .filter(
      (c) =>
        c.evaluates !== undefined &&
        c.evaluates !== "workflow" &&
        c.evaluates !== "output",
    )
    .map((c) => String(c.id ?? "<unknown id>"));
  if (badValueIds.length > 0) {
    return violation(
      "output-criteria-require-workflow-input",
      `criterion(s) with invalid \`evaluates\` value (must be "workflow" or "output"): ${badValueIds.join(", ")}`,
      [filePath],
    );
  }

  const outputIds = criteria
    .filter((c) => c.evaluates === "output")
    .map((c) => String(c.id ?? "<unknown id>"));
  const hasWorkflowInput =
    task.workflow_input !== undefined && Object.keys(task.workflow_input).length > 0;
  if (outputIds.length > 0 && !hasWorkflowInput) {
    return violation(
      "output-criteria-require-workflow-input",
      `criterion(s) with evaluates: "output" (${outputIds.join(", ")}) but no declared ` +
        "workflow_input — there is nothing to execute the workflow with",
      [filePath],
    );
  }
  return null;
}

// ── Secret-handling invariants (Slice 2) ────────────────────────────────────

/**
 * Well-formed authoring-form secret reference: paired %% around ONE OR MORE
 * uppercase letters / digits / underscores — nothing else.
 *
 * This is the machine-checked contract behind criteria like C-005 ("reference
 * form"). It is deliberately strict: lowercase names (`%%my-secret%%`),
 * surrounding whitespace (`%% NAME %%`), empty tokens (`%%%%`) and any other
 * garbage inside a %%…%% pair all fail, so a hand-typo in a secret reference
 * is a build error rather than an undetected prompt defect handed to an
 * external LLM judge (who cannot verify resolution semantics anyway).
 *
 * Scope note: a lone single-% spelling (%NAME%) is NOT detectable here —
 * paired-token scanning only sees complete %%…%% groups, and blanket
 * %-counting would false-positive on prose like "reply with 90% confidence".
 * That case stays with the C-005 criterion wording (judge-side).
 */
const WELL_FORMED_SECRET_REFERENCE_RE = /^%%[A-Z0-9_]+%%$/;
/** Scan pattern for candidate %%…%% tokens inside a larger text blob. */
const SECRET_REFERENCE_TOKEN_SCAN_RE = /%%[^%]*%%/g;

/**
 * Every `%%…%%` token found in a task's `instructions` must match
 * `^%%[A-Z0-9_]+%%$` exactly. Also rejects an unbalanced number of %%
 * markers (a partially-deleted token), which paired extraction alone would
 * silently pass.
 *
 * Scope: `instructions` ONLY. Criterion bodies are exempt — they quote
 * malformed/runtime spellings verbatim to teach the judge what to reject
 * (see the schema-header note on scoping asymmetry). Error messages never
 * echo the offending token.
 */
export function checkSecretReferenceForm(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  const instructions = task.instructions;
  if (typeof instructions !== "string") return null;

  const markerCount = instructions.split("%%").length - 1;
  if (markerCount % 2 !== 0) {
    return violation(
      "secret-reference-form",
      "instructions contain an unbalanced number of %% markers — every secret " +
        "reference must be a complete %%SECRET_NAME%% token matching ^%%[A-Z0-9_]+%%$ " +
        "(the offending region is deliberately not echoed)",
      [filePath],
    );
  }

  SECRET_REFERENCE_TOKEN_SCAN_RE.lastIndex = 0;
  const tokens = instructions.match(SECRET_REFERENCE_TOKEN_SCAN_RE) ?? [];
  const malformedCount = tokens.filter(
    (token) => !WELL_FORMED_SECRET_REFERENCE_RE.test(token),
  ).length;
  if (malformedCount > 0) {
    return violation(
      "secret-reference-form",
      `${malformedCount} %%…%% token(s) in instructions are malformed — every one must ` +
        `match ^%%[A-Z0-9_]+%%$ exactly (uppercase letters, digits, underscores; ` +
        `the offending token(s) are deliberately not echoed)`,
      [filePath],
    );
  }
  return null;
}

/**
 * True when the text matches one of the shared TOKEN_SHAPES from
 * `run-report/redact.ts`, AFTER first stripping well-formed `%%[A-Z0-9_]+%%`
 * reference tokens — those are the sanctioned way to name a secret and must
 * never trip this check as a false positive.
 */
export function matchesCredentialShape(value: string): boolean {
  const scrubbed = value.replace(/%%[A-Z0-9_]+%%/g, "");
  return TOKEN_SHAPES.some((pattern) => {
    // Shared module-level /g regexes — reset before each scan.
    pattern.lastIndex = 0;
    return pattern.test(scrubbed);
  });
}

/**
 * No part of a task that ships outward may carry text shaped like a LIVE
 * credential. Hand-written JSON makes a pasted-in real key strictly more
 * likely than typed TS did, and both `workflow_input` (by design) and
 * `instructions` reach the browser/agent, so a shape match here hard-fails
 * generation. Reuses TOKEN_SHAPES from run-report/redact.ts rather than a
 * second list.
 *
 * The matched value is NEVER included in the violation message — echoing it
 * would put the credential into generator output/logs.
 */
export function checkNoCredentialShapedContent(
  task: InvariantCheckableTask,
  filePath: string,
): InvariantViolation | null {
  if (typeof task.instructions === "string" && matchesCredentialShape(task.instructions)) {
    return violation(
      "no-credential-shaped-content",
      "instructions contain text matching a live-credential shape (matched value " +
        "deliberately not echoed) — reference secrets as %%SOME_SECRET_NAME%% instead",
      [filePath],
    );
  }

  if (task.workflow_input !== undefined && typeof task.workflow_input === "object") {
    for (const [key, value] of Object.entries(task.workflow_input)) {
      if (typeof value === "string" && matchesCredentialShape(value)) {
        return violation(
          "no-credential-shaped-content",
          `workflow_input value for key "${key}" matches a live-credential shape (value ` +
            "deliberately not echoed) — workflow_input ships to the browser; keep only " +
            "benign sample values here",
          [filePath],
        );
      }
    }
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
  const workflowInputStringsViolation = checkWorkflowInputValuesAreStrings(task, filePath);
  if (workflowInputStringsViolation) violations.push(workflowInputStringsViolation);
  const handAuthoredInputBlockViolation = checkNoHandAuthoredInputBlock(task, filePath);
  if (handAuthoredInputBlockViolation) violations.push(handAuthoredInputBlockViolation);
  const inputKeysReferencedViolation = checkInputKeysReferencedInCriteria(task, filePath);
  if (inputKeysReferencedViolation) violations.push(inputKeysReferencedViolation);
  const secretReferenceFormViolation = checkSecretReferenceForm(task, filePath);
  if (secretReferenceFormViolation) violations.push(secretReferenceFormViolation);
  const credentialShapedContentViolation = checkNoCredentialShapedContent(task, filePath);
  if (credentialShapedContentViolation) violations.push(credentialShapedContentViolation);
  const outputCriteriaViolation = checkOutputCriteriaRequireWorkflowInput(task, filePath);
  if (outputCriteriaViolation) violations.push(outputCriteriaViolation);
  return violations;
}

// ── Criteria fingerprint (Correction 6) ─────────────────────────────────────

/**
 * Deterministic hash of a task's criteria (id + title + match_criteria for
 * each, in order). Computed AT DISPATCH TIME by the run route — never
 * emitted into the generated index — so that two runs of the same slug
 * scored against different rubric text are distinguishable after the fact
 * by anyone querying the run record (`result.hive.criteriaFingerprint`).
 *
 * Write-only provenance: nothing in this codebase currently reads it back
 * for comparison/triage. Surfacing it in the UI is an explicit follow-up,
 * out of scope here.
 *
 * Deliberately NOT `node:crypto` — this module is imported transitively by
 * the client bundle (see file header) and a top-level `crypto` import would
 * break under bundlers that don't polyfill it. A simple deterministic
 * string hash is sufficient for a provenance tag, not a security boundary.
 */
export function criteriaFingerprint(
  criteria: Array<{
    id: string;
    title: string;
    match_criteria: string;
    evaluates?: "workflow" | "output";
  }>,
): string {
  // `evaluates` is hashed only when present, so fingerprints of untagged
  // (pre-existing) criteria are unchanged by the field's introduction — but a
  // criterion switching evidence class IS a rubric change and must re-hash.
  const input = criteria
    .map(
      (c) =>
        `${c.id}\u0000${c.title}\u0000${c.match_criteria}` +
        (c.evaluates !== undefined ? `\u0000${c.evaluates}` : ""),
    )
    .join("\u0001");

  // FNV-1a 32-bit — deterministic, dependency-free, no Node builtins.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

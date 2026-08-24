/**
 * Workflow Editor Benchmark corpus.
 *
 * The benchmark measures whether the Workflow Editor agent produces correctly
 * structured workflow JSON from a plain-English instruction. Each task carries:
 *
 *   - `slug`          — namespaced corpus id (load-bearing: used as the EvalSet
 *                       node id in the graph; also discriminates BENCHMARK_RUNNER
 *                       rows from other domains since the run type is generic).
 *                       Permitted characters: /^[a-z0-9_\-/]+$/i
 *
 *   - `expectedSecrets` — secret names the instructions must reference by name.
 *                       Carried here so they are corpus data rather than prose
 *                       buried inside a criterion that an LLM judge has to parse.
 *
 *   - `baseline`       — OPTIONAL. Absent on CREATE-flavour tasks (the agent
 *                       builds from nothing). EDIT-flavour tasks pin a specific
 *                       workflow_version_id — NEVER the moving published default.
 *                       When present, BOTH fields must be supplied; a partial
 *                       baseline is invalid (enforced by the generic invariant below).
 *
 * Criterion wording conventions (copy-comparable ground truth for an LLM judge):
 *
 *   Step-output reference — REQUIRED form:  [#(step_id).output.variable_name]
 *   Secret reference      — REQUIRED authoring form:  %%SECRET_NAME%%
 *   REJECTED runtime form — bare {{ … }} (same mechanism as %%…%%, just the
 *                           runtime spelling — accepting it would score a broken
 *                           workflow as correct).
 *
 * These three forms are named explicitly inside the criterion bodies so a judge
 * has a copy-comparable string, not prose to interpret.
 */

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
  /** Eight behavioural criteria evaluated by the LLM judge. */
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

/**
 * Allowed slug characters — mirrors the legal dispatch route's TASK_SLUG_RE.
 * Validated in tests and used by the dispatch route corpus lookup.
 */
export const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;

// ── Seed task: CREATE-flavour ────────────────────────────────────────────────

/**
 * "Create a workflow that calls OpenAI with a prompt."
 *
 * No `baseline` — the agent builds from nothing. Comparability across reruns
 * comes from the fixed `instructions` string plus the fixed 8-criterion roster:
 * every run gets the identical prompt scored against the identical requirements.
 *
 * The expected secret OPENAI_STAKWORK_MAIN_KEY is named literally in the
 * instructions so C-004 tests instruction-following rather than telepathy.
 * C-004 hard-fails on shape (plaintext key; raw key in URL) and must NOT fail
 * on whether %%OPENAI_STAKWORK_MAIN_KEY%% resolves in a given environment —
 * an unresolved %%SECRET%% is a custom_warnings entry upstream, never an error.
 */
export const CREATE_OPENAI_CALL_TASK: WorkflowBenchmarkTask = {
  slug: "wfbench/create-openai-call",
  title: "Create a workflow that calls OpenAI with a prompt",
  instructions: `Create a Stakwork workflow that calls the OpenAI chat completions API with a user-supplied prompt.

Requirements:
- Use a single Request step to POST to the OpenAI chat completions API endpoint (https://api.openai.com/v1/chat/completions).
- The Authorization header MUST use the secret reference %%OPENAI_STAKWORK_MAIN_KEY%% in the authoring form — do NOT use a raw API key or the runtime form {{ OPENAI_STAKWORK_MAIN_KEY }}.
- The request body must include a "model" field (e.g. "gpt-4o") and a "messages" field containing an array with at least one user message whose "content" is the prompt input.
- The prompt input should be referenced using the step-output form [#(step_id).output.variable_name] or as a workflow variable.
- The workflow must have a valid start connection and an edge into system.succeed.
- Do not include any plaintext API keys in the workflow JSON.`,
  expectedSecrets: ["OPENAI_STAKWORK_MAIN_KEY"],
  criteria: [
    {
      id: "C-001",
      title: "Request step exists",
      match_criteria:
        "The workflow JSON contains at least one step with a type that corresponds to an HTTP Request step (e.g. type 'request', 'http_request', or equivalent). The step must be present in the workflow's steps or nodes array.",
    },
    {
      id: "C-002",
      title: "URL is the OpenAI chat completions endpoint",
      match_criteria:
        'The Request step\'s attributes.url (or equivalent URL field) is exactly "https://api.openai.com/v1/chat/completions" or a reference that resolves to it. A URL pointing to any other endpoint fails this criterion.',
    },
    {
      id: "C-003",
      title: "HTTP method is POST",
      match_criteria:
        'The Request step\'s attributes.method (or equivalent method field) is "post" or "POST". Any other method value (GET, PUT, PATCH, DELETE) fails this criterion.',
    },
    {
      id: "C-004",
      title: "Authorization header uses a secret reference",
      match_criteria:
        'The Request step\'s Authorization header value derives from a secret reference in the authoring form %%SECRET_NAME%% (e.g. %%OPENAI_STAKWORK_MAIN_KEY%%). ' +
        "PASS: the Authorization header contains %%OPENAI_STAKWORK_MAIN_KEY%% or a Bearer token whose value is %%OPENAI_STAKWORK_MAIN_KEY%%. " +
        "FAIL: the Authorization header contains a plaintext API key (e.g. sk-...), a raw key embedded directly in the URL, or the rejected runtime form {{ OPENAI_STAKWORK_MAIN_KEY }}. " +
        "This criterion asserts the SHAPE of the reference, not whether the secret resolves in a given environment — an unresolved %%SECRET%% in the output is a warning upstream, never a failure here.",
    },
    {
      id: "C-005",
      title: "Authorization uses the required authoring form, not the runtime form",
      match_criteria:
        "The Authorization header's secret reference is in the authoring form %%SECRET_NAME%% and not in the rejected runtime form {{ SECRET_NAME }}. " +
        "The authoring form %%…%% and the runtime form {{ … }} are two spellings of the same secret-substitution mechanism; %%…%% is required in authored workflow JSON. " +
        "PASS: %%OPENAI_STAKWORK_MAIN_KEY%% appears in the Authorization header. " +
        "FAIL: {{ OPENAI_STAKWORK_MAIN_KEY }} or {{ OPENAI_STAKWORK_MAIN_KEY | default: '' }} or any bare {{ … }} variant appears in the Authorization header.",
    },
    {
      id: "C-006",
      title: "Request body contains a known-good model field",
      match_criteria:
        'The request body (in attributes.body, attributes.payload, or an equivalent field) contains a "model" key whose value is a recognized OpenAI model name (e.g. "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-4o-mini"). ' +
        "The value must be a non-empty string. A missing model field or an empty string fails this criterion.",
    },
    {
      id: "C-007",
      title: "Request body messages array includes a user turn with the prompt",
      match_criteria:
        'The request body contains a "messages" field whose value is an array containing at least one object with "role": "user" and a non-empty "content" field that carries the user prompt. ' +
        "The prompt content may be a literal string, a step-output reference in the required form [#(step_id).output.variable_name], or a workflow variable reference. " +
        "FAIL: the messages array is absent, empty, contains no user-role entry, or the user entry has an empty content. " +
        "A system message alone (without a user message) also fails this criterion.",
    },
    {
      id: "C-008",
      title: "Workflow is structurally valid",
      match_criteria:
        'The workflow JSON satisfies all three structural requirements: ' +
        '(1) there is at least one connection whose source is "start" (or the workflow has a designated start node/step); ' +
        '(2) every step is reachable via an unbroken chain of connections from start (no orphaned steps); ' +
        '(3) there is at least one edge whose target is "system.succeed" (or the equivalent terminal node), ensuring the workflow can reach a successful completion state. ' +
        "A workflow missing any one of these three is structurally invalid and fails this criterion.",
    },
  ],
};

/** All benchmark tasks in the corpus. Add new tasks here. */
export const WORKFLOW_BENCHMARK_TASKS: WorkflowBenchmarkTask[] = [
  CREATE_OPENAI_CALL_TASK,
];

/**
 * Look up a task by its namespaced slug.
 * Returns undefined when the slug is not in the corpus.
 */
export function findBenchmarkTask(slug: string): WorkflowBenchmarkTask | undefined {
  return WORKFLOW_BENCHMARK_TASKS.find((t) => t.slug === slug);
}

/**
 * The set of all valid corpus slugs — used by dispatch and rubrics routes
 * to validate the `taskSlug` query/body param against the corpus rather than
 * forwarding an arbitrary string into graph queries or workflow vars.
 */
export const CORPUS_SLUGS: ReadonlySet<string> = new Set(
  WORKFLOW_BENCHMARK_TASKS.map((t) => t.slug),
);

# Workflow Benchmarks: Run-Output Criteria

The Workflow Editor Benchmark rubrics judge two kinds of evidence:

- **Workflow criteria** — what the produced workflow contains and whether it
  runs (a model call is made, a model id is set, credentials are referenced by
  name, declared inputs reach the call by reference, the engine's validator
  passes and the rerun completed, …). Engine-neutral — see below.
- **Output criteria** — what the workflow actually returns when executed with
  the task's `workflow_input`.

Both kinds live in the **same `criteria` array** — one roster, one
denominator, one score. What distinguishes an output criterion is the
per-criterion `evaluates` field:

- `"workflow"` (the default when absent) — judged against the produced
  workflow artifact plus the evidence that it ran.
- `"output"` — judged against the run output of the executed workflow.

The judge reads `evaluates` to pick the evidence per criterion. The field
rides the existing dispatch (`criteria` is `JSON.stringify`'d verbatim) and is
stamped on each EvalRequirement node in the graph roster, so the per-criterion
breakdown can distinguish "structurally perfect but returns garbage" from
"malformed workflow" inside the single score.

## Workflow-side criteria are engine-neutral

The same rubric now judges workflows built by more than one engine:

| | stakwork | vein |
|---|---|---|
| artifact | workflow JSON | YAML workflow |
| secrets | `%%SECRET_NAME%%` authoring form (`{{ }}` rejected) | referenced by NAME through a secret store; `{{ }}` templates are the normal spelling |
| model call | HTTP Request step to the provider | native `llm` / `agent` step, no HTTP step |
| wiring | `[#(step_id).output.x]` | `{{ }}` templates over inputs / step outputs |
| validity | connection from `start`, edge to `system.succeed`, no orphans | the engine's validator passes and the run completes |

A rubric written in one engine's spelling fails a correct workflow from the
other, so every workflow-side criterion asserts **behaviour and evidence**,
never an artifact form. No `%%…%%`, `{{ }}`, "HTTP Request step",
`[#(step).output]`, start/`system.succeed` connection or "workflow JSON" may
appear in a workflow-side criterion (`corpus.test.ts` pins this).

The shared block, authored once and stamped into every task (ids shift with
the task-specific criteria that precede it; per-task slots are the declared
input keys, how each input is consumed, and the deliverable):

1. **Makes a call to an external LLM provider** — any step type that
   demonstrably sends data to a model service and receives a response. The
   former conditional "if an HTTP step is used, the verb is POST" is folded in
   (a raw API request must be well-formed for the inference it requests; a
   native model step manages its own transport) instead of scoring as a free
   pass. Phrased as model inference, not chat completion — the audio and
   vision tasks call other model kinds.
2. **A model/deployment identifier is specified** — non-empty; provider and
   family unasserted; an engine-defaulted model is not a failure.
3. **Credentials are referenced by name, never as an inline literal** —
   through the engine's secret mechanism; a plaintext key in a header, URL,
   body or step configuration hard-fails; an engine that binds the provider
   credential implicitly also passes; WHICH secret is never asserted.
4. **Caller-supplied inputs reach the call by reference, not as literals** —
   so different inputs produce different results; template/reference syntax
   and the provider's request-body schema are not asserted.
5. **Workflow accepts caller-supplied input(s) named exactly `…`** — under
   the task's declared names, in whatever form the engine declares inputs.
6. **Workflow is structurally valid for its engine** — the engine's static
   validation passes (parses, well-formed steps, every reference resolves,
   no unreachable/orphaned steps). Static evidence ONLY: whether the rerun
   completed and what it returned is what the `evaluates: "output"` criteria
   assert, so it is not double-counted here.

Task-specific workflow criteria sit **ahead** of the block and keep their
engine-neutral wording: the multimodal/retrieval/reasoning opener on every
GAIA-derived task, and the authenticated-fetch (file staging) criterion on the
vision/audio/spreadsheet tasks (its Authorization value is "drawn from a named
secret through the engine's secret mechanism"). Output criteria are unchanged.

## Corpus state

- `wfbench/generate-capital-city` — 8 criteria (6 workflow + 2 output):
  - **C-007** (`output`): the run output is a valid capital city — catches
    empty output, error payloads, non-answers.
  - **C-008** (`output`): it is the capital of the **supplied** country —
    a workflow that is merely a random capital-city generator passes C-007
    but fails C-008; ignoring the input is a distinct, visible failure.
  - The deterministic `expected_output: "Cardiff"` comparison (dispatched as
    `rerun_expected_output`) remains as a free, zero-variance supplementary
    signal — out of the roster, out of the denominator.
- `wfbench/create-openai-call` — 7 criteria (6 workflow + 1 output):
  - Declares `workflow_input: { prompt: … }` (previously declared no input —
    without a declared name the rerunner would have nothing to supply and
    execution would be vacuous).
  - **C-005** (`workflow`): the workflow declares and consumes an input named
    exactly `prompt` (shared criterion 5).
  - **C-007** (`output`): the run output is a plausible LLM response to the
    supplied prompt — there is no single correct answer, so this is
    LLM-judged; empty output, error payloads, prompt echoes, and
    unresponsive content fail.
- GAIA-derived tasks (`research`, `reasoning`, `video`: 9 criteria;
  `vision`, `audio`, `spreadsheet`: 10) — one or two task-specific openers,
  the shared six, then two output criteria (direct answer; matches the
  reference answer supplied to the judge out-of-band).

## Implementation notes (Hive side)

- `task-schema.ts`: optional `evaluates: "workflow" | "output"` on
  `criterionSchema` and `WorkflowBenchmarkCriterion`; new invariant
  `checkOutputCriteriaRequireWorkflowInput` (an output criterion on a task
  with no `workflow_input` is unevaluable by construction);
  `criteriaFingerprint` hashes `evaluates` when present (untagged
  fingerprints unchanged; a criterion switching evidence class re-hashes).
  The engine-neutral rewrite changed every task's fingerprint — expected:
  runs scored before and after it are distinguishable by
  `result.hive.criteriaFingerprint`.
- Generator emits the field; `eval-nodes.ts` writes `evaluates` onto each
  EvalRequirement node (defaulting `"workflow"`).
- No dispatch-route change was needed: `criteria` crosses the hop as one
  JSON string and the new field rides along.
- `benchmarks/workflow-editor/__fixtures__/corpus-migration-baseline.json`
  is a migration-acceptance snapshot that `migration-baseline.test.ts`
  deep-equals against the regenerated corpus; slices that mutate corpus data
  re-baseline it in their own commit (the engine-neutral rewrite did), with
  the JSON diff as the change record.

## Stakwork-side contract

The execution stage (launch the produced workflow via Run Trigger 57425 with
the parsed `workflow_input_json` payload, receive the run webhook, hand the
run output to the judge as a second material envelope) exists on the Stakwork
side. The judge must:

- read `evaluates` per criterion and judge `"output"` criteria against the
  run-output envelope, and `"workflow"` criteria against the artifact PLUS the
  run's terminal status (shared criterion 6 asks whether the engine's
  validator passed and the rerun completed);
- report an output criterion as **not evaluated** — never FAIL — when the
  execution itself could not be launched (infra failure), so "ran but the
  output was judged bad" and "never ran" stay distinguishable;
- keep performing the deterministic `rerun_expected_output` comparison as a
  separate reported boolean, outside the criteria verdicts.

## Follow-ups

- Label `evaluates: "output"` criteria in the runs-history per-criterion
  detail view (needs `evaluates` passed through `fetchTaskRubricRoster` /
  `GraphRubric`, which is shared with the legal benchmarks — kept out of this
  change).
- Verification note (previous session): `workflow_input_json` crosses the
  dispatch hop as a single `JSON.stringify` string (`run/route.ts` + pinned
  dispatch-route test). The stale `capital` key once seen in a dispatch
  payload was a Stakwork-side workflow variable, since removed.

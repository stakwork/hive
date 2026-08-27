# Workflow Benchmarks: Run-Output Criteria

The Workflow Editor Benchmark rubrics now judge two kinds of evidence:

- **Workflow criteria** — what the produced workflow JSON contains (all
  pre-existing criteria: provider call present, secret reference well-formed,
  declared input wired into the request, structurally valid, …).
- **Output criteria** — what the workflow actually returns when executed with
  the task's `workflow_input`.

Both kinds live in the **same `criteria` array** — one roster, one
denominator, one score. What distinguishes an output criterion is the
per-criterion `evaluates` field:

- `"workflow"` (the default when absent; all pre-existing criteria) — judged
  against the static workflow JSON.
- `"output"` — judged against the run output of the executed workflow.

The judge reads `evaluates` to pick the evidence per criterion. The field
rides the existing dispatch (`criteria` is `JSON.stringify`'d verbatim) and is
stamped on each EvalRequirement node in the graph roster, so the per-criterion
breakdown can distinguish "structurally perfect but returns garbage" from
"malformed workflow" inside the single score.

## Corpus state

- `wfbench/generate-capital-city` — 11 criteria (9 workflow + 2 output):
  - **C-010** (`output`): the run output is a valid capital city — catches
    empty output, error payloads, non-answers.
  - **C-011** (`output`): it is the capital of the **supplied** country —
    a workflow that is merely a random capital-city generator passes C-010
    but fails C-011; ignoring the input is a distinct, visible failure.
  - The deterministic `expected_output: "Cardiff"` comparison (dispatched as
    `rerun_expected_output`) remains as a free, zero-variance supplementary
    signal — out of the roster, out of the denominator.
- `wfbench/create-openai-call` — 10 criteria (9 workflow + 1 output):
  - Declares `workflow_input: { prompt: … }` (previously declared no input —
    without a declared name the rerunner would have nothing to supply and
    execution would be vacuous).
  - **C-009** (`workflow`): the workflow declares and consumes an input named
    exactly `prompt` (mirrors capital-city's C-008).
  - **C-010** (`output`): the run output is a plausible LLM response to the
    supplied prompt — there is no single correct answer, so this is
    LLM-judged; empty output, error payloads, prompt echoes, and
    unresponsive content fail.

## Implementation notes (Hive side)

- `task-schema.ts`: optional `evaluates: "workflow" | "output"` on
  `criterionSchema` and `WorkflowBenchmarkCriterion`; new invariant
  `checkOutputCriteriaRequireWorkflowInput` (an output criterion on a task
  with no `workflow_input` is unevaluable by construction);
  `criteriaFingerprint` hashes `evaluates` when present (untagged
  fingerprints unchanged; a criterion switching evidence class re-hashes).
- Generator emits the field; `eval-nodes.ts` writes `evaluates` onto each
  EvalRequirement node (defaulting `"workflow"`).
- No dispatch-route change was needed: `criteria` crosses the hop as one
  JSON string and the new field rides along.

## Stakwork-side contract

The execution stage (launch the produced workflow via Run Trigger 57425 with
the parsed `workflow_input_json` payload, receive the run webhook, hand the
run output to the judge as a second material envelope) exists on the Stakwork
side. The judge must:

- read `evaluates` per criterion and judge `"output"` criteria against the
  run-output envelope (and `"workflow"` criteria against the artifact, as
  today);
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

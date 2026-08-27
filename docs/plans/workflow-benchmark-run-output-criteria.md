# Workflow Benchmarks: Run-Output Criteria

Plan for extending the Workflow Editor Benchmark rubrics to judge what the
produced workflow actually **outputs when executed**, not only the static
workflow JSON. Written against the corpus as of `wfbench/generate-capital-city`
(9 criteria) and `wfbench/create-openai-call` (8 criteria), all of which judge
the static artifact.

## Shape of the change

Output criteria are ordinary rubric criteria and live in the **same `criteria`
array** each task already has — the roster simply grows: capital-city moves
from 9 to 10–11 criteria, openai-call from 8 to 9 (plus the Slice 1 static
criterion below). One roster, one denominator, one score.

What distinguishes an output criterion is **which evidence it judges**. Each
criterion gains an `evaluates` field:

- `"workflow"` (the default; all existing criteria) — judged against the
  static workflow JSON, as today.
- `"output"` — judged against what the workflow returned when executed.

The judge uses this field to pick the material envelope per criterion; the UI
uses it to label output criteria in the per-criterion detail view. That label
is what keeps the two failure modes distinguishable inside the single score: a
structurally perfect workflow that returns nothing fails exactly its output
criteria, a malformed one fails workflow criteria — visible in the breakdown.
(If separate headline sub-totals are ever wanted, the tag makes that a
UI-only change.)

## The hard ordering constraint (read first)

Run-output criteria can only be evaluated after the produced workflow is
**executed**, and that stage does not exist yet:

- Stakwork workflow 58313 judges the static workflow JSON. It never runs the
  produced workflow.
- The execution stage — launch the produced workflow via Run Trigger 57425,
  wait on the run webhook, pass the run output to the judge as a **second
  material envelope** — is a separate Stakwork feature that has not been built.
- The harness has, to date, never produced a single completed score even for
  static judging.

Because the new entries sit in the same dispatched-and-rostered array,
**the corpus edit that adds them IS the gated artifact.** The moment it merges,
they are sent to the judge and counted in the denominator. If that happens
before execution exists, every run scores them FAIL — there is no output to
read — a phantom failure indistinguishable from a genuinely bad agent, and the
grown denominator (10–11 / 9) corrupts every score. Slice 3 below therefore
merges only once the execution stage demonstrably works, and never before.

## The criteria being added, per task

- `wfbench/generate-capital-city` — one or two LLM-judged output criteria
  (final count decided at authoring):
  - the run output is a valid capital city (a city name, not an essay, an
    error payload, or an empty string);
  - it is specifically the capital of the supplied country.
- `wfbench/create-openai-call` — one LLM-judged output criterion: the run
  output is a plausible LLM response to the supplied prompt (FAIL: empty
  output, an error/stack-trace payload, a verbatim echo of the prompt, or
  content unresponsive to the prompt). There is no single correct answer, so
  an LLM judge is the right mechanism.

The existing deterministic `expected_output: "Cardiff"` comparison (dispatched
as `rerun_expected_output`) stays as a **supplementary signal** alongside the
judged criteria: it costs nothing, has zero judge variance, and is perfectly
repeatable in a hill climb. It remains out of the roster and out of the
denominator, reported as its own boolean in the execution result.

## Slices

### Slice 0 — verification (done, no code change)

The dispatch contract was confirmed: `run/route.ts` performs the single
`JSON.stringify(task.workflow_input)` at the dispatch hop, and
`dispatch-route.test.ts` pins `typeof vars.workflow_input_json === "string"`
(parsing back to `{ country: "Wales" }`). An observation of
`workflow_input_json` as an object in a dispatch payload was pre-serialisation
logging / a Stakwork-side post-parse view, not a boundary bug. The stale
`capital` key seen alongside it was a Stakwork-side workflow variable, since
removed — nothing in Hive sends it.

### Slice 1 — landable now: declare the `prompt` input on create-openai-call

`create-openai-call` currently declares **no** `workflow_input`. Without a
declared input name the future rerunner has nothing to supply: the agent
invents its own input names, the rerun payload matches nothing, the workflow
"succeeds" vacuously (exactly the failure mode the schema header warns about).
This is a prerequisite for execution but is itself a purely static-side
contract change, judged by the existing static judge — it does not wait for
the gate.

- Add `workflow_input: { "prompt": "<benign sample prompt>" }` to
  `benchmarks/workflow-editor/tasks/llm/create-openai-call/task.json`; the
  generator injects the INPUT block into `instructions`.
- Add one static criterion (C-009, `evaluates: "workflow"`) mirroring
  capital-city's C-008: the workflow declares and consumes a caller-supplied
  input named exactly `prompt` (also satisfies
  `checkInputKeysReferencedInCriteria`).
- This moves the static denominator 8 → 9. Intended and visible;
  `criteriaFingerprint` records the rubric change per run.

### Slice 2 — landable now: schema support for `evaluates`

Pure plumbing, no new criteria — safe ahead of the gate because tagging
existing criteria changes nothing about how they are judged:

- `task-schema.ts`: optional `evaluates: "workflow" | "output"` on
  `criterionSchema` (absent ⇒ `"workflow"`); mirrored on the emitted
  `WorkflowBenchmarkCriterion` interface and covered by the compile-time
  shape assertion.
- Generator passes it through; `criteriaFingerprint` includes it (a criterion
  switching evidence class is a rubric change and must change the
  fingerprint).
- `eval-nodes.ts` writes it onto each EvalRequirement node (as e.g.
  `evaluates: "output"`), and the rubrics route returns it, so the client can
  label output criteria in the detail view.
- Invariant: a task may declare `evaluates: "output"` criteria only if it
  declares `workflow_input` (an output criterion with nothing to execute
  against is unevaluable by construction).

### Slice 3 — GATED on the Stakwork execution stage: author the output criteria

**Gate:** does not merge until the Stakwork side demonstrably works
end-to-end — the produced workflow is launched via Run Trigger 57425, the run
webhook fires, and the judge reads the run output as a second material
envelope and returns verdicts for `evaluates: "output"` criteria. Acceptance
evidence: at least one completed run per corpus task with both envelopes
populated and output-criterion verdicts present. Given the harness has never
yet produced even a completed static score, this gate is not a formality.

When the gate opens, the slice is almost entirely corpus authoring:

- Add the output criteria listed above to the two task.json files
  (`evaluates: "output"`, ids continuing the existing C-sequence), regenerate.
  Dispatch and roster pick them up through the existing paths — denominators
  move to 10–11 and 9 (10 with Slice 1) atomically with the ability to score
  them.
- Result storage: the execution facts that are not roster criteria land in
  their own namespaced envelope on the run row (e.g. `result.execution =
  { runOutcome, outputMatch }`): did the produced workflow execute to
  completion, and the deterministic `expected_output` comparison. A run where
  execution never launched (infra failure) must be distinguishable from
  "execution ran and the output was judged bad" — the former shows the
  output criteria as not-evaluated, never FAIL.
- UI: label `evaluates: "output"` criteria in the expanded per-criterion
  view; show `runOutcome` / `outputMatch` alongside the score.

## Out-of-repo dependencies (Stakwork side)

- Run Trigger 57425 launching the produced workflow with the parsed
  `workflow_input_json` payload.
- Run-completion webhook carrying the run output.
- Judge (58313 or successor) reading `evaluates` per criterion, judging
  `"output"` criteria against the run-output envelope, performing the
  deterministic `rerun_expected_output` comparison, and reporting the
  execution facts under the separate keys named above.

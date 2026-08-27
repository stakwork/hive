# Workflow Benchmarks: Run-Output Criteria

Plan for extending the Workflow Editor Benchmark rubrics to judge what the
produced workflow actually **outputs when executed**, not only the static
workflow JSON. Written against the corpus as of `wfbench/generate-capital-city`
(9 criteria) and `wfbench/create-openai-call` (8 criteria), all of which judge
the static artifact.

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

**Therefore: no output criterion may enter the judged roster (the dispatched
`criteria` var or the graph EvalRequirement roster) before the execution stage
exists.** If one does, every run scores it FAIL — there is no output to read —
which is a phantom failure indistinguishable from a genuinely bad agent, and it
corrupts the score denominator via the EvalRequirement roster. Slice 3 below is
gated on the execution stage and must not merge ahead of it.

## What is being added, per task

- `wfbench/create-openai-call` — one **LLM-judged** output criterion: the run
  output is a plausible LLM response to the supplied prompt. There is no single
  correct answer, so an LLM judge is the right mechanism here.
- `wfbench/generate-capital-city` — **no judge criterion for the output.** The
  correct-answer check ("is the output Cardiff?") stays on the existing
  `expected_output: "Cardiff"` mechanism: a deterministic string comparison at
  rerun time (already dispatched as the `rerun_expected_output` var). Zero
  judge variance, zero cost, perfectly repeatable in a hill climb. It stays
  **out of the criteria roster** so it neither inflates the denominator nor
  mixes a deterministic assertion into LLM-judged output.

Rule of thumb going forward: where a single right answer exists, use
`expected_output` (deterministic, out of roster). Spend an LLM-judged output
criterion only where the output is genuinely open-ended.

## How results are reported — two ledgers, never one number

A workflow that is structurally perfect but returns nothing is a **different
failure** from one that is malformed; the benchmark exists to tell them apart.
Static and execution results therefore stay separately visible end to end and
are never blended into a combined score:

- **Static score** — unchanged: passed `C-*` over the graph-first roster
  denominator (`computeBenchmarkScore` against the EvalSet's `C-*`
  EvalRequirements).
- **Execution result** — its own envelope with three independent facts:
  1. **Run outcome** — did the produced workflow execute to completion at all.
  2. **Deterministic output match** — where the task declares
     `expected_output`, a single boolean (capital-city: output == "Cardiff").
     Not an EvalRequirement, not in any denominator.
  3. **Output-criteria score** — where the task declares output criteria,
     passed `O-*` over the `O-*` roster only (openai-call: 0..1 of 1).
- **UI** (`WorkflowBenchmarkRunsHistory`): the score cell shows the two
  ledgers side by side (e.g. `Static 8/9 · Exec ✓`); the expanded row
  partitions per-criterion detail under Static / Execution headings. Runs
  that pre-date the execution stage, and runs where execution never launched
  (infra failure), show **"Execution: not run"** — a dash, never a FAIL.
  "Execution ran and the output was judged bad" and "execution never
  happened" are distinct states and must render distinctly.

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
- Add one static criterion (C-009) mirroring capital-city's C-008: the
  workflow declares and consumes a caller-supplied input named exactly
  `prompt` (also satisfies `checkInputKeysReferencedInCriteria`).
- This moves the static denominator 8 → 9. Intended and visible;
  `criteriaFingerprint` records the rubric change per run.

### Slice 2 — landable now, deliberately inert: `output_criteria` in the corpus schema

Add run-output criteria to the corpus as a **separate field**, not as tagged
entries in `criteria`. Separation by field makes the gate structural: every
existing reader of `task.criteria` (the dispatched `criteria` var, the
EvalRequirement upsert, `criteriaFingerprint`, the mock roster) is untouched
by construction — there is no flag check to forget.

- `task-schema.ts`: optional `output_criteria` array, same criterion shape,
  ids `O-00N`. Invariants: id uniqueness across both arrays, non-empty
  `match_criteria`, `C-`/`O-` prefixes segregated per array.
- Generator emits it into the index (client-safe — criteria carry no answers).
- Author the one real entry — create-openai-call `O-001`: "Run output is a
  plausible LLM response to the supplied prompt" (FAIL: empty output, an
  error/stack-trace payload, a verbatim echo of the prompt, or content
  unresponsive to the prompt). generate-capital-city gets none (see above).
- **Inertness is pinned by tests**, in the style of the existing
  "no `workflow_input_json` key on no-input tasks" test: for a task with
  `output_criteria`, the dispatched vars contain no output-criteria key, and
  the roster upsert payload contains only `C-*` ids.

### Slice 3 — GATED on the Stakwork execution stage: wire output criteria live

**Gate:** does not merge until the Stakwork side demonstrably works
end-to-end — the produced workflow is launched via Run Trigger 57425, the run
webhook fires, and the judge accepts the run output as a second material
envelope and returns per-output-criterion verdicts. Acceptance evidence: at
least one completed run per corpus task with **both** envelopes populated.
Given the harness has never yet produced even a completed static score, this
gate is not a formality.

When the gate opens:

- **Dispatch** (`run/route.ts`): send `output_criteria` as its own JSON-string
  var, a sibling of `criteria` — never merged into it. Same
  stringify-at-the-hop rule as `workflow_input_json`; extend the
  dispatch-boundary log with the output-criteria count.
- **Roster** (`eval-nodes.ts`): upsert `O-*` EvalRequirements namespaced
  `${taskSlug}::O-001` with a `stage: "execution"` attribute; the rubrics
  route returns the stage so the client partitions the roster. Static
  denominator = `C-*` only; execution denominator = `O-*` only.
- **Result storage**: execution results land in their own namespaced envelope
  on the run row (e.g. `result.execution = { runOutcome, outputMatch?,
  outputCriteria? }`) — never folded into `n_passed` or any static field.
  The deterministic `expected_output` comparison arrives here as the
  `outputMatch` boolean.
- **Provenance**: add a separate `outputCriteriaFingerprint` alongside
  `criteriaFingerprint` so the static fingerprint stays comparable across the
  gate.
- **UI**: the two-ledger rendering described above.

## Out-of-repo dependencies (Stakwork side)

- Run Trigger 57425 launching the produced workflow with the parsed
  `workflow_input_json` payload.
- Run-completion webhook carrying the run output.
- Judge (58313 or successor) accepting the run output as a second material
  envelope, evaluating `O-*` criteria against it, and performing the
  deterministic `rerun_expected_output` comparison, reporting each in the
  result payload under the separate keys named above.

# Evals: a registered, generic eval tab on strut workflows

Status: plan, not started. Written 2026-09-27.

## Problem

Legal Benchmarks (`/w/openlaw/legal/benchmarks`) is a good UI, but it is
welded to one workflow. Its task corpus is a generated TypeScript file, its
result shape is a hand-written type (`BenchmarkRunResult`), and the sidebar
entry is gated on a slug list (`LEGAL_SLUGS`). A second domain, such as
openfinance, would need all of it rebuilt.

Strut already has a domain-neutral vocabulary for the same thing:

| Eval concept | Strut node | Harvey example |
| --- | --- | --- |
| What we assert | `Claim` | "Every rubric criterion for the task passes" |
| The judge | `Check` (a whole workflow, `step_type: subflow`) | the scoring workflow |
| One judge run | `Evidence` | "79 of 80 criteria passed" on one task |

The judge IS the Check. Evidence IS a judge run. This plan builds the Hive
tab on that, for any workspace and any strut workflow.

## Ownership

**Hive owns what to run. Strut owns the judging and the proof.**

| Hive Postgres | Strut |
| --- | --- |
| Which workflows are evals for which workspace | Claims and checks on the workflow |
| Cases (saved inputs, grouped) | Running the workflow |
| Launches, and the verdict each one received | Running the judge, writing Evidence, saving the judge run |

Hive never writes claims or checks itself. Changes to strut go through the
strut assistant, or through a `claims:` block in a seeded workflow's YAML.

The case dimension lives only in Hive. The strut run id joins a case to its
Evidence, so strut needs no concept of a case.

## Flow

1. **Register.** An admin picks a strut workflow and names the eval. Hive
   stores one row. The sidebar shows one tab per row under "Evals".
2. **Contract.** The tab shows the workflow's claims and checks, read live
   from strut (`GET /claims?kind=workflow&name=…`). If there is no claim
   with a run check, the tab says so and links to the strut assistant.
3. **Cases.** Each eval has cases: a title, a group path, and a saved input.
4. **Run.** Hive launches the workflow with a case's input (or an ad hoc
   input) through `dispatchStrutRun`, asking for a verdict callback.
5. **Judge.** Strut's verify pass runs the judge after the run settles and
   writes the Evidence.
6. **Hear back.** Strut posts `verify.end` to the same callback URL. Hive
   stores the verdict and the judge's output on the eval run row.
7. **Show.** The tab reads only Postgres. The list shows verdict and measure
   per run. The detail renders the judge's output.

## The judge output contract

Strut already requires a check to return `supports` and `content`. Two
optional fields extend that shape. Strut ignores them. Hive renders them.

```json
{
  "supports": false,
  "content": "79 of 80 criteria passed",
  "measure": { "kind": "ratio", "value": 79, "of": 80, "label": "criteria" },
  "rows": [
    {
      "id": "C-012",
      "label": "Governing law clause",
      "supports": true,
      "content": "Found in section 12",
      "group": "Boilerplate",
      "locator": { "path": "draft.docx" }
    }
  ]
}
```

- `measure.kind`: `ratio` (`value`, `of`), `score` (`value`, optional `min`,
  `max`, `higherIsBetter`). No `measure` means a plain pass or fail.
- `rows[].supports`: `true`, `false`, or `null` for "not evaluated".
- Anything else in the output is shown in a collapsible raw view.

A judge that returns only the two required fields still renders: a badge
and a sentence. There is no per-eval UI code and no per-eval view config.

## Strut changes

| # | Change | Notes |
| --- | --- | --- |
| S1 | Verdict callback | Opt in at launch: `callback: { url, verify: true }`. The 202 answers `verify: true` when the claims layer is on. Strut holds the URL until the verify pass settles, then POSTs `verify.end`. Hooks into the existing `onSettled` in `createVerifier`. |
| S2 | Pull parity | `POST /workflows/:name/runs/:runId/verify` returns the same `checks[]` body, so Hive's reconcile can pull a missed verdict. |
| S3 | Keep the judge run when it says more than Evidence can hold | Today a check run is saved only when it reported cost. Also save it when its output has fields beyond the verdict. Needed for S2 to return `output` after the fact. |
| S4 | Teach the assistant the contract | Prompt and `AGENTS.md`: a judge ends in a step that emits `supports`, `content`, and where useful `measure` and `rows`; eval checks use `policy: always`. |

`verify.end` body:

```json
{
  "event": "verify.end",
  "workflow": "harvey-produce",
  "runId": "1790179200000",
  "version": "<workflow content hash>",
  "costUsd": 2.31,
  "checks": [
    {
      "claim": { "id": "…", "text": "…" },
      "check": { "id": "…", "name": "harvey-judge" },
      "result": "ran",
      "supports": false,
      "content": "79 of 80 criteria passed",
      "evidenceId": "…",
      "judgeRun": { "key": "check:<id>", "runId": "…" },
      "output": { "…": "the judge's full output" }
    },
    { "claim": { "…": "…" }, "check": { "…": "…" }, "result": "skipped", "reason": "budget" }
  ]
}
```

It is sent even when nothing fired, so Hive can close the row with a reason
instead of waiting. `output` is omitted above a size cap, and `judgeRun`
is then the way to fetch it.

Already done: the default verify budget caps were raised to $10 per run and
$100 per workflow per day (stakwork/strut#68, merged).

## Hive changes

### Data model

Names carry the `WorkspaceEval` prefix to stay clear of the older graph
eval chain (`EvalSet`, `evalSetId`).

```prisma
model WorkspaceEval {
  id          String    @id @default(cuid())
  workspaceId String    @map("workspace_id")
  slug        String
  name        String
  description String?
  /// Strut workflow name: the subject of the claims.
  workflow    String
  position    Int       @default(0)
  createdById String    @map("created_by_id")
  archivedAt  DateTime? @map("archived_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  workspace Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  cases     WorkspaceEvalCase[]
  runs      WorkspaceEvalRun[]

  @@unique([workspaceId, slug])
  @@map("workspace_evals")
}

model WorkspaceEvalCase {
  id     String   @id @default(cuid())
  evalId String   @map("eval_id")
  /// Stable external key, e.g. a Harvey task slug.
  key    String
  title  String
  /// Grouping path, e.g. "contracts / banking".
  group  String?
  tags   String[]
  input  Json

  eval WorkspaceEval      @relation(fields: [evalId], references: [id], onDelete: Cascade)
  runs WorkspaceEvalRun[]

  @@unique([evalId, key])
  @@index([evalId, group])
  @@map("workspace_eval_cases")
}

enum WorkspaceEvalRunStatus {
  RUNNING
  JUDGING
  JUDGED
  NOT_JUDGED
  FAILED
  CANCELLED
  LOST
}

enum WorkspaceEvalVerdict {
  SUPPORTED
  REFUTED
}

model WorkspaceEvalRun {
  id              String                 @id @default(cuid())
  evalId          String                 @map("eval_id")
  caseId          String?                @map("case_id")
  /// `StrutRun.id`: the generic launch row (no FK, like StrutRun itself).
  strutRunRowId   String                 @unique @map("strut_run_row_id")
  userId          String                 @map("user_id")
  status          WorkspaceEvalRunStatus @default(RUNNING)
  verdict         WorkspaceEvalVerdict?
  notJudgedReason String?                @map("not_judged_reason")
  /// Evidence.content of the deciding check.
  summary         String?                @db.Text
  measure         Json?
  /// The `checks[]` array from `verify.end`, verbatim.
  checks          Json?
  workflowVersion String?                @map("workflow_version")
  judgeCostUsd    Float?                 @map("judge_cost_usd")
  judgedAt        DateTime?              @map("judged_at")
  createdAt       DateTime               @default(now()) @map("created_at")
  updatedAt       DateTime               @updatedAt @map("updated_at")

  eval WorkspaceEval      @relation(fields: [evalId], references: [id], onDelete: Cascade)
  case WorkspaceEvalCase? @relation(fields: [caseId], references: [id], onDelete: SetNull)

  @@index([evalId, createdAt])
  @@index([caseId, createdAt])
  @@index([status, createdAt])
  @@map("workspace_eval_runs")
}
```

Verdict over several checks follows strut's rule: any refutation wins, else
supported if at least one check supports, else `NOT_JUDGED`.

Create the migration with `npx prisma migrate dev --name workspace_evals`.

### Services (`src/services/workspace-evals/`)

| File | Job |
| --- | --- |
| `registry.ts` | CRUD for evals and cases. Register and edit need ADMIN or above. |
| `launch.ts` | Create the eval run row, then `dispatchStrutRun({ kind: "eval", purpose: "benchmark", … })` with `verify: true` on the callback. |
| `verdict.ts` | Pure reducer from a `verify.end` body to row fields. Idempotent apply. Pusher broadcast. |
| `reconcile.ts` | Rows in `JUDGING` past a threshold: call strut's verify route, apply the same body. Give up as `NOT_JUDGED` with reason `lost`. |
| `strut-client.ts` | Read-only calls to the workspace's lab: workflow list, workflow `input:` schema, claims for a workflow. |

Add `eval` to `HANDLERS` in `src/services/strut-runs.ts`
(`src/services/strut-runs/eval.ts`): on `run.end` move the row to `JUDGING`,
or to `FAILED`, `CANCELLED` or `LOST`.

### Webhook

`src/app/api/strut-runs/webhook/route.ts` rejects any event other than
`run.end` with a 400 today. Accept `verify.end` for rows of kind `eval`:
same token check, then `applyVerdict`. A replay is a 200.

Extend the existing strut reconcile cron to call `reconcile.ts`. The judging
threshold must be long, since a judge pass can run for tens of minutes.

### API routes (`/api/workspaces/[slug]/evals/…`)

| Route | Methods |
| --- | --- |
| `/evals` | GET list, POST register |
| `/evals/workflows` | GET strut workflows, for the register picker |
| `/evals/[evalSlug]` | GET, PATCH, DELETE |
| `/evals/[evalSlug]/contract` | GET claims and checks, live from strut |
| `/evals/[evalSlug]/cases` | GET, POST (single or bulk upsert by `key`) |
| `/evals/[evalSlug]/runs` | GET list, POST launch |
| `/evals/[evalSlug]/runs/[runId]` | GET detail, DELETE cancel |

### UI

- **Sidebar.** An "Evals" section built from `useWorkspaceEvals()`. No slug
  gating. Hidden when the workspace has no evals and the user cannot
  register one.
- **Pages.** `/w/[slug]/evals/[evalSlug]` with tabs Cases, Runs, Contract.
  `/w/[slug]/evals/[evalSlug]/runs/[runId]` for one run.
- **Components** in `src/components/workspace-evals/`, each a directory with
  `index.tsx`:

| Component | Renders |
| --- | --- |
| `VerdictBadge` | supported, refuted, judging, not judged with its reason |
| `MeasurePill` | `ratio` and `score` measures |
| `RowsLedger` | `rows`, grouped, with verdict and content |
| `JudgeOutputView` | the rest of the output as a collapsible tree |
| `CaseCatalogue` | cases grouped by `group`, search, run button |
| `RunInputForm` | a form generated from the workflow's `input:` block |
| `RunsTable` | runs with verdict, measure, version, cost, who, when |
| `ContractPanel` | claims and their checks |
| `RegisterEvalDialog` | workflow picker, name |

Add `data-testid` attributes and selectors as components are built.

### Tests

- Unit: the verdict reducer, measure and rows parsing with malformed input.
- Integration: launch, `run.end`, `verify.end`, replay, reconcile.
- Mock strut endpoints under `/api/mock` for local development.

## Harvey port (stakgraph lab)

Blocker found and resolved: checks written by the strut assistant are
stamped `ai`, and strut refuses an `ai` check whose judge reaches
`harvey/*` or `eval/*` steps. The Harvey judge does. A `claims:` block in a
seeded workflow's YAML is stamped `yaml`, because the Harvey seeder
publishes unstamped, so the deny-list does not apply.

1. New `harvey-judge` workflow: runs the existing scoring workflow, then a
   final `pack` step that emits the contract shape, with a `ratio` measure
   and `rows` built from `criteria_results`.
2. `claims:` block on `harvey-produce.yaml`, with one `subflow` check naming
   `harvey-judge`, `policy: always`, and the input mapped from the subject
   (`{{ input.input.task }}`, `{{ input.output.outputDir }}`).
3. Bump the lab's pinned strut commit.
4. Generic import script in Hive: a JSON file of cases, upserted by `key`.
   Harvey tasks become cases with `input: { task: <slug> }` and the practice
   area as `group`.

Legal Benchmarks stays untouched until the generic tab matches it.

## Phases and deploy order

| Phase | Scope | Repo |
| --- | --- | --- |
| 1 | S1 to S4 | strut |
| 2 | Tables, launch, webhook, reconcile, the tab with Runs, Cases, Contract | hive |
| 3 | Harvey port and case import | stakgraph, hive |
| 4 | Roll-ups: pass rate by group, by workflow version, and over the Concept tree | hive, strut |

Hive phase 2 can ship before the lab picks up phase 1. The verdict callback
is opt in, and the run simply stays in `JUDGING` until reconcile closes it.

First client for phase 2: an openfinance workflow with a judge written by
the strut assistant. It must not be ratio shaped, to prove the contract is
not Harvey shaped.

## Verified in code

| Fact | Where |
| --- | --- |
| A check can be a whole workflow, run after every top-level run | strut `src/verify.ts` |
| Evidence is always written when the check returns a verdict | strut `src/verify.ts`, `verifyOne` |
| The `llm` step reports cost | strut `src/steps/core/llm.ts` |
| Paid checks default to `on_change`, so evals must set `always` | strut `src/claims-authoring.ts` |
| The run callback fires before the verify pass starts | strut `src/createStrut.ts` |
| The verify pass has a settle hook | strut `src/createStrut.ts`, `onSettled` |
| The deny-list applies only to `ai` stamped checks | strut `src/claims-authoring.ts`, `src/verify.ts` |
| Harvey workflows are seeded unstamped | stakgraph `mcp/src/lab/harvey/seed.ts` |
| The lab's pinned strut includes the claims layer | stakgraph `mcp/package.json` |
| The `benchmark` purpose targets the workspace's own swarm | hive `src/services/strut-target.ts` |

## Not verified

- Reading a saved judge run over HTTP. It is stored under the key
  `check:<id>`. The run store maps it, but nothing reads one back today.
- Whether the verify pass fires on a cancelled run.
- The verify pass is in memory. A strut restart mid-judge loses the verdict.
  Reconcile covers it, which is why S2 and S3 matter.

## Out of scope for the first version

- Runs started outside Hive do not appear in the tab.
- Evidence history read from the graph. Hive's own rows are the history.
- Recursion, fix chains, proposed fixes. These map to strut's evolve loop.
- Concept tree roll-up. Needs criteria tagged with Concepts, and claims
  about Concept nodes, which strut's tools do not accept yet.

## Assumptions to confirm

1. Measure kinds start as `ratio` and `score`, with plain pass or fail as
   the default.
2. Registering an eval needs ADMIN or above.

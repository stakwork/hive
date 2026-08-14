# Run-Report Bundle Contract

**Source:** `tomsmith8/harvey-run-report`
**Reference files:** `parse_project.py`, `parse_logs.py`, `analyze.py`, `build_report.py`
**Contract recorded:** 2026-08-11
**Note:** This is a hand-authored representation of the contract derived from reading the
reference repo's source. A real generated bundle should be vendored here to replace or
supplement this record once the Python toolchain is available.

---

## Bundle Root Shape

```
{
  schema_version: number,       // e.g. 1
  page_data:      { ... },      // see page_data keys below
  analysis:       { ... },      // see analysis keys below
  concepts:       {} | { ... }, // see concepts shape below
  source_docs:    [...],        // HTML source documents (bundle-root sibling, NOT page_data)
  workfiles:      [...],        // plain-text scratch files (bundle-root sibling, NOT page_data)
  rubric_links:   { ... },      // rubric_id → [{doc, tokens}] map (bundle-root sibling, NOT page_data)
}
```

### CRITICAL DISTINCTION: bundle-root siblings vs. page_data keys

The following keys live at the **bundle root** as siblings of `page_data`. They are
**NOT** part of the `page_data` object and are **NOT** enumerated in the `page_data`
key list below:

- `source_docs` — array of `{id, title, html}` objects carrying converted document HTML
- `workfiles` — array of `{name, text}` plain-text scratch files
- `rubric_links` — record mapping rubric IDs to `[{doc, tokens}]` arrays
- `analysis` — object with `summaries[]` and `traces[]`
- `concepts` — either `{}` (concepts pass not run) or the full synthesis object

This distinction matters because `sanitize.ts`, `sanitize-schema.ts`,
`derive.ts` (`flattenText`/`findHighlightRanges`), and `DocumentViewerModal.tsx`
all depend on `source_docs[].html` + `rubric_links` continuing to exist at the
bundle root. They are **NOT being removed** by the realignment.

---

## `page_data` Keys

Produced by both `parse_project.py` and `parse_logs.py` (identical top-level shape).
There is **no** `page_data.set_var` — `set_var` (`sv`) is only an internal parser
variable, never emitted into the bundle.

| Key             | Type                        | Description |
|-----------------|-----------------------------|-------------|
| `config`        | `object`                    | Run configuration: `task_slug, task_goal, deliverable, run_id, workspace_id, graph_base_url, models: {...}, flags: {...}` |
| `score`         | `object`                    | Judge scoring: `score, max_score, all_pass, n_criteria, n_passed, judge_model, scored_at` |
| `rubrics`       | `array`                     | Per-criterion results: `[{id, title, match_criteria, verdict, reasoning}]` |
| `timeline`      | `array`                     | Step timing: `[{step, start, end, duration_s}]` — `start`/`end` are UTC strings in space-separated form `"YYYY-MM-DD HH:MM:SS.mmm"` or ISO8601 |
| `agents`        | `array`                     | Per-agent metadata (no raw `messages`): `[{name, step, start, end, duration_s, n_messages, tools, final_answer, agent_label, transcript_truncated}]` |
| `documents`     | `array`                     | Document metadata (NOT HTML bodies): `[{file, project_id, strategy, ref_id, already_exists, start, end}]` |
| `branches`      | `string[]`                  | **Plain strings**, e.g. `"{alias} - then: {stmt}, else: {else}"` or `"NOTE: ..."`. NOT objects. |
| `health_notes`  | `string[]`                  | **Plain strings** describing run health observations. NOT objects. |
| `wall_clock_min`| `number`                    | Total wall-clock duration in minutes |
| `log_stats`     | `object`                    | Log processing stats: `{total_lines, untagged_lines, projects, noise_projects, transcripts_truncated, n_transcripts}` |
| `security`      | `array`                     | **Array** of finding objects: `[{kind, where, count, severity, detail}]`. NOT a plain object. |
| `outputs`       | `object`                    | Arbitrary output key-value record |

---

## `analysis` Keys (bundle root, not page_data)

### `analysis.summaries[]` — `SUMMARY_SCHEMA` from `analyze.py`

Per-agent transcript summaries. **Not rubric-verdict shaped** — these are agent
activity summaries, not rubric pass/fail results.

```
{
  agent_name: string,
  mission: string,
  tools: [{name, count, purpose}],
  files_touched: [{path, action, note}],
  context_gathered: string,
  key_findings: string[],
  anomalies: string[],
  failed_rubric_relevance: [{rubric_id, note}],
}
```

### `analysis.traces[]` — `TRACE_SCHEMA` from `analyze.py`

Per-rubric failure traces. Each trace has a `rubric_id` that matches a `page_data.rubrics[].id`.

```
{
  rubric_id: string,
  pathway: [{station, status, evidence}],
  q_ingested_to_graph:   {answer, evidence},
  q_knowable_or_derived: {answer, evidence},
  q_draft_got_it:        {answer, evidence},
  q_verify_got_it:       {answer, evidence},
  root_cause: string,
  classification: string,
  fix_suggestions: string[],
}
```

---

## `concepts` Shape (bundle root, not page_data)

Either `{}` (concepts pass not run — the common/default case) or:

```
{
  per_agent: [...],
  synthesis: {
    overall_narrative: string,
    concept_matrix: [{concept, agents[], verdict, note}],
    relation_to_failures: [{rubric_id, finding}],
    recommendations: string[],
  }
}
```

---

## Timestamp Forms

The generator emits timestamps in two forms:
1. Space-separated UTC: `"YYYY-MM-DD HH:MM:SS.mmm"` — no timezone indicator, always UTC
2. True ISO8601 with offset: `"YYYY-MM-DDTHH:MM:SS.mmm+00:00"` — explicit UTC

Both forms appear in real bundles; `toEpochMs` in `derive.ts` handles both.

---

## Deviation Notes

None recorded. Contract aligns with reading of `tomsmith8/harvey-run-report` source.

---

## `concepts.tool_activity` Shape (PROVISIONAL — UNCONFIRMED)

**Status: INFERRED.** Field names below are derived from architecture docs and
fixture design, not from a real generated bundle. The upstream contract is not
yet finalized. The normalizer in `src/lib/run-report/tool-activity.ts` resolves
fields via candidate-key lists so a producer rename requires only one fixture
edit and zero test edits.

When present, `concepts.tool_activity` is an **array** of per-tool-call records.
Each record carries:

```
{
  // Which agent made the call — resolved from first of:
  agent_name: string,   // or: agentName
  agent: string,

  // Tool name — resolved from first of:
  tool_name: string,    // or: toolName, tool, name
  
  // Input to the tool — accepted as object OR scalar string (wrapped as { value }):
  input: object | string,   // or: inputs, args, arguments, params

  // Returned nodes — resolved from first of:
  nodes: NodeRecord[],  // or: results, output_nodes, outputNodes
                        // or nested: result.nodes, output.nodes
  
  // Optional producer-reported error:
  error?: boolean | "error" | "fail",  // or: is_error, failed, status

  // Optional ordering key (used when present+numeric on ALL records):
  seq?: number,   // or: sequence, order, index
}
```

### `NodeRecord` shape (within `nodes[]`):

```
{
  // Identity — resolved from first of:
  ref_id: string,   // or: refId, urn, node_id, nodeId, id
  
  // Display:
  name?: string,
  node_type?: string,   // or: nodeType, type
  
  // Content (marks node as "retrieved" not just "surfaced"):
  properties?: object,  // or: body, content, text, snippet
  
  // Any other fields passed through
}
```

### Candidate keys accepted by the normalizer

The normalizer accepts `tool_activity`, `toolActivity`, `tool_calls`, or
`toolCalls` as the container key. All are equivalent; first present wins.

### Tool classification (`TOOL_CLASS` in `tool-activity.ts`)

Verified against `src/lib/ai/graphWalkerTools.ts`:
- `graph_search` → surfacing
- `graph_get` → retrieval
- `graph_neighbors` → retrieval
- `graph_ontology` → none

Inferred (harness-side, review on first real bundle):
- `graph_node` → retrieval (presumed legacy name for graph_get)
- `get_ontology` → none
- `get_ontology_type` → none

---

## `concepts.node_identities` Shape (PROVISIONAL / UNCONFIRMED)

**Status: PROVISIONAL / UNCONFIRMED** — None of `node_identities`, `top_concepts`,
`has_content` is a confirmed producer contract. The producer is a workflow Script step
whose current output sets `graph_activity_json` verbatim onto `concepts.tool_activity`;
no generated bundle carrying these fields has been observed. Do not treat anything in
this section as settled fact. Revisit and remove the PROVISIONAL marker when a real
bundle is available.

### Row contract that Hive requires

When present, `concepts.node_identities` is an **array** of pre-derived identity rows.
Any row that fails the following contract causes the **entire bundle** to be rejected
back to local derivation (no per-row salvage, no merging of bundle and derived rows):

```
{
  // REQUIRED — identity value (string, non-empty)
  identity: string,

  // REQUIRED — must be one of "ref_id" | "urn" | "id" (supplied by producer,
  // NOT inferred from the identity string).
  // A "urn:"-prefixed identity with identity_kind !== "urn" is malformed.
  // A "ref_id" identity must not contain slashes or control characters
  // (security: this value becomes a path segment in authenticated graph fetches).
  identity_kind: "ref_id" | "urn" | "id",

  // Optional display fields
  name: string | null,
  node_type: string | null,

  // REQUIRED — run-wide retrieval status
  run_status: "retrieved" | "surfaced",

  // REQUIRED when run_status === "retrieved"; null/absent when "surfaced"
  run_basis: "content" | "input" | "tool-class" | null,

  // REQUIRED — array of per-agent attribution entries; MUST NOT be empty.
  // A retrieved run_status requires ≥1 agent entry with status === "retrieved".
  agents: Array<{
    agentKey: string,        // normalized (lowercased) agent key
    count: number,           // number of observations for this agent
    status: "retrieved" | "surfaced",
    basis: "content" | "input" | "tool-class",
  }>,
}
```

### Candidate container keys

Hive accepts `node_identities` or `nodeIdentities` as the container key.

### Validation rules (each causes whole-bundle fallback to local derivation)

| Rejection reason | Trigger |
|-----------------|---------|
| `absent` | Container key not present in `concepts` |
| `malformed-shape` | Container value is not an array, or is empty |
| `unresolvable-identity-kind` | `identity_kind` missing, not a recognized enum value, or a `urn:`-prefixed identity declared as non-`urn` |
| `inconsistent-status` | `run_basis` non-null when `run_status === "surfaced"`, or null when `run_status === "retrieved"`, or `retrieved` status with no agent having `status === "retrieved"` |
| `missing-agents` | `agents[]` missing, empty, or containing malformed entries |
| `key-collision` | Two rows share the same canonical key after `mergeIdentityRows` (not a URN/bare-id pair) |
| `cap-divergence` | Any Hive cap was hit for this bundle (`truncated.callsPerAgent` or `truncated.nodesPerCall` non-zero, or row count exceeds projection array cap) |

### `has_content` field (PROVISIONAL / UNCONFIRMED)

**Status: PROVISIONAL / UNCONFIRMED** — field name and semantics are unconfirmed.

When a node record in `tool_activity` carries `has_content` (or `hasContent`) as a
**boolean** field, Hive uses it as an explicit override for the content-presence rule:

- `true` → node is treated as having content (→ `retrievalBasis: "content"`)
- `false` → node is treated as **NOT** having content; short-circuits the
  existing `CONTENT_KEYS` presence rule (which would otherwise misread `false`
  as content-present since any non-null non-empty value passes the rule)
- absent or non-boolean → existing `CONTENT_KEYS` behaviour, byte-for-byte unchanged

The tri-state reader (`readContentFlag`) is intentionally strict — any non-boolean
value (including strings `"true"`, `"false"`, numbers) falls through to the existing
behaviour unchanged.

`has_content` must NOT be added to `CONTENT_KEYS`. Routing it through `hasContentField`
would misclassify an explicit `false` as content-present.

### `concepts.top_concepts` Shape (PROVISIONAL / UNCONFIRMED)

When present, `concepts.top_concepts` is compared against Hive's locally-derived
concept list. Only the **set of `(node_type, name)` keys** is compared — ordering,
totals, and slice length are ignored. A set-membership difference sets
`topConceptsMismatch: true` on the projection, which renders as a viewer-visible
diagnostics signal.

Accepted container keys: `top_concepts` or `topConcepts`.

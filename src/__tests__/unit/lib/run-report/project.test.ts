import { describe, it, expect } from "vitest";
import { projectBundle, MAX_PROJECTION_BYTES } from "@/lib/run-report/project";
import { RUN_REPORT_FIXTURES } from "@/app/api/mock/run-report/fixtures";

function project(fixture: unknown) {
  return projectBundle(JSON.stringify(fixture));
}

function ok(fixture: unknown) {
  const outcome = project(fixture);
  if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
  return outcome;
}

describe("projectBundle — schema version gate", () => {
  it("accepts schema_version 1", () => {
    expect(project(RUN_REPORT_FIXTURES.full).status).toBe("ok");
  });

  it("routes an unknown schema_version to the unsupported state", () => {
    const outcome = project(RUN_REPORT_FIXTURES["unknown-schema"]);
    expect(outcome.status).toBe("unsupported_schema");
    expect(outcome.status === "unsupported_schema" && outcome.version).toBe(99);
  });

  it("defaults a missing schema_version to 1 rather than failing", () => {
    const { schema_version, ...rest } = RUN_REPORT_FIXTURES.full as Record<string, unknown>;
    void schema_version;
    expect(project(rest).status).toBe("ok");
  });

  it("reports unparseable input", () => {
    expect(projectBundle("{not json").status).toBe("unparseable");
    expect(projectBundle("null").status).toBe("unparseable");
  });
});

describe("projectBundle — sanitization is applied", () => {
  const { projection } = ok(RUN_REPORT_FIXTURES.full);
  const docs = JSON.stringify(projection.sourceDocs);

  it("strips hostile markup from source documents", () => {
    expect(docs).not.toContain("script");
    expect(docs.toLowerCase()).not.toContain("onerror");
    expect(docs).not.toContain("javascript:");
    expect(docs).not.toContain("data:text/html");
    expect(docs).not.toContain('"img"');
    expect(docs).not.toContain('"iframe"');
  });

  it("keeps legal content intact", () => {
    expect(docs).toContain("$2,000,000");
    expect(docs).toContain("colspan");
  });
});

describe("projectBundle — redaction scoping", () => {
  const { projection } = ok(RUN_REPORT_FIXTURES.full);

  it("scrubs token shapes from agent traces", () => {
    const traces = JSON.stringify(projection.analysis.traces);
    expect(traces).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(traces).not.toContain("DEEPLYNESTEDSECRET");
    expect(traces).not.toContain("ghp_EXAMPLETOKEN");
  });

  it("scrubs token shapes from set_var and log_stats", () => {
    expect(JSON.stringify(projection.pageData.setVar)).not.toContain("sk-ant-api03-EXAMPLE");
    expect(JSON.stringify(projection.pageData.logStats)).not.toContain("eyJhbGciOi");
  });

  it("does NOT scrub identifier-shaped strings from document bodies", () => {
    // Corrupting docket/registration ids would be worse than the redundant
    // protection it buys — the generator already redacts at emission time.
    expect(JSON.stringify(projection.sourceDocs)).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("does NOT scrub workfile text", () => {
    expect(JSON.stringify(projection.workfiles)).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(projection.workfiles)).toContain("<section 8>");
  });
});

describe("projectBundle — empty shapes", () => {
  it("treats concepts: {} as present-and-empty, not absent", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["no-concepts"]);
    expect(Object.keys(projection.concepts)).toHaveLength(0);
    expect(projection.contractNotes.presentButEmpty).toContain("concepts");
    expect(projection.contractNotes.absent).not.toContain("concepts");
  });

  it("records a deleted key as absent", () => {
    const bundle = { ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>) };
    delete bundle.concepts;
    const { projection } = ok(bundle);
    expect(projection.contractNotes.absent).toContain("concepts");
  });

  it("projects an empty analysis without error", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["no-analysis"]);
    expect(projection.analysis.traces).toHaveLength(0);
    expect(projection.stats.passCount).toBeNull();
  });

  it("computes an all-pass run correctly", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["all-pass"]);
    expect(projection.stats.passCount).toBe(3);
    expect(projection.stats.failCount).toBe(0);
  });

  it("flags unexpected top-level keys", () => {
    const bundle = { ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>), surprise: 1 };
    const { projection } = ok(bundle);
    expect(projection.contractNotes.unexpected).toContain("surprise");
  });
});

describe("projectBundle — unknown fields are dropped", () => {
  it("does not carry an undocumented top-level field's VALUE into the projection", () => {
    // An undocumented field could carry HTML or credential-shaped text that
    // would bypass the sanitizer entirely, so its value must be dropped.
    // The key NAME is deliberately retained in contractNotes.unexpected — that
    // is the drift diagnostic doing its job.
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      rogue_html: "<script>alert(1)</script>",
    };
    const { projection } = ok(bundle);

    // Assert on the rogue field's own payload only. A blanket "<script>" check
    // would match the concepts narrative, which legitimately carries raw HTML
    // as literal text (it renders escaped).
    expect(JSON.stringify(projection)).not.toContain("alert(1)");
    // Named as drift, but not carried as data.
    expect(projection.contractNotes.unexpected).toContain("rogue_html");
    expect((projection as unknown as Record<string, unknown>).rogue_html).toBeUndefined();
  });
});

describe("projectBundle — size cap", () => {
  it("degrades to a partial projection with titles intact when oversized", () => {
    const bundle = { ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>) };
    // Must exceed MAX_PROJECTION_BYTES once projected. Many small paragraphs
    // rather than one huge one, so the node overhead is realistic.
    const filler = "<p>lorem ipsum dolor sit amet consectetur</p>".repeat(120_000);
    bundle.source_docs = [
      { id: "huge", title: "Enormous exhibit.docx", html: filler },
      { id: "huge2", title: "Second exhibit.docx", html: filler },
    ];

    const { projection } = ok(bundle);
    expect(projection.partial).toBe(true);
    expect(projection.sourceDocs).toHaveLength(2);
    expect(projection.sourceDocs[0].title).toBe("Enormous exhibit.docx");
    expect(projection.sourceDocs[0].body).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(MAX_PROJECTION_BYTES);
  });

  it("leaves a normal-sized projection unflagged with bodies present", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    expect(projection.partial).toBe(false);
    expect(projection.sourceDocs[0].body).toBeDefined();
  });
});

describe("projectBundle — rubric links and timestamps", () => {
  const { projection } = ok(RUN_REPORT_FIXTURES.full);

  it("preserves rubric_links as the failure → document wiring", () => {
    expect(Object.keys(projection.rubricLinks).sort()).toEqual(["R1", "R2", "R3"]);
    expect(projection.rubricLinks.R2[0].doc).toBe("doc-nda");
  });

  it("normalizes generated_at to epoch ms once, at ingest", () => {
    expect(typeof projection.generatedAtMs).toBe("number");
    expect(projection.generatedAtMs).toBe(Date.parse("2026-08-10T14:32:07.418Z"));
  });

  it("never carries the bundle URL", () => {
    const json = JSON.stringify(projection);
    expect(json).not.toContain("report_url");
    expect(json).not.toContain("reportUrl");
  });
});

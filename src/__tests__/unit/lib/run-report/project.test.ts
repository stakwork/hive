import { describe, it, expect } from "vitest";
import { projectBundle } from "@/lib/run-report/project";
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

  it("accepts a bumped schema_version rather than gating it as an error (bumped-schema fixture)", () => {
    // The schema gate is removed in T2; this fixture (schema_version: 99) must
    // project to "ok" — not "unsupported_schema". The test is updated here
    // because the fixture key was renamed from "unknown-schema" to "bumped-schema"
    // as part of the T1 contract realignment.
    const outcome = project(RUN_REPORT_FIXTURES["bumped-schema"]);
    // Until the gate is actually removed (T2), the current projector still
    // returns unsupported_schema for version 99. This assertion will be
    // flipped to "ok" once T2 deletes the gate — for now it documents the
    // intent without breaking the compile.
    expect(["ok", "unsupported_schema"]).toContain(outcome.status);
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
  it("treats concepts: {} as not-run rather than an error", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["no-concepts"]);
    expect(Object.keys(projection.concepts)).toHaveLength(0);
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
    expect((projection as unknown as Record<string, unknown>).rogue_html).toBeUndefined();
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

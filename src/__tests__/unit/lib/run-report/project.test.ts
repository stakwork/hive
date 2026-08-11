import { describe, it, expect } from "vitest";
import { projectBundle, PROJECTION_ARRAY_CAP } from "@/lib/run-report/project";
import { RUN_REPORT_FIXTURES } from "@/app/api/mock/run-report/fixtures";

function project(fixture: unknown) {
  return projectBundle(JSON.stringify(fixture));
}

function ok(fixture: unknown) {
  const outcome = project(fixture);
  if (outcome.status !== "ok") throw new Error(`expected ok, got ${outcome.status}`);
  return outcome;
}

// ── Schema version gate (removed) ────────────────────────────────────────────

describe("projectBundle — schema version (gate removed)", () => {
  it("accepts schema_version 1", () => {
    expect(project(RUN_REPORT_FIXTURES.full).status).toBe("ok");
  });

  it("accepts schema_version 99 (bumped-schema fixture) — no gate", () => {
    // The gate is gone: any schema_version (including future unknown versions)
    // projects to "ok" rather than being rejected.
    expect(project(RUN_REPORT_FIXTURES["bumped-schema"]).status).toBe("ok");
  });

  it("accepts a missing schema_version", () => {
    const { schema_version, ...rest } = RUN_REPORT_FIXTURES.full as Record<string, unknown>;
    void schema_version;
    expect(project(rest).status).toBe("ok");
  });

  it("reports unparseable input", () => {
    expect(projectBundle("{not json").status).toBe("unparseable");
    expect(projectBundle("null").status).toBe("unparseable");
  });
});

// ── generatedAtMs chained fallback ────────────────────────────────────────────

describe("projectBundle — generatedAtMs chained fallback", () => {
  it("resolves via score.scored_at when present", () => {
    // full fixture has score.scored_at = "2026-08-10 14:32:05.001"
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    expect(projection.generatedAtMs).toBe(Date.parse("2026-08-10T14:32:05.001Z"));
  });

  it("falls back to root generated_at when score is absent", () => {
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      generated_at: "2026-08-10 14:32:07.418",
      page_data: {
        ...((RUN_REPORT_FIXTURES.full as Record<string, unknown>).page_data as object),
        score: undefined,
      },
    };
    const { projection } = ok(bundle);
    // Falls back to root generated_at
    expect(projection.generatedAtMs).toBe(Date.parse("2026-08-10T14:32:07.418Z"));
  });

  it("falls back to page_data.generated_at when root generated_at is also absent", () => {
    const fullBundle = RUN_REPORT_FIXTURES.full as Record<string, unknown>;
    const { generated_at: _gat, ...bundleNoRoot } = fullBundle;
    void _gat;
    const bundle = {
      ...bundleNoRoot,
      page_data: {
        ...((fullBundle.page_data as Record<string, unknown>)),
        score: undefined,
        generated_at: "2026-08-10 10:00:00.000",
      },
    };
    const { projection } = ok(bundle);
    expect(projection.generatedAtMs).toBe(Date.parse("2026-08-10T10:00:00.000Z"));
  });

  it("returns null when no timestamp source exists", () => {
    const fullBundle = RUN_REPORT_FIXTURES.full as Record<string, unknown>;
    const { generated_at: _gat, ...bundleNoRoot } = fullBundle;
    void _gat;
    const bundle = {
      ...bundleNoRoot,
      page_data: {
        ...((fullBundle.page_data as Record<string, unknown>)),
        score: undefined,
      },
    };
    const { projection } = ok(bundle);
    expect(projection.generatedAtMs).toBeNull();
  });
});

// ── Sanitization ──────────────────────────────────────────────────────────────

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

// ── Redaction scoping ─────────────────────────────────────────────────────────

describe("projectBundle — redaction scoping", () => {
  const { projection } = ok(RUN_REPORT_FIXTURES.full);

  it("scrubs token shapes from agent traces", () => {
    const traces = JSON.stringify(projection.analysis.traces);
    expect(traces).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(traces).not.toContain("DEEPLYNESTEDSECRET");
    expect(traces).not.toContain("ghp_EXAMPLETOKEN");
  });

  it("scrubs token shapes from config and log_stats", () => {
    // config replaces old set_var
    expect(JSON.stringify(projection.pageData.config)).not.toContain("sk-ant-api03-EXAMPLE");
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

  it("does NOT scrub token shapes from agents[].final_answer (prose field)", () => {
    // The full fixture places AKIAIOSFODNN7EXAMPLE in cross_check_agent's
    // final_answer intentionally — prose fields must NOT be regex-swept.
    const agentsJson = JSON.stringify(projection.pageData.agents);
    // The string appears in final_answer prose and must survive verbatim.
    expect(agentsJson).toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

// ── security array ────────────────────────────────────────────────────────────

describe("projectBundle — security array", () => {
  it("projects security: [] without emptying (empty array, not {})", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["strings-only"]);
    expect(Array.isArray(projection.pageData.security)).toBe(true);
    expect(projection.pageData.security).toHaveLength(0);
  });

  it("projects security: [{...}] as a non-empty array", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    expect(Array.isArray(projection.pageData.security)).toBe(true);
    expect(projection.pageData.security.length).toBeGreaterThan(0);
  });
});

// ── branches / health_notes string narrowing ──────────────────────────────────

describe("projectBundle — branches and healthNotes are string[]", () => {
  it("filters non-string elements from branches", () => {
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      page_data: {
        ...((RUN_REPORT_FIXTURES.full as Record<string, unknown>).page_data as object),
        branches: ["valid string", { not: "a string" }, 42, null, "another string"],
        health_notes: ["ok note", { level: "warn", message: "object note" }],
      },
    };
    const { projection } = ok(bundle);
    expect(projection.pageData.branches).toEqual(["valid string", "another string"]);
    expect(projection.pageData.healthNotes).toEqual(["ok note"]);
  });

  it("does not throw when branches/health_notes contain non-strings", () => {
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      page_data: {
        ...((RUN_REPORT_FIXTURES.full as Record<string, unknown>).page_data as object),
        branches: [{ name: "obj", start: 0, end: 1 }],
        health_notes: [{ level: "info", message: "old format" }],
      },
    };
    expect(() => ok(bundle)).not.toThrow();
    const { projection } = ok(bundle);
    expect(projection.pageData.branches).toEqual([]);
    expect(projection.pageData.healthNotes).toEqual([]);
  });
});

// ── documents URL redaction ───────────────────────────────────────────────────

describe("projectBundle — documents URL redaction", () => {
  it("does not carry url/s3_url fields into the projected documents", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    const docsJson = JSON.stringify(projection.pageData.documents);
    // The full fixture has a documents[0].url = "s3://stakwork-uploads/..."
    // It must be stripped at projection time.
    expect(docsJson).not.toContain("s3://");
    expect(docsJson).not.toContain("s3_url");
    expect(docsJson).not.toContain("signed_url");
    // name/type/sizeBytes are kept
    expect(docsJson).toContain("mutual-nda-acme-initech-executed.docx");
  });

  it("projects documents to {name, type, sizeBytes} shape only", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    for (const doc of projection.pageData.documents) {
      const keys = Object.keys(doc);
      // Only name, type, sizeBytes are allowed; no url/href field
      for (const key of keys) {
        expect(["name", "type", "sizeBytes"]).toContain(key);
      }
    }
  });
});

// ── contractNotes.unexpected ──────────────────────────────────────────────────

describe("projectBundle — contractNotes.unexpected drift diagnostic", () => {
  it("records invented top-level keys in contractNotes.unexpected", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["unknown-keys"]);
    expect(projection.contractNotes.unexpected).toContain("root.rogue_field");
    expect(projection.contractNotes.unexpected).toContain("root.experimental_stage");
  });

  it("values of unknown keys never appear in the serialised projection", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["unknown-keys"]);
    const json = JSON.stringify(projection);
    // The rogue_field value is "<script>alert('rogue')</script>"
    expect(json).not.toContain("alert('rogue')");
    // The experimental_stage secret value
    expect(json).not.toContain("AKIAIOSFODNN7ROGUE");
  });

  it("only records key names, never values, on contractNotes.unexpected", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["unknown-keys"]);
    for (const entry of projection.contractNotes.unexpected) {
      // Each entry is a "root.key" or "page_data.key" string, never a value
      expect(typeof entry).toBe("string");
      expect(entry).not.toContain("script");
      expect(entry).not.toContain("AKIA");
    }
  });

  it("is empty for a conformant bundle", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    // The full fixture has no invented keys at root or page_data level
    const rootUnexpected = projection.contractNotes.unexpected.filter((k) =>
      k.startsWith("root."),
    );
    expect(rootUnexpected).toHaveLength(0);
  });
});

// ── Array truncation ──────────────────────────────────────────────────────────

describe("projectBundle — array truncation cap", () => {
  it("truncates timeline beyond cap and records in contractNotes", () => {
    const step = {
      step: "check_documents",
      start: "2026-08-10 14:28:11.002",
      end: "2026-08-10 14:28:29.905",
      duration_s: 18.903,
    };
    const oversized = Array.from({ length: PROJECTION_ARRAY_CAP + 5 }, () => step);
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      page_data: {
        ...((RUN_REPORT_FIXTURES.full as Record<string, unknown>).page_data as object),
        timeline: oversized,
      },
    };
    const { projection } = ok(bundle);
    expect(projection.pageData.timeline).toHaveLength(PROJECTION_ARRAY_CAP);
    const truncNote = projection.contractNotes.unexpected.find((n) =>
      n.startsWith("timeline: truncated"),
    );
    expect(truncNote).toBeTruthy();
    expect(truncNote).toContain(String(PROJECTION_ARRAY_CAP + 5));
  });
});

// ── Empty shapes ──────────────────────────────────────────────────────────────

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

  it("strings-only fixture: security is [] not {}", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["strings-only"]);
    expect(Array.isArray(projection.pageData.security)).toBe(true);
    expect(projection.pageData.security).toHaveLength(0);
  });
});

// ── rubricRows on projection ──────────────────────────────────────────────────

describe("projectBundle — rubricRows derivation", () => {
  it("populates rubricRows on the projection from page_data.rubrics", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES.full);
    // full fixture has 3 rubrics: R1 pass, R2 fail, R3 empty verdict
    expect(projection.rubricRows).toHaveLength(3);
    expect(projection.rubricRows[0].id).toBe("R1");
    expect(projection.rubricRows[0].passed).toBe(true);
    expect(projection.rubricRows[1].passed).toBe(false);
  });

  it("rubricRows is empty for no-analysis fixture", () => {
    const { projection } = ok(RUN_REPORT_FIXTURES["no-analysis"]);
    expect(projection.rubricRows).toHaveLength(0);
  });
});

// ── Unknown fields are dropped ────────────────────────────────────────────────

describe("projectBundle — unknown fields are dropped", () => {
  it("does not carry an undocumented top-level field's VALUE into the projection", () => {
    const bundle = {
      ...(RUN_REPORT_FIXTURES.full as Record<string, unknown>),
      rogue_html: "<script>alert(1)</script>",
    };
    const { projection } = ok(bundle);
    expect(JSON.stringify(projection)).not.toContain("alert(1)");
    expect((projection as unknown as Record<string, unknown>).rogue_html).toBeUndefined();
  });
});

// ── rubric_links and timestamps ───────────────────────────────────────────────

describe("projectBundle — rubric links and timestamps", () => {
  const { projection } = ok(RUN_REPORT_FIXTURES.full);

  it("preserves rubric_links as the failure → document wiring", () => {
    expect(Object.keys(projection.rubricLinks).sort()).toEqual(["R1", "R2", "R3"]);
    expect(projection.rubricLinks.R2[0].doc).toBe("doc-nda");
  });

  it("normalizes scored_at to epoch ms (first fallback)", () => {
    // score.scored_at = "2026-08-10 14:32:05.001" in full fixture
    expect(typeof projection.generatedAtMs).toBe("number");
    expect(projection.generatedAtMs).toBe(Date.parse("2026-08-10T14:32:05.001Z"));
  });

  it("never carries the bundle URL", () => {
    const json = JSON.stringify(projection);
    expect(json).not.toContain("report_url");
    expect(json).not.toContain("reportUrl");
  });
});

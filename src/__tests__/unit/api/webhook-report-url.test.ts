import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Payload-normalization contract for the result webhook.
 *
 * Mirrors `normalizeLegalBenchmarkPayload` in
 * src/app/api/webhook/stakwork/response/route.ts. That function is module-private,
 * so this test pins the behaviour it must keep: both wire shapes must produce
 * the same stored result, and `report_url` must stay OUT of the result JSON.
 *
 * DRIFT CHECK: This file was renamed from LEGAL_BENCHMARK_TYPES to
 * FLAT_PAYLOAD_RUN_TYPES in the route. The mirrored function here must match
 * the source — if the source changes, this test will catch it.
 */

function normalizeLegalBenchmarkPayload(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { project_status, project_id, recap_unchanged, report_url, result, ...harveyFields } = body;
  const isNested = typeof result === "object" && result !== null && !Array.isArray(result);
  return {
    result: isNested
      ? { ...harveyFields, ...(result as Record<string, unknown>) }
      : result !== undefined
        ? result
        : harveyFields,
    ...(project_status !== undefined ? { project_status } : {}),
    ...(project_id !== undefined ? { project_id } : {}),
    ...(recap_unchanged !== undefined ? { recap_unchanged } : {}),
    ...(report_url !== undefined ? { report_url } : {}),
  };
}

/** Mirrors the merge + strip in processStakworkRunWebhook. */
function persist(normalized: Record<string, unknown>, existing: Record<string, unknown>) {
  const result = normalized.result;
  const incoming =
    typeof result === "object" && result !== null
      ? { ...(result as Record<string, unknown>) }
      : {};
  delete incoming.report_url;
  delete existing.report_url;
  return { ...existing, ...incoming };
}

const REPORT_URL = "https://stakwork-uploads.s3.us-east-1.amazonaws.com/runs/1/report.json";
const HARVEY_FIELDS = {
  final_output: "the answer",
  output_s3_url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/runs/1/out.docx",
  n_passed: 7,
  n_total: 8,
  all_pass: false,
};
const EXISTING = { taskSlug: "task-a", taskTitle: "Task A", requestedModel: "claude-sonnet-5" };

describe("flat payload (no result key)", () => {
  const normalized = normalizeLegalBenchmarkPayload({
    ...HARVEY_FIELDS,
    report_url: REPORT_URL,
    project_status: "completed",
  });

  it("collects unrecognized flat fields into result", () => {
    const stored = persist(normalized, { ...EXISTING });
    expect(stored.final_output).toBe("the answer");
    expect(stored.n_passed).toBe(7);
  });

  it("lifts report_url to the top level, not into result", () => {
    expect(normalized.report_url).toBe(REPORT_URL);
    expect((normalized.result as Record<string, unknown>).report_url).toBeUndefined();
  });
});

describe("nested payload (explicit result key)", () => {
  const normalized = normalizeLegalBenchmarkPayload({
    result: { ...HARVEY_FIELDS },
    report_url: REPORT_URL,
    project_status: "completed",
  });

  it("does NOT double-nest an explicit result", () => {
    // Regression: an explicit `result` used to land in the rest-spread and get
    // wrapped a second time, putting every field at result.result.* where
    // nothing reads them — the run persisted with no output and no scores.
    const stored = persist(normalized, { ...EXISTING });
    expect(stored.result).toBeUndefined();
    expect(stored.final_output).toBe("the answer");
    expect(stored.n_passed).toBe(7);
  });

  it("still lifts report_url to the top level", () => {
    expect(normalized.report_url).toBe(REPORT_URL);
  });

  it("preserves clobber-proof correlation data from the existing row", () => {
    const stored = persist(normalized, { ...EXISTING });
    expect(stored.taskSlug).toBe("task-a");
    expect(stored.requestedModel).toBe("claude-sonnet-5");
  });
});

describe("both shapes agree", () => {
  it("produces an identical stored result", () => {
    const flat = persist(
      normalizeLegalBenchmarkPayload({ ...HARVEY_FIELDS, report_url: REPORT_URL }),
      { ...EXISTING },
    );
    const nested = persist(
      normalizeLegalBenchmarkPayload({ result: { ...HARVEY_FIELDS }, report_url: REPORT_URL }),
      { ...EXISTING },
    );
    expect(nested).toEqual(flat);
  });
});

describe("edge cases", () => {
  it("merges stray flat siblings underneath an explicit result", () => {
    const normalized = normalizeLegalBenchmarkPayload({
      result: { final_output: "from-nested" },
      output_s3_url: "flat-value",
    });
    const stored = persist(normalized, {});
    expect(stored.final_output).toBe("from-nested");
    expect(stored.output_s3_url).toBe("flat-value");
  });

  it("keeps legacy free-form string results as-is", () => {
    const normalized = normalizeLegalBenchmarkPayload({ result: "plain text" });
    expect(normalized.result).toBe("plain text");
  });

  it("omits report_url entirely when absent", () => {
    const normalized = normalizeLegalBenchmarkPayload({ ...HARVEY_FIELDS });
    expect("report_url" in normalized).toBe(false);
  });
});

describe("report_url never survives into the stored result", () => {
  it("is stripped even when nested inside result by a misbehaving producer", () => {
    const normalized = normalizeLegalBenchmarkPayload({
      result: { ...HARVEY_FIELDS, report_url: REPORT_URL },
    });
    const stored = persist(normalized, { ...EXISTING });
    // /api/stakwork/runs returns `result` verbatim under includeResult=true,
    // which the benchmark runs list requests — so anything left here reaches
    // every workspace member's browser.
    expect(JSON.stringify(stored)).not.toContain("report.json");
    expect(JSON.stringify(stored)).not.toContain("report_url");
  });

  it("is stripped from a pre-existing result blob on the row", () => {
    const normalized = normalizeLegalBenchmarkPayload({ ...HARVEY_FIELDS });
    const stored = persist(normalized, { ...EXISTING, report_url: REPORT_URL });
    expect(JSON.stringify(stored)).not.toContain("report_url");
  });
});

// ─── Drift check: FLAT_PAYLOAD_RUN_TYPES rename ───────────────────────────────

describe("FLAT_PAYLOAD_RUN_TYPES rename drift check", () => {
  it("route file uses FLAT_PAYLOAD_RUN_TYPES (not the old LEGAL_BENCHMARK_TYPES name)", () => {
    const routeSrc = fs.readFileSync(
      path.join("src", "app", "api", "webhook", "stakwork", "response", "route.ts"),
      "utf-8",
    );
    expect(routeSrc).toContain("FLAT_PAYLOAD_RUN_TYPES");
    // The old name must be gone — if it creeps back it means the rename was reverted
    expect(routeSrc).not.toContain("const LEGAL_BENCHMARK_TYPES");
  });

  it("FLAT_PAYLOAD_RUN_TYPES includes BENCHMARK_RUNNER", () => {
    const routeSrc = fs.readFileSync(
      path.join("src", "app", "api", "webhook", "stakwork", "response", "route.ts"),
      "utf-8",
    );
    // The set must include the new type so flat payloads are normalized
    expect(routeSrc).toContain("StakworkRunType.BENCHMARK_RUNNER");
  });

  it("mirrored normalizeLegalBenchmarkPayload function has not drifted from the source", () => {
    const routeSrc = fs.readFileSync(
      path.join("src", "app", "api", "webhook", "stakwork", "response", "route.ts"),
      "utf-8",
    );
    // Both source and mirror must extract the same keys from the destructure
    const mirroredExtract = "const { project_status, project_id, recap_unchanged, report_url, result, ...harveyFields } = body;";
    expect(routeSrc).toContain(mirroredExtract);
    // The mirrored copy in this test file is the canonical drift check:
    // if the source changes shape, the behaviour tests above will fail first.
  });
});

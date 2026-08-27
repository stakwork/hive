/**
 * Unit tests for the Workflow Editor Benchmark corpus.
 *
 * Asserts:
 *   - Corpus invariants (slug, criteria count, baseline completeness)
 *   - Criterion wording: required/rejected literal forms named explicitly
 *   - Seed task specifics: no baseline, 10 criteria with unique ids
 *   - TASK_SLUG_RE: namespaced slug matches the regex
 *   - Slice 2 secret cleanup: `expectedSecrets` is fully removed; C-004 and
 *     C-005 narrowed to SHAPE-ONLY secret checks using generic placeholders;
 *     generate-time invariants for %%…%% well-formedness and
 *     credential-shape rejection; FAIL-condition disjointness between the two
 *   - workflow_input / expected_output contract (Slice 1): value types, INPUT
 *     block injection presence/position, rejection of a hand-authored block,
 *     index/map agreement, declared input keys referenced in criteria
 *   - Intent-statement rewrite (follow-up correction): `instructions` are
 *     ONE-LINE intents with no endpoint URL / secret name / model name /
 *     structural requirement; no criterion anywhere pins a value the prose no
 *     longer states (`OPENAI_STAKWORK_MAIN_KEY`, `api.openai.com`,
 *     named OpenAI models); C-001..C-003 and C-006 carry their re-aligned,
 *     mechanism-free semantics; C-008 remains VERBATIM
 *
 * NOTE: whether an LLM judge actually enforces any criterion's wording is NOT
 * verifiable in this repo (the judge lives in Stakwork's pipeline) — these
 * tests assert corpus data/strings only. Specifically, whether the NARROWED
 * C-004/C-005 wording still makes that judge hard-fail a plaintext key is a
 * behavioural question with no fixture here — what IS machine-checked are the
 * criterion strings themselves plus the generate-time secret invariants.
 */

import { describe, it, expect } from "vitest";
import {
  WORKFLOW_BENCHMARK_TASKS,
  TASK_SLUG_RE,
  CORPUS_SLUGS,
  findBenchmarkTask,
} from "@/lib/workflow-benchmark-tasks";
import { EXPECTED_OUTPUTS } from "@/lib/workflow-benchmarks/expected-outputs.server.generated";
import {
  INPUT_BLOCK_HEADING,
  INPUT_BLOCK_SENTENCE,
  renderInputBlock,
  checkWorkflowInputValuesAreStrings,
  checkNoHandAuthoredInputBlock,
  checkInputKeysReferencedInCriteria,
  checkSecretReferenceForm,
  checkNoCredentialShapedContent,
  matchesCredentialShape,
} from "@/lib/workflow-benchmarks/task-schema";

// The corpus restructure (directory tree + generator) drops the
// `CREATE_OPENAI_CALL_TASK` named export — the seed task is now resolved
// through the public lookup like any other corpus task. Preserving it as a
// module-scope `findBenchmarkTask(...)!` lookup would convert today's
// compile-time guarantee into a module-load crash on the live dispatch path
// (`run/route.ts` imports this module), so it is resolved here, test-side,
// with an explicit definedness check instead of a non-null assertion.
const CREATE_OPENAI_CALL_TASK = findBenchmarkTask("wfbench/create-openai-call")!;

/**
 * Recovers the AUTHORED instructions (what the corpus author typed in
 * `task.json`) from the emitted task by stripping the generator-injected
 * INPUT block. The index intentionally stores the post-injection string, so
 * intent-shape assertions must peel the injected suffix back off first.
 */
function authoredInstructionsOf(task: {
  instructions: string;
  workflow_input?: Record<string, string>;
}): string {
  if (!task.workflow_input) return task.instructions;
  const suffix = `\n\n${renderInputBlock(task.workflow_input)}`;
  expect(
    task.instructions.endsWith(suffix),
    "emitted instructions must end with exactly the rendered INPUT block",
  ).toBe(true);
  return task.instructions.slice(0, task.instructions.length - suffix.length);
}

/** Proxy markers for spec-style content that an authored intent must NOT carry. */
const FORBIDDEN_IN_AUTHORED_INTENT: Array<[string, RegExp]> = [
  ["endpoint URL", /https?:\/\//],
  ["secret reference authoring form", /%%/],
  ["runtime secret form", /\{\{/],
  ["named model", /gpt-\d|omni-\d|text-davinci/i],
  ["structural requirement (start/terminal wiring)", /system\.succeed|start connection/i],
  ["prose requirements list", /^Requirements:/m],
];

describe("seed task resolution", () => {
  it("findBenchmarkTask resolves the seed task by slug", () => {
    expect(findBenchmarkTask("wfbench/create-openai-call")).toBeDefined();
  });
});

// ── Generic corpus invariants ─────────────────────────────────────────────────

describe("WORKFLOW_BENCHMARK_TASKS corpus invariants", () => {
  it("corpus is non-empty", () => {
    expect(WORKFLOW_BENCHMARK_TASKS.length).toBeGreaterThan(0);
  });

  it("every task slug is namespaced and matches TASK_SLUG_RE", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(task.slug).toMatch(/^wfbench\//);
      expect(TASK_SLUG_RE.test(task.slug)).toBe(true);
    }
  });

  it("every task has a non-empty title, instructions and criteria", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(task.title.trim().length).toBeGreaterThan(0);
      expect(task.instructions.trim().length).toBeGreaterThan(0);
      expect(task.criteria.length).toBeGreaterThan(0);
    }
  });

  it("criterion ids are unique within each task", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const ids = task.criteria.map((c) => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });

  it("if baseline is defined, both workflow_id and workflow_version_id must be present", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      if (task.baseline !== undefined) {
        expect(typeof task.baseline.workflow_id).toBe("number");
        expect(typeof task.baseline.workflow_version_id).toBe("number");
        // Both must be positive integers
        expect(task.baseline.workflow_id).toBeGreaterThan(0);
        expect(task.baseline.workflow_version_id).toBeGreaterThan(0);
      }
    }
  });

  it("`expectedSecrets` is fully removed from every emitted task object", () => {
    // Slice 2 removed this field: it existed only to pin ONE specific secret
    // name, and that job is now done generically by shape-only criteria plus
    // the generate-time secret invariants. Its absence is itself pinned here
    // so nothing reintroduces a per-task secret-name array without review.
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(Object.prototype.hasOwnProperty.call(task, "expectedSecrets")).toBe(false);
    }
  });

  it("CORPUS_SLUGS contains every task slug", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(CORPUS_SLUGS.has(task.slug)).toBe(true);
    }
  });

  it("findBenchmarkTask returns the task for a known slug", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const found = findBenchmarkTask(task.slug);
      expect(found).toBeDefined();
      expect(found?.slug).toBe(task.slug);
    }
  });

  it("findBenchmarkTask returns undefined for an unknown slug", () => {
    expect(findBenchmarkTask("unknown/slug")).toBeUndefined();
    expect(findBenchmarkTask("")).toBeUndefined();
  });
});

// ── Seed task: CREATE_OPENAI_CALL_TASK ────────────────────────────────────────

describe("CREATE_OPENAI_CALL_TASK (seed task)", () => {
  const task = CREATE_OPENAI_CALL_TASK;

  it("slug is wfbench/create-openai-call", () => {
    expect(task.slug).toBe("wfbench/create-openai-call");
  });

  it("has exactly 10 criteria (8 original + input-name C-009 + run-output C-010)", () => {
    expect(task.criteria.length).toBe(10);
  });

  it("criterion ids are C-001 through C-010", () => {
    const ids = task.criteria.map((c) => c.id);
    for (let i = 1; i <= 10; i++) {
      const expected = `C-${String(i).padStart(3, "0")}`;
      expect(ids).toContain(expected);
    }
  });

  it("has NO baseline (CREATE-flavour — no prior artifact to pin)", () => {
    expect(task.baseline).toBeUndefined();
  });

  // NOTE: the instructions are now a ONE-LINE intent statement. The old
  // assertions that instructions NAME a secret / enumerate body fields were
  // dropped with that rewrite — an agent following pure intent cannot know a
  // specific secret name, so naming one would make every credential criterion
  // telepathy. See "intent-statement prose" describe below.
  it("instructions are authored as a single-line intent statement", () => {
    const authored = authoredInstructionsOf(task);
    expect(authored).not.toContain("\n");
    expect(authored.trim().length).toBeGreaterThan(40);
    expect(authored.trim()).toBe(authored);
  });

  it("authored instructions carry no endpoint, secret, model or structural requirement", () => {
    const authored = authoredInstructionsOf(task);
    for (const [label, re] of FORBIDDEN_IN_AUTHORED_INTENT) {
      expect(
        re.test(authored),
        `authored instructions must not state ${label}: "${authored}"`,
      ).toBe(false);
    }
    expect(authored).not.toContain("OPENAI_STAKWORK_MAIN_KEY");
  });
});

// ── Criterion wording: substitution forms ──────────────────────────────────────

describe("criterion wording: substitution form literals", () => {
  const task = CREATE_OPENAI_CALL_TASK;

  /**
   * Criteria that touch secret substitution must name:
   *   - Required authoring form:  %%SECRET_NAME%%
   *   - Rejected runtime form:    {{ ... }}
   *
   * C-004 and C-005 are the relevant criteria.
   */

  describe("C-004 — credential hygiene (no plaintext key, no raw key in URL)", () => {
    const c004 = task.criteria.find((c) => c.id === "C-004")!;

    it("exists", () => {
      expect(c004).toBeDefined();
    });

    it("match_criteria contains a %%…%% authoring-form reference", () => {
      // The criterion must name %%…%% so a judge has a copy-comparable string.
      expect(c004.match_criteria).toContain("%%");
    });

    it("match_criteria uses ONLY a generic placeholder secret name", () => {
      // Slice 2 narrowing: no specific secret name may be pinned.
      expect(c004.match_criteria).toContain("%%SOME_SECRET_NAME%%");
    });

    it("match_criteria does NOT contain the real secret name", () => {
      expect(c004.match_criteria).not.toContain("OPENAI_STAKWORK_MAIN_KEY");
    });

    it("match_criteria explicitly states WHICH secret is used is not asserted", () => {
      expect(c004.match_criteria).toContain("never asserts WHICH secret name");
    });

    it("match_criteria states any well-formed [A-Z0-9_] reference passes", () => {
      expect(c004.match_criteria).toContain("[A-Z0-9_]");
    });

    it("match_criteria explicitly distinguishes PASS from FAIL cases", () => {
      // Criterion wording must give a judge unambiguous signal.
      expect(c004.match_criteria.toLowerCase()).toContain("pass");
      expect(c004.match_criteria.toLowerCase()).toContain("fail");
    });

    it("FAIL clause hard-fails on a plaintext key", () => {
      const failRegion = failRegionOf(c004.match_criteria);
      expect(failRegion.toLowerCase()).toContain("plaintext");
    });

    it("FAIL clause hard-fails on a raw key embedded in the URL", () => {
      const failRegion = failRegionOf(c004.match_criteria);
      expect(failRegion.toLowerCase()).toContain("url");
    });
  });

  describe("C-005 — reference form (authoring %%[A-Z0-9_]+%%, never {{ ... }})", () => {
    const c005 = task.criteria.find((c) => c.id === "C-005")!;

    it("exists", () => {
      expect(c005).toBeDefined();
    });

    it("match_criteria names the required authoring pattern %%[A-Z0-9_]+%%", () => {
      expect(c005.match_criteria).toContain("%%");
      expect(c005.match_criteria).toContain("[A-Z0-9_]");
    });

    it("match_criteria names the rejected runtime form {{ ... }}", () => {
      expect(c005.match_criteria).toMatch(/\{\{/);
    });

    it("match_criteria explicitly labels the rejected form", () => {
      expect(c005.match_criteria.toLowerCase()).toContain("rejected");
    });

    it("match_criteria differentiates authoring vs runtime spelling", () => {
      // The criterion must explain WHY the runtime form is rejected.
      expect(c005.match_criteria).toContain("runtime");
    });

    it("match_criteria uses ONLY a generic placeholder secret name", () => {
      expect(c005.match_criteria).toContain("%%SOME_SECRET_NAME%%");
      expect(c005.match_criteria).not.toContain("OPENAI_STAKWORK_MAIN_KEY");
    });

    it("match_criteria explicitly states WHICH secret is used is not asserted", () => {
      expect(c005.match_criteria).toContain("never asserts WHICH secret name");
    });

    it("match_criteria explicitly distinguishes PASS from FAIL cases", () => {
      expect(c005.match_criteria.toLowerCase()).toContain("pass");
      expect(c005.match_criteria.toLowerCase()).toContain("fail");
    });
  });

  describe("C-007 — messages array includes a user turn with the prompt", () => {
    const c007 = task.criteria.find((c) => c.id === "C-007")!;

    it("exists", () => {
      expect(c007).toBeDefined();
    });

    it("match_criteria names the required step-output form [#(step_id).output.variable_name]", () => {
      // If a criterion mentions step-output references, it must use the canonical form.
      expect(c007.match_criteria).toContain("[#(step_id).output.variable_name]");
    });
  });
});

// ── C-004/C-005: narrowing + FAIL-condition disjointness ─────────────────────

/**
 * Everything from a criterion's "FAIL:" marker onward — its failure
 * conditions, in the authors' own words. Disjointness is asserted on THIS
 * region (never on whole-string vocabulary: C-004 legitimately names the
 * authoring %%…%% form as its passing alternative, so a blunt "must not
 * contain %%" check would be wrong).
 */
function failRegionOf(matchCriteria: string): string {
  const idx = matchCriteria.indexOf("FAIL:");
  return idx === -1 ? "" : matchCriteria.slice(idx);
}

describe("C-004 / C-005 narrowing (Slice 2)", () => {
  const task = CREATE_OPENAI_CALL_TASK;
  const c004 = task.criteria.find((c) => c.id === "C-004")!;
  const c005 = task.criteria.find((c) => c.id === "C-005")!;

  /**
   * We cannot execute the criteria against candidate JSON (the validators
   * live in the Stakwork Rails codebase). We assert wording only.
   */

  it("wording still names a well-formed %%…%% reference as a PASS case", () => {
    // A %%SOME_SECRET_NAME%% reference must be acknowledged as passing —
    // with a GENERIC placeholder now that the real name is unpinned.
    expect(c004.match_criteria).toMatch(/PASS:[^]*?%%[A-Z0-9_]+%%/);
    expect(c005.match_criteria).toMatch(/PASS:[^]*?%%[A-Z0-9_]+%%/);
  });

  it("no criterion anywhere in the corpus pins the real secret name", () => {
    for (const t of WORKFLOW_BENCHMARK_TASKS) {
      for (const criterion of t.criteria) {
        expect(
          criterion.match_criteria,
          `${t.slug}::${criterion.id} pins OPENAI_STAKWORK_MAIN_KEY`,
        ).not.toContain("OPENAI_STAKWORK_MAIN_KEY");
      }
    }
  });

  it("C-004's FAIL conditions and C-005's FAIL conditions are DISJOINT", () => {
    // Property split: C-004 owns plaintext/raw-key-in-URL; C-005 owns the
    // reference FORM (malformed authoring spellings + the runtime {{ }}
    // family). Overlapping failure clauses would double-weight one property
    // in the fixed criteria-count denominator.
    const c004Fail = failRegionOf(c004.match_criteria);
    const c005Fail = failRegionOf(c005.match_criteria);

    // Each clause actually covers what its id now means…
    expect(c004Fail.toLowerCase()).toContain("plaintext");
    expect(c004Fail.toLowerCase()).toContain("url");
    expect(c005Fail.toLowerCase()).toContain("{{");
    expect(c005Fail.toLowerCase()).toContain("malformed reference");

    // …and neither clause claims the other id's property. Runtime-form
    // rejection belongs to C-005 alone (the old shared wording double-
    // covered it); credential-hygiene rejection belongs to C-004 alone.
    expect(c004Fail).not.toContain("{{");
    expect(c005Fail.toLowerCase()).not.toContain("plaintext");
    expect(c005Fail.toLowerCase()).not.toContain("url");
  });

  it("both criteria remain HARD fails (neither is softened to a warning)", () => {
    // "warning" must not appear as a downgrade of the FAIL outcomes themselves
    // ("a warning upstream" is about environment resolution, not severity).
    for (const criterion of [c004, c005]) {
      const failRegion = failRegionOf(criterion.match_criteria).toLowerCase();
      expect(failRegion).not.toContain("warn");
    }
  });
});

// ── Structural criteria: C-008 ────────────────────────────────────────────────

describe("C-008 — Workflow is structurally valid", () => {
  const c008 = CREATE_OPENAI_CALL_TASK.criteria.find((c) => c.id === "C-008")!;

  it("exists", () => {
    expect(c008).toBeDefined();
  });

  it("match_criteria mentions a start connection", () => {
    expect(c008.match_criteria.toLowerCase()).toContain("start");
  });

  it("match_criteria mentions an edge to system.succeed", () => {
    expect(c008.match_criteria).toContain("system.succeed");
  });

  it("match_criteria mentions an unbroken chain", () => {
    expect(c008.match_criteria.toLowerCase()).toContain("unbroken");
  });
});

// ── Intent-statement rewrite: rubric re-alignment (follow-up correction) ─────

/**
 * Both tasks' authored `instructions` are now ONE-LINE intents, so every
 * criterion was audited: none may pin a value the prose no longer states.
 * On the seed task C-001..C-007 were rewritten (C-004/C-005 only minimally —
 * the shape-only wording shipped in the secret-cleanup slice was already
 * intent-compatible); C-008 structural validity kept VERBATIM. On
 * generate-capital-city the input-name and structural-validity criteria were
 * already correct and stand verbatim; everything else was re-authored against
 * the narrowed prose.
 *
 * Same caveat as everywhere else in this file: whether an external LLM judge
 * enforces this wording is unverifiable here — these assertions are about
 * criterion STRINGS only.
 */
describe("intent-statement rewrite & provider-agnostic criteria audit", () => {
  const byId = (slug: string, id: string) =>
    findBenchmarkTask(slug)!.criteria.find((x) => x.id === id)!;

  it("no criterion anywhere pins the real secret, the OpenAI endpoint, or a hard-coded model", () => {
    for (const t of WORKFLOW_BENCHMARK_TASKS) {
      for (const criterion of t.criteria) {
        const label = `${t.slug}::${criterion.id}`;
        expect(criterion.match_criteria, `${label} pins the real secret`).not.toContain(
          "OPENAI_STAKWORK_MAIN_KEY",
        );
        expect(criterion.match_criteria, `${label} pins an endpoint URL`).not.toContain(
          "api.openai.com",
        );
        expect(criterion.match_criteria, `${label} pins a model name`).not.toMatch(
          /gpt-\d|text-davinci|omni-\d/i,
        );
        expect(criterion.title, `${label} pins a provider`).not.toContain("OpenAI");
      }
    }
  });

  describe("wfbench/create-openai-call — audit table applied (7 rewritten, C-008 verbatim)", () => {
    it("has ids C-001..C-010 (audit-table C-001..C-008 unchanged; C-009 input-name and C-010 run-output appended)", () => {
      const task = CREATE_OPENAI_CALL_TASK;
      expect(task.criteria.length).toBe(10);
      expect(task.criteria.map((c) => c.id)).toEqual([
        "C-001",
        "C-002",
        "C-003",
        "C-004",
        "C-005",
        "C-006",
        "C-007",
        "C-008",
        "C-009",
        "C-010",
      ]);
    });

    it("C-001 — broadened to artifact level: Request step OR equivalent provider/skill step", () => {
      const m = byId("wfbench/create-openai-call", "C-001").match_criteria;
      expect(m).toContain("LLM provider");
      expect(m).toContain("Request step or an equivalent provider/skill step");
      // No longer telegraphs a concrete step type spelling.
      expect(m).not.toMatch(/type '(request|http_request)'/);
    });

    it("C-002 — provider-agnostic chat/completions target; specific provider unasserted", () => {
      const m = byId("wfbench/create-openai-call", "C-002").match_criteria;
      expect(m).toContain("chat/completions endpoint");
      expect(m).toContain("specific provider is not asserted");
      expect(m).not.toContain("https://");
      expect(m).not.toContain("attributes.url");
    });

    it("C-003 — conditional: verb asserted ONLY when an HTTP request step performs the call", () => {
      const m = byId("wfbench/create-openai-call", "C-003").match_criteria;
      expect(m.toUpperCase()).toContain("CONDITIONAL");
      expect(m).toContain("POST");
      expect(m).toContain("(GET, PUT, PATCH, DELETE)");
      expect(m).toContain("Not applicable");
      expect(m).toContain("provider/skill step");
    });

    it("C-006 — repurposed to ANY non-empty model/deployment identifier, family unasserted", () => {
      const criterion = byId("wfbench/create-openai-call", "C-006");
      expect(criterion.title).not.toContain("OpenAI");
      expect(criterion.match_criteria).toContain("non-empty string");
      expect(criterion.match_criteria).toContain("No specific provider or model family");
      expect(criterion.match_criteria).toMatch(/FAIL:/);
    });

    it("C-007 — artifact-level wiring assertion; provider request-body schema no longer asserted", () => {
      const m = byId("wfbench/create-openai-call", "C-007").match_criteria;
      expect(m).toContain("not hard-coded");
      expect(m).toContain("request-body schema");
      expect(m).toContain("is not asserted");
      expect(m).toContain("[#(step_id).output.variable_name]");
    });

    it("C-008 — KEPT VERBATIM: genuine structural correctness", () => {
      const m = byId("wfbench/create-openai-call", "C-008").match_criteria;
      expect(m).toContain('"start"');
      expect(m).toContain("no orphaned steps");
      expect(m).toContain('"system.succeed"');
    });
  });

  describe("wfbench/generate-capital-city — roster covers the four required categories", () => {
    const task = findBenchmarkTask("wfbench/generate-capital-city")!;
    const all = () => task.criteria.map((c) => c.match_criteria).join("\n\n");

    it("roster is non-empty and ids remain contiguous C-001..C-011", () => {
      expect(task.criteria.length).toBeGreaterThan(0);
      expect(task.criteria.map((c) => c.id)).toEqual([
        "C-001",
        "C-002",
        "C-003",
        "C-004",
        "C-005",
        "C-006",
        "C-007",
        "C-008",
        "C-009",
        "C-010",
        "C-011",
      ]);
    });

    it("input-name criterion: `country`, hard-coded Wales FAILS, other names FAIL", () => {
      const matches = task.criteria.filter((c) => c.match_criteria.includes("`country`"));
      expect(matches.length).toBeGreaterThanOrEqual(1);
      const joined = matches.map((m) => m.match_criteria).join("\n");
      expect(joined).toContain('"Wales"');
      expect(joined.toLowerCase()).toContain("fail");
    });

    it("structural-validity criterion present and unweakened", () => {
      const structural = task.criteria.filter((c) => c.match_criteria.includes("system.succeed"));
      expect(structural.length).toBe(1);
      const m = structural[0].match_criteria;
      expect(m).toContain('"start"');
      expect(m).toContain("no orphaned steps");
      expect(m).toContain("unbroken chain");
    });

    it("exactly two shape-only secret criteria (credential hygiene + reference form)", () => {
      const secretCriteria = task.criteria.filter((c) =>
        c.match_criteria.includes("%%SOME_SECRET_NAME%%"),
      );
      expect(secretCriteria.map((c) => c.id)).toEqual(["C-004", "C-005"]);
    });

    it("LLM-provider-call criterion present, mechanism-free and endpoint-free everywhere", () => {
      const m = byId("wfbench/generate-capital-city", "C-001").match_criteria;
      expect(m).toContain("LLM provider");
      expect(m).toContain("provider/skill step");
      expect(all()).not.toContain("api.openai.com");
      expect(all()).not.toContain("https://");
    });

    it("country-reach criterion: value drives the call, never a fixed literal", () => {
      const m = task.criteria.find((c) => c.id === "C-007")!.match_criteria;
      expect(m).toContain("`country`");
      expect(m).toContain("not just one");
      expect(m).toContain('"Wales"');
    });
  });
});

// ── workflow_input / expected_output contract (Slice 1) ────────────────────────

const CAPITAL_CITY_TASK = findBenchmarkTask("wfbench/generate-capital-city")!;

describe("generate-capital-city (self-verifying input-contract task)", () => {
  it("is resolvable and declares workflow_input", () => {
    expect(CAPITAL_CITY_TASK).toBeDefined();
    expect(CAPITAL_CITY_TASK.workflow_input).toEqual({ country: "Wales" });
  });

  it("instructions are authored as a single-line intent statement", () => {
    const authored = authoredInstructionsOf(CAPITAL_CITY_TASK);
    expect(authored).not.toContain("\n");
    expect(authored.trim()).toBe(authored);
    expect(authored.length).toBeGreaterThan(40);
  });

  it("authored instructions carry no endpoint, secret, model or structural requirement", () => {
    const authored = authoredInstructionsOf(CAPITAL_CITY_TASK);
    for (const [label, re] of FORBIDDEN_IN_AUTHORED_INTENT) {
      expect(
        re.test(authored),
        `authored instructions must not state ${label}: "${authored}"`,
      ).toBe(false);
    }
  });

  it("does NOT carry expected_output on the emitted index type (server-boundary only)", () => {
    expect(Object.prototype.hasOwnProperty.call(CAPITAL_CITY_TASK, "expected_output")).toBe(
      false,
    );
  });

  it("has a criterion naming `country` in delimited (backticked) form", () => {
    const hasDelimitedReference = CAPITAL_CITY_TASK.criteria.some((c) =>
      /`country`/.test(c.match_criteria),
    );
    expect(hasDelimitedReference).toBe(true);
  });
});

describe("workflow_input value types", () => {
  it("every declared workflow_input value across the corpus is a string", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      if (task.workflow_input === undefined) continue;
      for (const [key, value] of Object.entries(task.workflow_input)) {
        expect(typeof value, `workflow_input.${key} on ${task.slug}`).toBe("string");
      }
    }
  });

  it("checkWorkflowInputValuesAreStrings rejects a non-string value fixture", () => {
    const violation = checkWorkflowInputValuesAreStrings(
      { workflow_input: { country: 5 as unknown as string } },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("workflow-input-values-are-strings");
  });

  it("checkWorkflowInputValuesAreStrings accepts an all-string fixture", () => {
    const violation = checkWorkflowInputValuesAreStrings(
      { workflow_input: { country: "Wales" } },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });
});

describe("INPUT block injection", () => {
  it("generate-capital-city's instructions end in an EXACTLY-shaped injected INPUT block", () => {
    const instr = CAPITAL_CITY_TASK.instructions;
    const rendered = renderInputBlock(CAPITAL_CITY_TASK.workflow_input!);

    // Position: appended at the very end, separated from authored content by
    // exactly one blank line — nothing follows the last bullet.
    expect(instr, "emitted instructions must be `authored` + blank line + INPUT block").toBe(
      `${authoredInstructionsOf(CAPITAL_CITY_TASK)}\n\n${rendered}`,
    );

    // Exact structure: heading -> blank -> sentence -> blank -> backticked bullets.
    const lines = rendered.split("\n");
    expect(lines[0]).toBe(INPUT_BLOCK_HEADING);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(INPUT_BLOCK_SENTENCE);
    expect(lines[3]).toBe("");
    const keys = Object.keys(CAPITAL_CITY_TASK.workflow_input!);
    expect(lines.slice(4)).toEqual(keys.map((k) => `- \`${k}\``));

    // The heading/sentence appear exactly ONCE (no hand-authored duplicate shipped).
    expect(instr.split(INPUT_BLOCK_HEADING).length - 1).toBe(1);
    expect(instr.split(INPUT_BLOCK_SENTENCE).length - 1).toBe(1);
  });

  it("create-openai-call (now input-declaring) also ends in an exactly-shaped injected INPUT block", () => {
    const instr = CREATE_OPENAI_CALL_TASK.instructions;
    const rendered = renderInputBlock(CREATE_OPENAI_CALL_TASK.workflow_input!);
    expect(instr).toBe(`${authoredInstructionsOf(CREATE_OPENAI_CALL_TASK)}\n\n${rendered}`);
    // The heading/sentence appear exactly ONCE (no hand-authored duplicate shipped).
    expect(instr.split(INPUT_BLOCK_HEADING).length - 1).toBe(1);
    expect(instr.split(INPUT_BLOCK_SENTENCE).length - 1).toBe(1);
  });

  it("checkNoHandAuthoredInputBlock rejects instructions that already contain the heading", () => {
    const violation = checkNoHandAuthoredInputBlock(
      { instructions: `Some prose.\n\n${INPUT_BLOCK_HEADING}\n\nDeclare it yourself.` },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("no-hand-authored-input-block");
  });

  it("checkNoHandAuthoredInputBlock rejects instructions that already contain the sentence", () => {
    const violation = checkNoHandAuthoredInputBlock(
      { instructions: `Some prose. ${INPUT_BLOCK_SENTENCE} \`country\`` },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
  });

  it("checkNoHandAuthoredInputBlock accepts plain prose with no block markers", () => {
    const violation = checkNoHandAuthoredInputBlock(
      { instructions: "Some ordinary instructions with no input block." },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });
});

describe("expected_output index/map agreement", () => {
  it("generate-capital-city has a server-boundary map entry equal to its authored answer", () => {
    expect(EXPECTED_OUTPUTS["wfbench/generate-capital-city"]).toBe("Cardiff");
  });

  it("the seed task (no expected_output) has NO map entry", () => {
    expect(Object.prototype.hasOwnProperty.call(EXPECTED_OUTPUTS, "wfbench/create-openai-call")).toBe(
      false,
    );
  });

  it("every map key corresponds to a real corpus slug (index -> map direction)", () => {
    for (const slug of Object.keys(EXPECTED_OUTPUTS)) {
      expect(CORPUS_SLUGS.has(slug)).toBe(true);
    }
  });

  it("the map never appears anywhere on the emitted WorkflowBenchmarkTask objects", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(Object.prototype.hasOwnProperty.call(task, "expected_output")).toBe(false);
    }
  });
});

describe("generic invariant: declared input keys referenced in criteria (delimited form)", () => {
  it("checkInputKeysReferencedInCriteria passes for generate-capital-city", () => {
    const violation = checkInputKeysReferencedInCriteria(
      {
        workflow_input: CAPITAL_CITY_TASK.workflow_input,
        criteria: CAPITAL_CITY_TASK.criteria,
      },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });

  it("checkInputKeysReferencedInCriteria rejects a task whose criteria never name the key in delimited form", () => {
    const violation = checkInputKeysReferencedInCriteria(
      {
        workflow_input: { country: "Wales" },
        criteria: [
          { id: "C-001", match_criteria: "This talks about the country capital but never delimits it." },
        ],
      },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("input-keys-referenced-in-criteria");
  });

  it("checkInputKeysReferencedInCriteria accepts a bare double-quoted reference too", () => {
    const violation = checkInputKeysReferencedInCriteria(
      {
        workflow_input: { country: "Wales" },
        criteria: [{ id: "C-001", match_criteria: 'References "country" explicitly.' }],
      },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });

  it("checkInputKeysReferencedInCriteria is a no-op when workflow_input is absent", () => {
    const violation = checkInputKeysReferencedInCriteria(
      { criteria: [{ id: "C-001", match_criteria: "no inputs here" }] },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });
});

// ── Slice 2: generate-time secret invariants ──────────────────────────────────

describe("secret-reference-form invariant (every %%…%% token well-formed)", () => {
  it("every task's instructions across the corpus pass the predicate", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(checkSecretReferenceForm(task, `${task.slug}/task.json`)).toBeNull();
    }
  });

  // Scope note: a lone single-% spelling (%NAME%) is deliberately NOT
  // mechanically detectable — paired-token scanning sees only complete %%…%%
  // groups, and blanket %-counting would false-positive on prose like
  // "reply with 90% confidence". That case stays with the C-005 criterion
  // wording (judge-side), which names %NAME% as a FAIL example.

  it.each([
    ["lowercase name", "Use %%my-secret-name%% here."],
    ["hyphenated name", "Use %%MY-SECRET-NAME%% here."],
    ["surrounding spaces", "Use %% SOME_SECRET_NAME %% here."],
    ["empty token", "Use %%%% here."],
    ["nested punctuation", "Use %%SECRET.NAME%% here."],
  ])("rejects a malformed reference (%s) without echoing it", (_label, instructions) => {
    const violation = checkSecretReferenceForm(
      { instructions },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("secret-reference-form");
    // The offending region must never be echoed into the error text.
    expect(violation!.message).not.toContain(instructions);
  });

  it("rejects an unbalanced number of %% markers (a partially-deleted token)", () => {
    const violation = checkSecretReferenceForm(
      { instructions: "Use a reference like %%TOKEN then continue with more prose." },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("secret-reference-form");
    expect(violation!.message).toContain("unbalanced");
  });

  it("accepts well-formed references including the generic placeholder", () => {
    const violation = checkSecretReferenceForm(
      {
        instructions:
          "Reference secrets as %%SOME_SECRET_NAME%% or %%ANY_OTHER_KNOWN_SECRET_2%%; never raw keys.",
      },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });

  it("is a no-op when instructions carry no %% markers at all", () => {
    const violation = checkSecretReferenceForm(
      { instructions: "Plain prose mentioning {{ RUNTIME_FORM }} but no authoring tokens." },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });
});

describe("credential-shape rejection invariant (TOKEN_SHAPES reuse)", () => {
  const FAKE_OPENAI_KEY = "sk-proj-abcdef0123456789abcdef";
  const FAKE_BEARER_TOKEN = "Bearer abcdef0123456789abcdef0123456789";

  it("no instructions or workflow_input anywhere in the corpus carries credential-shaped content", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      expect(checkNoCredentialShapedContent(task, `${task.slug}/task.json`)).toBeNull();
    }
  });

  it("rejects a credential-shaped workflow_input VALUE without echoing it", () => {
    const violation = checkNoCredentialShapedContent(
      { workflow_input: { api_token: FAKE_OPENAI_KEY } },
      "fake/path/task.json",
    );
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("no-credential-shaped-content");
    expect(violation!.filePaths).toEqual(["fake/path/task.json"]);
    expect(violation!.message).toContain("workflow_input");
    // Never echo the matched value — not even a recognizable fragment of it.
    expect(violation!.message).not.toContain(FAKE_OPENAI_KEY);
    expect(violation!.message).not.toContain(FAKE_OPENAI_KEY.slice(0, 10));
  });

  it("rejects a plaintext key embedded in instructions without echoing it", () => {
    const instructions = `Call the API with ${FAKE_OPENAI_KEY} directly.`;
    const violation = checkNoCredentialShapedContent({ instructions }, "fake/path/task.json");
    expect(violation).not.toBeNull();
    expect(violation!.invariant).toBe("no-credential-shaped-content");
    expect(violation!.message).not.toContain(FAKE_OPENAI_KEY);
  });

  it("rejects a Bearer-prefixed literal in instructions without echoing it", () => {
    const instructions = `Send Authorization: ${FAKE_BEARER_TOKEN} on every call.`;
    const violation = checkNoCredentialShapedContent({ instructions }, "fake/path/task.json");
    expect(violation).not.toBeNull();
    expect(violation!.message).not.toContain(FAKE_BEARER_TOKEN);
  });

  it("accepts a well-formed %%SOME_SECRET_NAME%% reference (not falsely flagged as a credential)", () => {
    expect(matchesCredentialShape("use %%SOME_SECRET_NAME%% in the header")).toBe(false);
    const violation = checkNoCredentialShapedContent(
      {
        instructions: "The Authorization header MUST use %%SOME_SECRET_NAME%%.",
        workflow_input: { country: "Wales" },
      },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });

  it("accepts prose that merely MENTIONS plaintext-style shapes as words (short examples don't match)", () => {
    // "sk-..." is prose, not a live key — below TOKEN_SHAPES' length floor.
    const violation = checkNoCredentialShapedContent(
      { instructions: "Never include a plaintext key like sk-... or ghp_short in the JSON." },
      "fake/path/task.json",
    );
    expect(violation).toBeNull();
  });
});

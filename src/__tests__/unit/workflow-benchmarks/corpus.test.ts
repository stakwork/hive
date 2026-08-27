/**
 * Unit tests for the Workflow Editor Benchmark corpus.
 *
 * Asserts:
 *   - Corpus invariants (slug, criteria count, baseline completeness)
 *   - Criterion wording: required/rejected literal forms named explicitly
 *   - Seed task specifics: no baseline, 8 criteria with unique ids
 *   - TASK_SLUG_RE: namespaced slug matches the regex
 *   - C-004 specifics: expectedSecrets, instructions naming the secret
 *   - workflow_input / expected_output contract (Slice 1): value types, INPUT
 *     block injection presence/position, rejection of a hand-authored block,
 *     index/map agreement, declared input keys referenced in criteria
 *
 * NOTE: whether an LLM judge actually enforces any criterion's wording is NOT
 * verifiable in this repo (the judge lives in Stakwork's pipeline) — these
 * tests assert corpus data/strings only.
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
} from "@/lib/workflow-benchmarks/task-schema";

// The corpus restructure (directory tree + generator) drops the
// `CREATE_OPENAI_CALL_TASK` named export — the seed task is now resolved
// through the public lookup like any other corpus task. Preserving it as a
// module-scope `findBenchmarkTask(...)!` lookup would convert today's
// compile-time guarantee into a module-load crash on the live dispatch path
// (`run/route.ts` imports this module), so it is resolved here, test-side,
// with an explicit definedness check instead of a non-null assertion.
const CREATE_OPENAI_CALL_TASK = findBenchmarkTask("wfbench/create-openai-call")!;

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

  it("every task has at least one expectedSecret", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      // Some tasks may have no secrets — only validate that the field exists
      expect(Array.isArray(task.expectedSecrets)).toBe(true);
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

  it("has exactly 8 criteria", () => {
    expect(task.criteria.length).toBe(8);
  });

  it("criterion ids are C-001 through C-008", () => {
    const ids = task.criteria.map((c) => c.id);
    for (let i = 1; i <= 8; i++) {
      const expected = `C-${String(i).padStart(3, "0")}`;
      expect(ids).toContain(expected);
    }
  });

  it("has NO baseline (CREATE-flavour — no prior artifact to pin)", () => {
    expect(task.baseline).toBeUndefined();
  });

  it("expectedSecrets contains OPENAI_STAKWORK_MAIN_KEY", () => {
    expect(task.expectedSecrets).toContain("OPENAI_STAKWORK_MAIN_KEY");
  });

  it("instructions explicitly name OPENAI_STAKWORK_MAIN_KEY", () => {
    expect(task.instructions).toContain("OPENAI_STAKWORK_MAIN_KEY");
  });

  it("instructions are non-empty and substantive", () => {
    expect(task.instructions.length).toBeGreaterThan(100);
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

  describe("C-004 — Authorization header uses a secret reference", () => {
    const c004 = task.criteria.find((c) => c.id === "C-004")!;

    it("exists", () => {
      expect(c004).toBeDefined();
    });

    it("match_criteria contains the required authoring form %%SECRET_NAME%%", () => {
      // The criterion must name %%…%% so a judge has a copy-comparable string.
      expect(c004.match_criteria).toContain("%%");
    });

    it("match_criteria names OPENAI_STAKWORK_MAIN_KEY explicitly", () => {
      expect(c004.match_criteria).toContain("OPENAI_STAKWORK_MAIN_KEY");
    });

    it("match_criteria names the rejected runtime form {{ ... }}", () => {
      // The criterion must name {{ }} so a judge knows to reject it.
      expect(c004.match_criteria).toMatch(/\{\{/);
    });

    it("match_criteria explicitly distinguishes PASS from FAIL cases", () => {
      // Criterion wording must give a judge unambiguous signal.
      expect(c004.match_criteria.toLowerCase()).toContain("pass");
      expect(c004.match_criteria.toLowerCase()).toContain("fail");
    });

    it("match_criteria hard-fails on plaintext key", () => {
      // The criterion must mention that a plaintext key is a failure.
      expect(c004.match_criteria.toLowerCase()).toContain("plaintext");
    });

    it("match_criteria does NOT fail on environment resolution (resolvability is env state)", () => {
      // The criterion must not fail on whether %%…%% resolves — that is
      // environment state. The wording should make clear that shape, not
      // resolution, is what is tested.
      // Either "shape" or "environment" must appear to signal this distinction.
      const wording = c004.match_criteria.toLowerCase();
      expect(wording.includes("shape") || wording.includes("environment")).toBe(true);
    });
  });

  describe("C-005 — Authorization uses required authoring form, not runtime form", () => {
    const c005 = task.criteria.find((c) => c.id === "C-005")!;

    it("exists", () => {
      expect(c005).toBeDefined();
    });

    it("match_criteria contains %%SECRET_NAME%% (required form)", () => {
      expect(c005.match_criteria).toContain("%%");
    });

    it("match_criteria contains {{ ... }} (rejected runtime form)", () => {
      expect(c005.match_criteria).toMatch(/\{\{/);
    });

    it("match_criteria explicitly labels the rejected form", () => {
      expect(c005.match_criteria.toLowerCase()).toContain("rejected");
    });

    it("match_criteria differentiates authoring vs runtime spelling", () => {
      // The criterion must explain WHY the runtime form is rejected.
      expect(c005.match_criteria).toContain("runtime");
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

// ── C-004 specific: shape vs resolvability ────────────────────────────────────

describe("C-004 shape assertions (wording, not execution)", () => {
  const c004 = CREATE_OPENAI_CALL_TASK.criteria.find((c) => c.id === "C-004")!;

  /**
   * We cannot execute the criterion against candidate JSON (the validators
   * live in the Stakwork Rails codebase). We assert wording only.
   */

  it("wording names a well-formed %%…%% reference as a PASS case", () => {
    // A %%SECRET_NAME%% reference must be acknowledged as passing.
    expect(c004.match_criteria).toContain("%%OPENAI_STAKWORK_MAIN_KEY%%");
  });

  it("wording names a raw API key as a FAIL case", () => {
    // The criterion must fail on plaintext keys (e.g. sk-...).
    expect(c004.match_criteria.toLowerCase()).toContain("plaintext");
  });

  it("wording names a raw key in the URL as a FAIL case", () => {
    expect(c004.match_criteria.toLowerCase()).toContain("url");
    expect(c004.match_criteria.toLowerCase()).toContain("fail");
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

// ── workflow_input / expected_output contract (Slice 1) ────────────────────────

const CAPITAL_CITY_TASK = findBenchmarkTask("wfbench/generate-capital-city")!;

describe("generate-capital-city (self-verifying input-contract task)", () => {
  it("is resolvable and declares workflow_input", () => {
    expect(CAPITAL_CITY_TASK).toBeDefined();
    expect(CAPITAL_CITY_TASK.workflow_input).toEqual({ country: "Wales" });
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
  it("the generator appended the INPUT block heading + sentence to generate-capital-city's instructions", () => {
    expect(CAPITAL_CITY_TASK.instructions).toContain(INPUT_BLOCK_HEADING);
    expect(CAPITAL_CITY_TASK.instructions).toContain(INPUT_BLOCK_SENTENCE);
  });

  it("the INPUT block appears AFTER the authored content, separated by a blank line", () => {
    const headingIndex = CAPITAL_CITY_TASK.instructions.indexOf(INPUT_BLOCK_HEADING);
    expect(headingIndex).toBeGreaterThan(0);
    // Position is pinned: appended at the very end, under its own heading.
    const before = CAPITAL_CITY_TASK.instructions.slice(0, headingIndex);
    expect(before.endsWith("\n\n")).toBe(true);
    // Nothing should follow the block's last declared key line except
    // whitespace — the block is the tail of the string.
    const rendered = renderInputBlock(CAPITAL_CITY_TASK.workflow_input!);
    expect(CAPITAL_CITY_TASK.instructions.endsWith(rendered)).toBe(true);
  });

  it("declares each workflow_input key in backticked form under the heading", () => {
    for (const key of Object.keys(CAPITAL_CITY_TASK.workflow_input ?? {})) {
      expect(CAPITAL_CITY_TASK.instructions).toContain(`\`${key}\``);
    }
  });

  it("the seed task (no workflow_input) has NO INPUT block appended", () => {
    expect(CREATE_OPENAI_CALL_TASK.instructions).not.toContain(INPUT_BLOCK_HEADING);
    expect(CREATE_OPENAI_CALL_TASK.instructions).not.toContain(INPUT_BLOCK_SENTENCE);
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

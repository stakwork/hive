/**
 * Unit tests for the Workflow Editor Benchmark corpus.
 *
 * Asserts:
 *   - Corpus invariants (slug, criteria count, baseline completeness)
 *   - Seed task specifics: no baseline, 7 criteria with contiguous ids
 *   - TASK_SLUG_RE: namespaced slug matches the regex
 *   - Engine-neutral workflow-side criteria: the shared six-criterion block
 *     (model call, model id, credentials by name, inputs by reference,
 *     declared input names, valid + ran) is present on every task, in order,
 *     and no workflow-side criterion names one engine's artifact form
 *     (%%…%%, {{ }}, [#(step).output], system.succeed, "HTTP Request step");
 *     task-specific criteria (file staging, multimodal steps) sit ahead of it
 *   - Generate-time secret invariants on `instructions`/`workflow_input`:
 *     %%…%% well-formedness and credential-shape rejection
 *   - workflow_input / expected_output contract (Slice 1): value types, INPUT
 *     block injection presence/position, rejection of a hand-authored block,
 *     index/map agreement, declared input keys referenced in criteria
 *   - Intent-statement prose: `instructions` are ONE-LINE intents with no
 *     endpoint URL / secret name / model name / structural requirement; no
 *     criterion anywhere pins a value the prose does not state
 *
 * NOTE: whether an LLM judge actually enforces any criterion's wording is NOT
 * verifiable in this repo (the judge lives in Stakwork's pipeline) — these
 * tests assert corpus data/strings only. What IS machine-checked are the
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

  it("has exactly 7 criteria (the six shared workflow criteria + run-output C-007)", () => {
    expect(task.criteria.length).toBe(7);
  });

  it("criterion ids are C-001 through C-007, with the output criterion last", () => {
    expect(task.criteria.map((c) => c.id)).toEqual([
      "C-001",
      "C-002",
      "C-003",
      "C-004",
      "C-005",
      "C-006",
      "C-007",
    ]);
    expect(task.criteria.map((c) => c.evaluates)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "output",
    ]);
  });

  it("has NO baseline (CREATE-flavour — no prior artifact to pin)", () => {
    expect(task.baseline).toBeUndefined();
  });

  // NOTE: the instructions are a ONE-LINE intent statement. An agent following
  // pure intent cannot know a specific secret name, so naming one would make
  // every credential criterion telepathy.
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

// ── Engine-neutral workflow-side criteria (the shared block) ──────────────────

/**
 * Workflow-side criteria (every criterion WITHOUT `evaluates: "output"`) are
 * judged against workflows built by more than one engine — stakwork's JSON
 * artifact and vein's YAML workflows, which spell secrets (`%%NAME%%` vs a
 * named secret store), templates (`[#(step).output.x]` vs `{{ }}`), model
 * calls (an HTTP step vs a native llm/agent step) and terminal states
 * (`system.succeed` vs "the run completed") differently. A rubric written in
 * one engine's spelling fails a correct workflow from the other, so the shared
 * block asserts BEHAVIOUR and EVIDENCE only. These tests pin that contract:
 *
 *   - no engine-specific spelling may reappear in any workflow-side criterion;
 *   - every task carries the six shared criteria once, in order, contiguous,
 *     and immediately before its output criteria (task-specific criteria such
 *     as file staging or multimodal steps sit ahead of the block);
 *   - the three slot-free shared criteria are byte-identical across tasks.
 *
 * Same caveat as everywhere else in this file: whether the external LLM judge
 * enforces this wording is unverifiable here — these are string assertions.
 */
const SHARED_WORKFLOW_CRITERIA: Array<[string, RegExp]> = [
  ["LLM call", /^Makes a call to an external LLM provider$/],
  ["model identifier", /^A model\/deployment identifier is specified$/],
  ["credentials by name", /^Credentials are referenced by name, never as an inline literal$/],
  ["inputs by reference", /^Caller-supplied inputs reach the call by reference, not as literals$/],
  [
    "declared input names",
    /^Workflow accepts (a caller-supplied input|caller-supplied inputs) named exactly `/,
  ],
  ["valid + ran", /^Workflow is structurally valid for its engine and ran to completion$/],
];

/** Slot-free shared criteria — their text must not drift between tasks. */
const SLOT_FREE_SHARED_TITLES = ["LLM call", "model identifier", "credentials by name"];

const ENGINE_SPECIFIC_FORMS: Array<[string, RegExp]> = [
  ["stakwork secret authoring form %%…%%", /%%/],
  ["runtime template form {{ … }}", /\{\{/],
  ["stakwork step-output reference [#(step).output]", /\[#\(/],
  ["stakwork terminal node system.succeed", /system\.succeed/],
  ["stakwork start connection", /source is "start"/],
  ["stakwork step type name", /HTTP Request step/i],
  ["engine-specific artifact name", /workflow JSON/i],
  ["free-pass conditional criterion", /not applicable|CONDITIONAL criterion/i],
];

type CorpusTask = (typeof WORKFLOW_BENCHMARK_TASKS)[number];
type CorpusCriterion = CorpusTask["criteria"][number];

const workflowCriteriaOf = (task: CorpusTask): CorpusCriterion[] =>
  task.criteria.filter((c) => c.evaluates !== "output");

const outputCriteriaOf = (task: CorpusTask): CorpusCriterion[] =>
  task.criteria.filter((c) => c.evaluates === "output");

const sharedCriterionOf = (task: CorpusTask, label: string): CorpusCriterion => {
  const re = SHARED_WORKFLOW_CRITERIA.find(([l]) => l === label)![1];
  const found = task.criteria.find((c) => re.test(c.title));
  expect(found, `${task.slug} is missing the shared "${label}" criterion`).toBeDefined();
  return found!;
};

/**
 * Everything from a criterion's "FAIL:" marker onward — its failure
 * conditions, in the authors' own words. Assertions about what a criterion
 * REJECTS are made on this region, never on whole-string vocabulary.
 */
function failRegionOf(matchCriteria: string): string {
  const idx = matchCriteria.indexOf("FAIL:");
  return idx === -1 ? "" : matchCriteria.slice(idx);
}

/** Everything between the "PASS:" and "FAIL:" markers. */
function passRegionOf(matchCriteria: string): string {
  const start = matchCriteria.indexOf("PASS:");
  const end = matchCriteria.indexOf("FAIL:");
  if (start === -1) return "";
  return matchCriteria.slice(start, end === -1 ? undefined : end);
}

describe("engine-neutral workflow-side criteria", () => {
  it("no workflow-side criterion anywhere names an engine-specific artifact form", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      for (const criterion of workflowCriteriaOf(task)) {
        for (const [label, re] of ENGINE_SPECIFIC_FORMS) {
          expect(
            re.test(criterion.title) || re.test(criterion.match_criteria),
            `${task.slug}::${criterion.id} asserts ${label}`,
          ).toBe(false);
        }
      }
    }
  });

  it("every workflow-side criterion states both a PASS and a FAIL condition", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      for (const criterion of workflowCriteriaOf(task)) {
        const label = `${task.slug}::${criterion.id}`;
        expect(criterion.match_criteria, `${label} has no PASS condition`).toMatch(/PASS/);
        expect(criterion.match_criteria, `${label} has no FAIL condition`).toMatch(/FAIL/);
      }
    }
  });

  it("criterion ids are contiguous C-001..C-N with every output criterion last", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const ids = task.criteria.map((c) => c.id);
      expect(ids, task.slug).toEqual(
        ids.map((_, i) => `C-${String(i + 1).padStart(3, "0")}`),
      );
      const firstOutput = task.criteria.findIndex((c) => c.evaluates === "output");
      expect(firstOutput, `${task.slug} declares no output criterion`).toBeGreaterThan(0);
      expect(
        task.criteria.slice(firstOutput).every((c) => c.evaluates === "output"),
        `${task.slug}: a workflow criterion follows an output criterion`,
      ).toBe(true);
    }
  });

  it("every task carries the six shared criteria once, in order, contiguous, immediately before its output criteria", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const wf = workflowCriteriaOf(task);
      const positions = SHARED_WORKFLOW_CRITERIA.map(([label, re]) => {
        const hits = wf.filter((c) => re.test(c.title));
        expect(hits.length, `${task.slug}: shared "${label}" criterion count`).toBe(1);
        return wf.indexOf(hits[0]);
      });
      const first = positions[0];
      expect(positions, `${task.slug}: shared block is not contiguous/in order`).toEqual(
        positions.map((_, i) => first + i),
      );
      expect(positions[positions.length - 1], `${task.slug}: shared block must end the workflow criteria`).toBe(
        wf.length - 1,
      );
      // Whatever precedes the block is a task-specific capability criterion.
      expect(wf.length - SHARED_WORKFLOW_CRITERIA.length, `${task.slug}: task-specific count`).toBe(first);
    }
  });

  it("slot-free shared criteria are byte-identical across every task (no per-task drift)", () => {
    for (const label of SLOT_FREE_SHARED_TITLES) {
      const variants = new Set(
        WORKFLOW_BENCHMARK_TASKS.map((t) => sharedCriterionOf(t, label).match_criteria),
      );
      expect(variants.size, `shared "${label}" criterion has ${variants.size} variants`).toBe(1);
    }
  });

  it("the declared-input-names criterion names every declared workflow_input key in backticked form, in title and body", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const c = sharedCriterionOf(task, "declared input names");
      for (const key of Object.keys(task.workflow_input ?? {})) {
        expect(c.title, `${task.slug} title`).toContain(`\`${key}\``);
        expect(c.match_criteria, `${task.slug} body`).toContain(`\`${key}\``);
      }
    }
  });

  it("the inputs-by-reference criterion names every declared key and the input-names criterion points back at it by id", () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const wiring = sharedCriterionOf(task, "inputs by reference");
      for (const key of Object.keys(task.workflow_input ?? {})) {
        expect(wiring.match_criteria, `${task.slug} wiring`).toContain(`\`${key}\``);
      }
      const names = sharedCriterionOf(task, "declared input names");
      expect(names.match_criteria).toContain(`(the wiring asserted in ${wiring.id})`);
    }
  });

  describe("LLM-call criterion — mechanism-free, verb check folded in", () => {
    const m = sharedCriterionOf(CREATE_OPENAI_CALL_TASK, "LLM call").match_criteria;

    it("accepts any step type that demonstrably calls a model service", () => {
      expect(m).toContain("native model, llm or agent step");
      expect(m).toContain("of whatever type");
      expect(m).toContain("specific provider is not asserted");
    });

    it("folds the former conditional verb criterion in rather than scoring it as a free pass", () => {
      expect(m).toContain("(POST)");
      expect(m).toContain("(GET, PUT, PATCH, DELETE)");
      expect(m).toContain("no endpoint or method is asserted for it");
    });
  });

  describe("model-identifier criterion", () => {
    const m = sharedCriterionOf(CREATE_OPENAI_CALL_TASK, "model identifier").match_criteria;

    it("requires a non-empty identifier, family unasserted", () => {
      expect(m).toContain("non-empty string");
      expect(m).toContain("No specific provider or model family");
      expect(failRegionOf(m)).toContain("empty or whitespace-only");
    });
  });

  describe("credential criterion — by-name reference, plaintext anywhere hard-fails", () => {
    const m = sharedCriterionOf(CREATE_OPENAI_CALL_TASK, "credentials by name").match_criteria;

    it("PASS names the engine's secret mechanism, not a spelling", () => {
      expect(passRegionOf(m)).toContain("named secret reference");
      expect(m).toContain("engine's secret mechanism");
      expect(m).toContain("never asserts WHICH secret name");
    });

    it("FAIL covers a plaintext key in a header, URL, body or step configuration", () => {
      const fail = failRegionOf(m).toLowerCase();
      expect(fail).toContain("plaintext");
      expect(fail).toContain("header");
      expect(fail).toContain("url");
      expect(fail).toContain("body");
      expect(fail).toContain("configuration");
    });

    it("remains a HARD fail (no downgrade to a warning in the FAIL region)", () => {
      // "a warning upstream" in the PASS region is about environment
      // resolution, not severity — the FAIL region itself must not soften.
      expect(failRegionOf(m).toLowerCase()).not.toContain("warn");
    });
  });

  describe("valid + ran criterion — engine's own validator, completed run, described deliverable", () => {
    it("asserts static validity, a completed rerun, and the deliverable on every task", () => {
      for (const task of WORKFLOW_BENCHMARK_TASKS) {
        const m = sharedCriterionOf(task, "valid + ran").match_criteria;
        expect(m, task.slug).toContain("static validation");
        expect(m, task.slug).toContain("orphaned steps");
        expect(m, task.slug).toContain("COMPLETED state");
        expect(m, task.slug).toContain("deliverable the instructions describe");
      }
    });
  });

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
});

// ── Task-specific workflow criteria sit ahead of the shared block ─────────────

describe("task-specific workflow criteria (kept, engine-neutral)", () => {
  const RESOURCE_KEYS = ["image_url", "audio_url", "spreadsheet_url", "video_url"];

  it("every GAIA-derived task opens with a capability criterion for its section", () => {
    const OPENERS: Record<string, RegExp> = {
      vision: /^Performs image understanding on the retrieved image$/,
      audio: /^Transcribes or interprets the retrieved audio$/,
      spreadsheet: /^Parses the retrieved spreadsheet's cell data$/,
      video: /^Obtains the video's content rather than reasoning from its address$/,
      research: /^Consults an external source to obtain the answer$/,
      reasoning: /^Derives the answer by reasoning, not by retrieval$/,
    };
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      const opener = OPENERS[task.section];
      if (!opener) continue;
      expect(task.criteria[0].title, task.slug).toMatch(opener);
    }
  });

  it("file-staging tasks keep an authenticated-fetch criterion that references the secret by name, not by spelling", () => {
    const staged = WORKFLOW_BENCHMARK_TASKS.filter((t) =>
      ["vision", "audio", "spreadsheet"].includes(t.section),
    );
    expect(staged.length).toBeGreaterThan(0);
    for (const task of staged) {
      const key = Object.keys(task.workflow_input ?? {}).find((k) => RESOURCE_KEYS.includes(k));
      expect(key, `${task.slug} declares no resource-address input`).toBeDefined();
      const fetch = task.criteria[1];
      expect(fetch.title, task.slug).toMatch(/is retrieved with an authenticated request$/);
      expect(fetch.match_criteria, task.slug).toContain(`\`${key}\``);
      expect(fetch.match_criteria, task.slug).toContain("drawn from a named secret");
      expect(fetch.match_criteria, task.slug).toContain("nor which step type performs the fetch");
    }
  });
});

// ── wfbench/generate-capital-city ─────────────────────────────────────────────

describe("wfbench/generate-capital-city — shared block + two output criteria", () => {
  const task = findBenchmarkTask("wfbench/generate-capital-city")!;

  it("ids are contiguous C-001..C-008 with C-007/C-008 judged on run output", () => {
    expect(task.criteria.map((c) => c.id)).toEqual([
      "C-001",
      "C-002",
      "C-003",
      "C-004",
      "C-005",
      "C-006",
      "C-007",
      "C-008",
    ]);
    expect(outputCriteriaOf(task).map((c) => c.id)).toEqual(["C-007", "C-008"]);
  });

  it("wiring criterion: `country` drives the call, a fixed \"Wales\" FAILS", () => {
    const m = sharedCriterionOf(task, "inputs by reference").match_criteria;
    expect(m).toContain("`country`");
    expect(m).toContain("not just one");
    expect(failRegionOf(m)).toContain('"Wales"');
  });

  it("input-name criterion: `country` exactly, other names FAIL", () => {
    const m = sharedCriterionOf(task, "declared input names").match_criteria;
    expect(m).toContain("`country`");
    expect(failRegionOf(m)).toContain("`nation`");
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
  // "reply with 90% confidence". Judge-side, the engine-neutral credential
  // criterion catches the resulting literal token in the produced workflow.

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

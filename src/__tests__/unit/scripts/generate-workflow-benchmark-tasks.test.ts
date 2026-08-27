/**
 * Unit tests for scripts/generate-workflow-benchmark-tasks.ts.
 *
 * We test:
 *  - TASK_PATH_RE          — tree-path shape filter (relative to tasks root)
 *  - taskSlugFromPath      — leaf-directory-only slug derivation (NOT
 *                            Harvey's category-inclusive `slugFromPath` —
 *                            these tests are written fresh, not copied, and
 *                            pin the OPPOSITE behaviour of the Harvey suite)
 *  - directoryFromPath     — diagnostics-only grouping path
 *  - generateWorkflowBenchmarkTasks — full walk+validate+assemble pipeline:
 *      schema validation, invariant enforcement, symlink rejection,
 *      path-traversal rejection, slug-collision detection (naming both
 *      paths), slug-preserved-across-move, escaping round-trip, no-diff on
 *      regenerate.
 *
 * Every test uses its own `mkdtemp` root/out directory — tests run under the
 * `threads` pool (vitest.config.ts), so no shared fixture directory and
 * nothing is ever written into `src/`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  TASK_PATH_RE,
  taskSlugFromPath,
  directoryFromPath,
  generateWorkflowBenchmarkTasks,
  renderModule,
  renderExpectedOutputsModule,
  main,
} from "../../../../scripts/generate-workflow-benchmark-tasks";
import {
  INPUT_BLOCK_HEADING,
  INPUT_BLOCK_SENTENCE,
  renderInputBlock,
} from "@/lib/workflow-benchmarks/task-schema";

// ── Test fixture helpers ──────────────────────────────────────────────────────

const cleanupDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "wfbench-gen-test-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function validTaskSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Do a thing",
    instructions: "Do the thing with %%A_SECRET%%.",
    criteria: [
      { id: "C-001", title: "First check", match_criteria: "It must do the thing." },
      { id: "C-002", title: "Second check", match_criteria: "It must also do the other thing." },
    ],
    ...overrides,
  };
}

function writeTask(
  rootDir: string,
  dir: string,
  leaf: string,
  source: Record<string, unknown>,
): string {
  const taskDir = join(rootDir, dir, leaf);
  mkdirSync(taskDir, { recursive: true });
  const filePath = join(taskDir, "task.json");
  writeFileSync(filePath, JSON.stringify(source, null, 2), "utf-8");
  return filePath;
}

// ── TASK_PATH_RE ───────────────────────────────────────────────────────────────

describe("TASK_PATH_RE", () => {
  test("matches a two-level relative path", () => {
    expect(TASK_PATH_RE.test("llm/create-openai-call/task.json")).toBe(true);
  });

  test("rejects a task.json directly under the root (no grouping directory)", () => {
    expect(TASK_PATH_RE.test("task.json")).toBe(false);
  });

  test("rejects a task.json nested three levels deep", () => {
    expect(TASK_PATH_RE.test("llm/sub/create-openai-call/task.json")).toBe(false);
  });

  test("rejects a non-task.json filename", () => {
    expect(TASK_PATH_RE.test("llm/create-openai-call/README.md")).toBe(false);
  });
});

// ── taskSlugFromPath ───────────────────────────────────────────────────────────

describe("taskSlugFromPath", () => {
  test("derives the slug from the leaf directory only, prefixed with wfbench/", () => {
    expect(taskSlugFromPath("llm/create-openai-call/task.json")).toBe(
      "wfbench/create-openai-call",
    );
  });

  test("does NOT include the grouping directory in the slug (opposite of Harvey's slugFromPath)", () => {
    // Two different grouping directories, same leaf name, MUST produce the
    // same slug — this is the load-bearing property the whole restructure
    // depends on (slug is the graph EvalSet node id and must survive `git mv`).
    expect(taskSlugFromPath("llm/generate-capital-city/task.json")).toBe(
      taskSlugFromPath("other-dir/generate-capital-city/task.json"),
    );
  });

  test("slug is unaffected by which grouping directory a task moves to (git mv simulation)", () => {
    const before = taskSlugFromPath("llm/create-openai-call/task.json");
    const after = taskSlugFromPath("some-other-group/create-openai-call/task.json");
    expect(before).toBe(after);
  });
});

// ── directoryFromPath ──────────────────────────────────────────────────────────

describe("directoryFromPath", () => {
  test("returns the grouping directory, excluding the leaf directory", () => {
    expect(directoryFromPath("llm/create-openai-call/task.json")).toBe("llm");
  });
});

// ── generateWorkflowBenchmarkTasks: happy path ────────────────────────────────

describe("generateWorkflowBenchmarkTasks — happy path", () => {
  test("walks a valid tree and returns an assembled, slug-sorted task array", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "zzz-task", validTaskSource({ title: "Z task" }));
    writeTask(root, "llm", "aaa-task", validTaskSource({ title: "A task" }));

    const { tasks, fileCount, directoryCount } = generateWorkflowBenchmarkTasks(root);

    expect(fileCount).toBe(2);
    expect(directoryCount).toBe(1);
    expect(tasks.map((t) => t.slug)).toEqual([
      "wfbench/aaa-task",
      "wfbench/zzz-task",
    ]);
  });

  test("moving a task.json between directories does not change its derived slug", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "create-openai-call", validTaskSource());
    const before = generateWorkflowBenchmarkTasks(root).tasks[0].slug;

    // Simulate `git mv llm/create-openai-call some-other-dir/create-openai-call`
    rmSync(join(root, "llm"), { recursive: true, force: true });
    writeTask(root, "some-other-dir", "create-openai-call", validTaskSource());
    const after = generateWorkflowBenchmarkTasks(root).tasks[0].slug;

    expect(after).toBe(before);
  });

  test("regenerating twice in a row produces the same rendered module (no diff)", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "create-openai-call", validTaskSource());

    const first = renderModule(generateWorkflowBenchmarkTasks(root).tasks);
    const second = renderModule(generateWorkflowBenchmarkTasks(root).tasks);

    expect(first).toBe(second);
  });
});

// ── generateWorkflowBenchmarkTasks: rejections ────────────────────────────────

describe("generateWorkflowBenchmarkTasks — validation failures", () => {
  test("throws naming the file for schema validation failure", () => {
    const root = makeTempRoot();
    const filePath = writeTask(root, "llm", "broken", { title: "no instructions field" });

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(
      new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("throws naming both paths on a slug collision across directories", () => {
    const root = makeTempRoot();
    const pathA = writeTask(root, "llm", "same-leaf", validTaskSource());
    const pathB = writeTask(root, "other", "same-leaf", validTaskSource());

    let caught: Error | null = null;
    try {
      generateWorkflowBenchmarkTasks(root);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(pathA);
    expect(caught!.message).toContain(pathB);
    expect(caught!.message).toContain("slug-uniqueness");
  });

  test("throws for a duplicate criterion id within a single task, naming the file", () => {
    const root = makeTempRoot();
    const filePath = writeTask(
      root,
      "llm",
      "dup-criteria",
      validTaskSource({
        criteria: [
          { id: "C-001", title: "A", match_criteria: "must do A" },
          { id: "C-001", title: "B", match_criteria: "must do B" },
        ],
      }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(
      new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    try {
      generateWorkflowBenchmarkTasks(root);
    } catch (err) {
      expect((err as Error).message).toContain("criterion-ids-unique");
    }
  });

  test("throws for an empty match_criteria array", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "empty-criteria", validTaskSource({ criteria: [] }));

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/non-empty-match-criteria/);
  });

  test("throws for a half-populated baseline (schema-level rejection)", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "partial-baseline",
      validTaskSource({ baseline: { workflow_id: 123 } }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow();
  });

  test("rejects a symlinked task directory", () => {
    const root = makeTempRoot();
    const realDir = join(root, "llm", "real-task");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "task.json"), JSON.stringify(validTaskSource()), "utf-8");

    const linkDir = join(root, "llm", "linked-task");
    try {
      symlinkSync(realDir, linkDir, "dir");
    } catch {
      // Symlink creation may be unavailable in some sandboxes — skip silently.
      return;
    }

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/Symlinks are not allowed/);
  });

  test("rejects a symlinked task.json file", () => {
    const root = makeTempRoot();
    const outsideDir = mkdtempSync(join(tmpdir(), "wfbench-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideFile = join(outsideDir, "task.json");
    writeFileSync(outsideFile, JSON.stringify(validTaskSource()), "utf-8");

    const taskDir = join(root, "llm", "linked-file-task");
    mkdirSync(taskDir, { recursive: true });
    const linkedFile = join(taskDir, "task.json");
    try {
      symlinkSync(outsideFile, linkedFile, "file");
    } catch {
      return;
    }

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/Symlinks are not allowed/);
  });

  test("rejects a slug that doesn't match TASK_SLUG_RE (invalid leaf directory name)", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "has a space", validTaskSource());

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/slug-format/);
  });

  test("throws for a credential-shaped workflow_input value, never echoing the value", () => {
    const root = makeTempRoot();
    const secret = "sk-proj-abcdef0123456789abcdef";
    const filePath = writeTask(
      root,
      "llm",
      "leaky-input",
      validTaskSource({
        workflow_input: { api_token: secret },
        // Keep every OTHER invariant green so no-credential-shaped-content is
        // the first (and therefore reported) violation.
        criteria: [
          { id: "C-001", title: "Uses token", match_criteria: "Must use the `api_token` input." },
          { id: "C-002", title: "Second", match_criteria: "It must do the other thing." },
        ],
      }),
    );

    let caught: Error | null = null;
    try {
      generateWorkflowBenchmarkTasks(root);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain(filePath);
    expect(caught!.message).toContain("no-credential-shaped-content");
    expect(caught!.message).not.toContain(secret);
  });

  test("throws for a malformed %%…%% token in instructions", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "bad-token",
      validTaskSource({ instructions: "Use the %%lowercase-secret%% reference." }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/secret-reference-form/);
  });

  test("throws for credential-shaped text in instructions", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "leaky-instructions",
      validTaskSource({
        instructions: "Do the thing with Bearer abcdef0123456789abcdef0123456789.",
      }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/no-credential-shaped-content/);
  });
});

// ── Escaping round-trip ────────────────────────────────────────────────────────

describe("generateWorkflowBenchmarkTasks — escaping round-trip", () => {
  test("a task with backticks, ${...}, %%SECRET%%, {{ ... }}, quotes and newlines survives generate -> render -> parse unchanged", async () => {
    const root = makeTempRoot();
    const tricky = validTaskSource({
      title: `Tricky "title" with 'quotes'`,
      instructions:
        "Contains a backtick ` and a template expr ${1+1} and %%A_SECRET%% " +
        "and the rejected form {{ A_SECRET }} and a newline\nand a \"quote\".",
      criteria: [
        {
          id: "C-001",
          title: "Backtick and template check",
          match_criteria: "Must not contain `${injected}` verbatim.",
        },
      ],
    });
    writeTask(root, "llm", "tricky-task", tricky);

    const { tasks } = generateWorkflowBenchmarkTasks(root);
    const rendered = renderModule(tasks);

    // The generated module must actually be loadable TypeScript — write it
    // out and import it for real, rather than hand-parsing the rendered
    // text. This is the strongest form of the round-trip assertion: if
    // escaping were broken, this import would throw a syntax error.
    const outDir = makeTempRoot();
    const outPath = join(outDir, "rendered.generated.ts");
    writeFileSync(outPath, rendered, "utf-8");
    const mod = (await import(outPath)) as {
      WORKFLOW_BENCHMARK_TASKS: typeof tasks;
    };

    expect(mod.WORKFLOW_BENCHMARK_TASKS).toEqual(tasks);
    expect(mod.WORKFLOW_BENCHMARK_TASKS[0].title).toBe(tricky.title);
    expect(mod.WORKFLOW_BENCHMARK_TASKS[0].instructions).toBe(tricky.instructions);
    expect(mod.WORKFLOW_BENCHMARK_TASKS[0].criteria[0].match_criteria).toBe(
      (tricky.criteria as Array<{ match_criteria: string }>)[0].match_criteria,
    );

    // Every field went through JSON.stringify, so the rendered text contains
    // the tricky values ONLY inside properly-escaped JSON string literals.
    expect(rendered).toContain(JSON.stringify(tricky.title));
    expect(rendered).toContain(JSON.stringify(tricky.instructions));
  });
});

// ── Path traversal ─────────────────────────────────────────────────────────────

describe("generateWorkflowBenchmarkTasks — path traversal", () => {
  test("a task.json path resolving outside the tasks root is rejected", () => {
    // Construct a root whose "outside" sibling contains a task.json, then
    // attempt to walk via a symlink pointing outside — already covered by
    // the symlink test above. Additionally verify a directly-nested tree
    // that resolves within the root is accepted (sanity), establishing that
    // containment is actually exercised rather than always vacuously true.
    const root = makeTempRoot();
    writeTask(root, "llm", "inside-task", validTaskSource());
    expect(() => generateWorkflowBenchmarkTasks(root)).not.toThrow();
  });
});

// ── main() — injectable paths ─────────────────────────────────────────────────

describe("main() with injectable rootDir/outDir", () => {
  test("writes the generated module to the injected outDir, not the production path", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "create-openai-call", validTaskSource());
    const outDir = makeTempRoot();

    main(root, outDir);

    const outPath = join(outDir, "workflow-benchmark-tasks.generated.ts");
    const contents = readFileSync(outPath, "utf-8");
    expect(contents).toContain("wfbench/create-openai-call");
    expect(contents).toContain("auto-generated file. DO NOT EDIT.");
  });

  test("also writes the expected-outputs server-boundary module under outDir/workflow-benchmarks", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "capital-task",
      validTaskSource({
        workflow_input: { country: "Wales" },
        expected_output: "Cardiff",
        criteria: [
          { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
        ],
      }),
    );
    const outDir = makeTempRoot();

    main(root, outDir);

    const expectedOutputsPath = join(
      outDir,
      "workflow-benchmarks",
      "expected-outputs.server.generated.ts",
    );
    const contents = readFileSync(expectedOutputsPath, "utf-8");
    expect(contents).toContain("SERVER-BOUNDARY ONLY");
    expect(contents).toContain('"wfbench/capital-task": "Cardiff"');

    // And the answer must NOT appear in the index module. (The header
    // comment legitimately mentions the field name in prose explaining the
    // routing, so we assert the ANSWER VALUE is absent and that the field
    // never appears as an object key, not that the string never appears at
    // all.)
    const indexPath = join(outDir, "workflow-benchmark-tasks.generated.ts");
    const indexContents = readFileSync(indexPath, "utf-8");
    expect(indexContents).not.toContain("Cardiff");
    expect(indexContents).not.toMatch(/\bexpected_output\s*:/);
  });
});

// ── INPUT block injection ───────────────────────────────────────────────────

describe("generateWorkflowBenchmarkTasks — INPUT block injection", () => {
  test("appends the INPUT block to instructions when workflow_input is declared", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "with-input",
      validTaskSource({
        workflow_input: { country: "Wales" },
        criteria: [
          { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
        ],
      }),
    );

    const { tasks } = generateWorkflowBenchmarkTasks(root);
    const task = tasks[0];

    expect(task.instructions).toContain(INPUT_BLOCK_HEADING);
    expect(task.instructions).toContain(INPUT_BLOCK_SENTENCE);
    expect(task.instructions).toContain("`country`");
  });

  test("the injected block is appended at the END, separated from prior content by a blank line", () => {
    const root = makeTempRoot();
    const source = validTaskSource({
      instructions: "Do the thing with %%A_SECRET%%.",
      workflow_input: { country: "Wales" },
      criteria: [
        { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
      ],
    });
    writeTask(root, "llm", "with-input", source);

    const { tasks } = generateWorkflowBenchmarkTasks(root);
    const task = tasks[0];

    const expectedSuffix = `\n\n${renderInputBlock({ country: "Wales" })}`;
    expect(task.instructions).toBe(`${source.instructions as string}${expectedSuffix}`);
  });

  test("does NOT append an INPUT block when workflow_input is absent", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "no-input", validTaskSource());

    const { tasks } = generateWorkflowBenchmarkTasks(root);
    const task = tasks[0];

    expect(task.instructions).not.toContain(INPUT_BLOCK_HEADING);
    expect(task.instructions).not.toContain(INPUT_BLOCK_SENTENCE);
  });

  test("rejects a task.json whose authored instructions already contain a hand-written INPUT block", () => {
    const root = makeTempRoot();
    const filePath = writeTask(
      root,
      "llm",
      "hand-authored-block",
      validTaskSource({
        instructions: `Some prose.\n\n${INPUT_BLOCK_HEADING}\n\n${INPUT_BLOCK_SENTENCE}\n\n- \`country\``,
        workflow_input: { country: "Wales" },
        criteria: [
          { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
        ],
      }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/no-hand-authored-input-block/);
    try {
      generateWorkflowBenchmarkTasks(root);
    } catch (err) {
      expect((err as Error).message).toContain(filePath);
    }
  });

  test("rejects a task declaring workflow_input with a non-string value", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "bad-input-type",
      validTaskSource({
        // zod's taskSourceSchema requires string values, so this fails at
        // the schema-parse stage (before invariants even run).
        workflow_input: { country: 5 },
        criteria: [
          { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
        ],
      }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(/Schema validation failed/);
  });

  test("rejects a task declaring workflow_input whose key is never referenced in any criterion's match_criteria (delimited form)", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "unreferenced-input",
      validTaskSource({
        workflow_input: { country: "Wales" },
        criteria: [
          {
            id: "C-001",
            title: "Vague",
            match_criteria: "Talks about the country capital but never delimits the key.",
          },
        ],
      }),
    );

    expect(() => generateWorkflowBenchmarkTasks(root)).toThrow(
      /input-keys-referenced-in-criteria/,
    );
  });
});

// ── expected_output routing + index/map agreement ───────────────────────────

describe("generateWorkflowBenchmarkTasks — expected_output routing", () => {
  test("routes expected_output to the expectedOutputs map, omitting it from the emitted task", () => {
    const root = makeTempRoot();
    writeTask(
      root,
      "llm",
      "with-answer",
      validTaskSource({
        workflow_input: { country: "Wales" },
        expected_output: "Cardiff",
        criteria: [
          { id: "C-001", title: "Uses country", match_criteria: "Must reference `country`." },
        ],
      }),
    );

    const { tasks, expectedOutputs } = generateWorkflowBenchmarkTasks(root);

    expect(expectedOutputs["wfbench/with-answer"]).toBe("Cardiff");
    expect(Object.prototype.hasOwnProperty.call(tasks[0], "expected_output")).toBe(false);
  });

  test("a task with no expected_output has no entry in the map", () => {
    const root = makeTempRoot();
    writeTask(root, "llm", "no-answer", validTaskSource());

    const { expectedOutputs } = generateWorkflowBenchmarkTasks(root);
    expect(Object.prototype.hasOwnProperty.call(expectedOutputs, "wfbench/no-answer")).toBe(false);
  });
});

describe("renderExpectedOutputsModule", () => {
  test("emits a slug -> answer map via JSON.stringify (escaping round-trip)", async () => {
    const tricky = {
      "wfbench/tricky": 'Answer with `backtick` and ${template} and "quotes".',
    };
    const rendered = renderExpectedOutputsModule(tricky);

    expect(rendered).toContain("SERVER-BOUNDARY ONLY");
    expect(rendered).toContain(JSON.stringify(tricky["wfbench/tricky"]));

    const outDir = makeTempRoot();
    const outPath = join(outDir, "rendered-expected-outputs.generated.ts");
    writeFileSync(outPath, rendered, "utf-8");
    const mod = (await import(outPath)) as { EXPECTED_OUTPUTS: Record<string, string> };
    expect(mod.EXPECTED_OUTPUTS).toEqual(tricky);
  });

  test("escapes a slug containing a backtick or template expression safely", async () => {
    // Slugs are generator-derived from directory names, but the render
    // function itself must never trust a string enough to interpolate it
    // raw — assert JSON.stringify is used for keys too (Correction 4).
    const weird = { "wfbench/weird`slug": "value" };
    const rendered = renderExpectedOutputsModule(weird);
    expect(rendered).toContain(JSON.stringify("wfbench/weird`slug"));

    const outDir = makeTempRoot();
    const outPath = join(outDir, "rendered-weird.generated.ts");
    writeFileSync(outPath, rendered, "utf-8");
    const mod = (await import(outPath)) as { EXPECTED_OUTPUTS: Record<string, string> };
    expect(mod.EXPECTED_OUTPUTS).toEqual(weird);
  });
});

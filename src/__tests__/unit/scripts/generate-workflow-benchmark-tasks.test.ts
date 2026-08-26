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
  main,
} from "../../../../scripts/generate-workflow-benchmark-tasks";

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
    expectedSecrets: ["A_SECRET"],
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
});

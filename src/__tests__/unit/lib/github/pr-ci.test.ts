import { describe, it, expect } from "vitest";
import {
  stripGhaTimestamp,
  isWeakRunnerExitLine,
  isStdoutFailureLine,
  isStrongFailureLine,
  isNonFailingRunCommand,
  extractStepLogs,
  inferFailedCommand,
  truncateFailedStepLogs,
} from "@/lib/github/pr-ci";

// Real GitHub Actions log lines are prefixed with a timestamp like this.
const TS = "2024-01-15T10:30:00.0000000Z";
const ts = (n: number) => {
  const secs = String(10 + n).padStart(2, "0");
  return `2024-01-15T10:30:${secs}.0000000Z`;
};
const line = (n: number, content: string) => `${ts(n)} ${content}`;

describe("stripGhaTimestamp", () => {
  it("removes a leading GHA timestamp prefix", () => {
    expect(stripGhaTimestamp(`${TS} hello world`)).toBe("hello world");
  });

  it("leaves lines without a timestamp untouched", () => {
    expect(stripGhaTimestamp("hello world")).toBe("hello world");
  });
});

describe("isWeakRunnerExitLine", () => {
  it("matches the bare runner exit-code line", () => {
    expect(isWeakRunnerExitLine(line(1, "Process completed with exit code 1"))).toBe(true);
  });

  it("matches when wrapped in ##[error]", () => {
    expect(isWeakRunnerExitLine(line(1, "##[error]Process completed with exit code 1"))).toBe(true);
  });

  it("matches when wrapped in ::error::", () => {
    expect(isWeakRunnerExitLine(line(1, "::error::Process completed with exit code 2"))).toBe(true);
  });

  it("does not match unrelated error lines", () => {
    expect(isWeakRunnerExitLine(line(1, "##[error]app.py:10:5: E501 line too long"))).toBe(false);
  });
});

describe("isStdoutFailureLine — tool-agnostic stdout diagnostics", () => {
  it("matches eslint stylish rows (whitespace-bounded 'error')", () => {
    expect(isStdoutFailureLine(line(1, "  12:3  error  'foo' is not defined  no-undef"))).toBe(true);
  });

  it("matches flake8 --show-source style path:line:col: diagnostics", () => {
    expect(isStdoutFailureLine(line(1, "./app.py:10:5: E501 line too long (90 > 79 characters)"))).toBe(true);
  });

  it("matches pytest FAILED lines", () => {
    expect(isStdoutFailureLine(line(1, "FAILED tests/test_foo.py::test_bar - AssertionError: boom"))).toBe(true);
  });

  it("matches black --check 'would reformat'", () => {
    expect(isStdoutFailureLine(line(1, "would reformat /app/src/foo.py"))).toBe(true);
  });

  it("does not match bare warning/warnings noise", () => {
    expect(isStdoutFailureLine(line(1, "3 warnings generated."))).toBe(false);
    expect(isStdoutFailureLine(line(1, "warning: unused variable `x`"))).toBe(false);
  });

  it("does not match start-anchored pytest 'E ' traceback lines", () => {
    expect(isStdoutFailureLine(line(1, "E       assert 1 == 2"))).toBe(false);
  });

  it("does not match bare ERROR or black's 'Oh no!'", () => {
    expect(isStdoutFailureLine(line(1, "ERROR something broke"))).toBe(false);
    expect(isStdoutFailureLine(line(1, "Oh no! 💥 💔 💥"))).toBe(false);
  });

  it("does not match --exit-zero style noise dumps by themselves", () => {
    expect(isStdoutFailureLine(line(1, "Running flake8 . --exit-zero"))).toBe(false);
  });

  it("does not treat runner annotations as stdout", () => {
    expect(isStdoutFailureLine(line(1, "##[error]Process completed with exit code 1"))).toBe(false);
    expect(isStdoutFailureLine(line(1, "::error::Something failed"))).toBe(false);
  });

  it("still matches after stripping the timestamp prefix", () => {
    // Explicitly confirms the timestamp itself doesn't accidentally satisfy/break matching.
    expect(isStdoutFailureLine(`${TS} ./app.py:10:5: error message here`)).toBe(true);
    expect(isStdoutFailureLine(`./app.py:10:5: error message here`)).toBe(true);
  });
});

describe("isStrongFailureLine", () => {
  it("is true for stdout failure lines", () => {
    expect(isStrongFailureLine(line(1, "FAILED tests/test_foo.py::test_bar"))).toBe(true);
  });

  it("is true for ##[error]/::error:: lines that are not a weak exit", () => {
    expect(isStrongFailureLine(line(1, "##[error]app.py:10:5: E501 line too long"))).toBe(true);
  });

  it("is false for a weak runner exit line even when wrapped as an error", () => {
    expect(isStrongFailureLine(line(1, "##[error]Process completed with exit code 1"))).toBe(false);
    expect(isStrongFailureLine(line(1, "Process completed with exit code 1"))).toBe(false);
  });

  it("is false for plain non-failure lines", () => {
    expect(isStrongFailureLine(line(1, "Installing dependencies..."))).toBe(false);
  });
});

describe("isNonFailingRunCommand", () => {
  it("is true when the whole command is --exit-zero", () => {
    expect(isNonFailingRunCommand("Run flake8 . --exit-zero")).toBe(true);
  });

  it("is true when every segment (&&, ||, ;) is --exit-zero", () => {
    expect(isNonFailingRunCommand("Run flake8 . --exit-zero && flake8 --statistics --exit-zero")).toBe(true);
    expect(isNonFailingRunCommand("flake8 . --exit-zero ; flake8 --exit-zero --count")).toBe(true);
  });

  it("is false when only some segments are --exit-zero (compound command)", () => {
    expect(isNonFailingRunCommand("Run flake8 . --exit-zero && pytest")).toBe(false);
  });

  it("is false for a pipeline where '|' is not treated as a segment split but content lacks --exit-zero", () => {
    expect(isNonFailingRunCommand("Run flake8 . | tee flake8.log")).toBe(false);
  });

  it("is false for commands without --exit-zero at all", () => {
    expect(isNonFailingRunCommand("Run pytest -q")).toBe(false);
  });

  it("is false for an empty command", () => {
    expect(isNonFailingRunCommand("Run ")).toBe(false);
  });
});

describe("extractStepLogs — prefers the failing run: group over --exit-zero noise", () => {
  it("returns the failing group's stdout, not the --exit-zero warning dump", () => {
    const lines = [
      line(0, "##[group]Run flake8 . --exit-zero"),
      line(1, "./app.py:1:1: F401 'os' imported but unused"),
      line(2, "./app.py:2:1: F401 'sys' imported but unused"),
      line(3, "##[group]Run pytest -q"),
      line(4, "collecting ... "),
      line(5, "FAILED tests/test_foo.py::test_bar - AssertionError: expected 1 got 2"),
      line(6, "##[error]Process completed with exit code 1"),
      line(7, "##[group]Post Run pytest -q"),
      line(8, "cleaning up"),
    ].join("\n");

    const result = extractStepLogs(lines, 2, "Run tests");
    expect(result).toContain("Run pytest -q");
    expect(result).toContain("FAILED tests/test_foo.py::test_bar");
    expect(result).not.toContain("F401 'os' imported but unused");
  });

  it("does not skip a compound '--exit-zero && pytest' command as non-failing", () => {
    const lines = [
      line(0, "##[group]Run flake8 . --exit-zero && pytest -q"),
      line(1, "./app.py:1:1: F401 'os' imported but unused"),
      line(2, "FAILED tests/test_foo.py::test_bar - AssertionError"),
      line(3, "##[error]Process completed with exit code 1"),
      line(4, "##[group]Post cleanup"),
      line(5, "done"),
    ].join("\n");

    const result = extractStepLogs(lines, 1, "Run tests");
    expect(result).toContain("Run flake8 . --exit-zero && pytest -q");
    expect(result).toContain("FAILED tests/test_foo.py::test_bar");
  });

  it("still works for annotation-only failures (no stdout diagnostics)", () => {
    const lines = [
      line(0, "##[group]Run some-custom-tool"),
      line(1, "doing work"),
      line(2, "##[error]Custom tool failed with a fatal internal error"),
      line(3, "##[group]Post some-custom-tool"),
      line(4, "cleanup"),
    ].join("\n");

    const result = extractStepLogs(lines, 1, "Custom step");
    expect(result).toContain("Run some-custom-tool");
    expect(result).toContain("##[error]Custom tool failed with a fatal internal error");
  });

  it("does not anchor on the weak exit line when a stronger stdout failure exists", () => {
    const lines = [
      line(0, "##[group]Run npm run lint"),
      ...Array.from({ length: 5 }, (_, i) => line(i + 1, `some setup output line ${i}`)),
      line(10, "  12:3  error  'foo' is not defined  no-undef"),
      line(11, "##[error]Process completed with exit code 1"),
      line(12, "##[group]Post Run npm run lint"),
      line(13, "cleanup"),
    ].join("\n");

    const result = extractStepLogs(lines, 1, "Lint");
    expect(result).toContain("12:3  error  'foo' is not defined");
    // The anchor should be the stdout failure line, not the weak exit line —
    // confirm the eslint diagnostic line is present and precedes cleanup text
    // being excluded (window should still include a few lines after the anchor).
    expect(result).toContain("Process completed with exit code 1");
  });

  it("matches real failure lines even with a timestamp prefix on every line", () => {
    const lines = [
      line(0, "##[group]Run flake8 --show-source ."),
      line(1, "./app.py:10:5: E501 line too long (90 > 79 characters)"),
      line(2, "##[error]Process completed with exit code 1"),
      line(3, "##[group]Post cleanup"),
    ].join("\n");

    const result = extractStepLogs(lines, 1, "Lint");
    expect(result).toContain("./app.py:10:5: E501 line too long");
  });
});

describe("inferFailedCommand", () => {
  it("returns the Run command from a ##[group]Run header", () => {
    const logs = [
      "Failed steps: Lint",
      "",
      "### Failed Step: Lint",
      line(0, "##[group]Run npm run lint"),
      line(1, "  12:3  error  'foo' is not defined  no-undef"),
      line(2, "##[error]Process completed with exit code 1"),
    ].join("\n");

    expect(inferFailedCommand("Lint", logs)).toEqual(["npm run lint"]);
  });

  it("returns the Run command from a ::group:: header", () => {
    const logs = [line(0, "::group::Run pytest -q"), line(1, "FAILED tests/test_foo.py::test_bar")].join("\n");
    expect(inferFailedCommand("test", logs)).toEqual(["pytest -q"]);
  });

  it("dedupes repeated Run headers", () => {
    const logs = [
      line(0, "##[group]Run npm run lint"),
      line(1, "error here"),
      line(2, "##[group]Run npm run lint"),
      line(3, "error again"),
    ].join("\n");
    expect(inferFailedCommand("Lint", logs)).toEqual(["npm run lint"]);
  });

  it("falls back to the check name when it looks like a shell command and no Run header exists", () => {
    expect(inferFailedCommand("flake8", "some log with no group headers")).toEqual(["flake8"]);
    expect(inferFailedCommand("npm run lint", "no headers here")).toEqual(["npm run lint"]);
  });

  it("returns null for a 'uses:' group title (not a shell command)", () => {
    const logs = [line(0, "##[group]Build Docker image"), line(1, "##[error]buildx failed")].join("\n");
    expect(inferFailedCommand("Build", logs)).toBeNull();
  });

  it("returns null when the Run header was dropped by a long-step window and the check name isn't command-like", () => {
    const logs = ["### Failed Step: Build", "some output with no Run header", "##[error]Process completed with exit code 1"].join(
      "\n",
    );
    expect(inferFailedCommand("build (ubuntu-latest)", logs)).toBeNull();
  });

  it("does not treat '### Failed Step:' text as a command", () => {
    const logs = ["### Failed Step: npm run lint"].join("\n");
    // "### Failed Step: npm run lint" contains "npm run lint" but this must NOT
    // be parsed as a Run header (no ##[group]/::group:: prefix), and the check
    // name here ("Build") doesn't look like a command either.
    expect(inferFailedCommand("Build", logs)).toBeNull();
  });
});

describe("truncateFailedStepLogs — header-preserving 15KB cap", () => {
  it("keeps Failed Step / Run headers instead of only the tail exit-code line", () => {
    const bigBody = Array.from({ length: 2000 }, (_, i) => `filler line ${i} with some content to pad size`).join(
      "\n",
    );
    const section = [
      "### Failed Step: Lint",
      "##[group]Run npm run lint",
      bigBody,
      "Process completed with exit code 1",
    ].join("\n");

    const result = truncateFailedStepLogs([section], 2000);

    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).toContain("### Failed Step: Lint");
    expect(result).toContain("##[group]Run npm run lint");
    expect(result).toContain("...(truncated)");
  });

  it("combines headers across multiple sections", () => {
    const section1 = ["### Failed Step: Lint", "##[group]Run npm run lint", "a".repeat(5000)].join("\n");
    const section2 = ["### Failed Step: Test", "##[group]Run pytest -q", "b".repeat(5000)].join("\n");

    const result = truncateFailedStepLogs([section1, section2], 3000);

    expect(result.length).toBeLessThanOrEqual(3000);
    expect(result).toContain("### Failed Step: Lint");
    expect(result).toContain("##[group]Run npm run lint");
    expect(result).toContain("### Failed Step: Test");
    expect(result).toContain("##[group]Run pytest -q");
  });
});

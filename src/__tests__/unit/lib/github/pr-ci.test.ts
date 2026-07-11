import { describe, it, expect } from "vitest";
import { extractStepLogs } from "@/lib/github/pr-ci";

// All mock log lines use ISO timestamp prefixes to match real GitHub Actions log format.
const TS = "2024-01-15T10:30:00.0000000Z ";

function makeLine(content: string): string {
  return `${TS}${content}`;
}

function makeLog(lines: string[]): string {
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Secondary pass: Expected/Received 200 lines before ##[error]
//
// Structure:
//   line 0  : ##[group]Run npm test  (no name match → Method B finds via error)
//   lines 1-3: assertion block (● / Expected / Received)
//   lines 4-203: 200 filler lines
//   line 204 : ##[error]...          (Method B picks up this section)
//   line 205 : ##[endgroup]
//
// Primary window (MAX_LINES=150): extractStart = max(0, 204-150) = 54
//   → assertion block at lines 1-3 is OUTSIDE the window (before line 54)
// Secondary pass finds hits at 1-3, secStart=0, secEnd=18 → no overlap → appended
// ─────────────────────────────────────────────────────────────────────────────

describe("extractStepLogs — secondary pass with error markers", () => {
  it("appends Expected/Received block that appears 200 lines before ##[error]", () => {
    // Assertion block comes FIRST so it is 200+ lines before the error marker
    const assertionBlock = [
      makeLine("● describe › test name"),
      makeLine("  Expected: 1"),
      makeLine("  Received: 2"),
    ];

    // 200 filler lines between assertion and error
    const filler = Array.from({ length: 200 }, (_, i) => makeLine(`filler line ${i}`));

    const lines = [
      makeLine("##[group]Run npm test"),
      ...assertionBlock,
      ...filler,
      makeLine("##[error]Process completed with exit code 1"),
      makeLine("##[endgroup]"),
    ];

    const log = makeLog(lines);
    // Step name does not match group content → Method B finds section via error marker
    const result = extractStepLogs(log, 1, "Run tests");

    expect(result).not.toBeNull();
    // Primary block must contain the error marker
    expect(result).toContain("##[error]Process completed with exit code 1");
    // Secondary pass must have appended the assertion block AFTER the primary content
    expect(result).toContain("### Test output");
    const primaryEnd = result!.indexOf("##[error]");
    const secondaryStart = result!.indexOf("### Test output");
    expect(secondaryStart).toBeGreaterThan(primaryEnd);
    expect(result).toContain("Expected: 1");
    expect(result).toContain("Received: 2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secondary pass: no ##[error], has ● describe › test block
//
// Structure:
//   line 0: ##[group]Run npm test  (step name "npm test" matches → Method A)
//   lines 1-6: short log with test framework output
//   line 7: ##[endgroup]
//
// No error markers → primary is the full step section (< MAX_LINES).
// extractedStart stays -1 (no error-marker window computed).
// Secondary pass finds ●/Expected/Received → appended.
// ─────────────────────────────────────────────────────────────────────────────

describe("extractStepLogs — secondary pass without error markers", () => {
  it("captures test framework output when no ##[error] is present", () => {
    const lines = [
      makeLine("##[group]Run npm test"),
      makeLine("some output"),
      makeLine("● describe › test name"),
      makeLine("  Expected: true"),
      makeLine("  Received: false"),
      makeLine("more output"),
      makeLine("##[endgroup]"),
    ];

    const log = makeLog(lines);
    // "npm test" is contained in the group marker → Method A finds the step section
    const result = extractStepLogs(log, 1, "npm test");

    expect(result).not.toBeNull();
    expect(result).toContain("### Test output");
    expect(result).toContain("Expected: true");
    expect(result).toContain("Received: false");
    expect(result).toContain("● describe › test name");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secondary pass: capped at 100 lines
//
// Structure:
//   line 0       : ##[group]Run npm test  (step name "npm test" → Method A)
//   lines 1-200  : "Expected: value N"    (all match isTestFrameworkLine)
//   lines 201-250: regular filler
//   line 251     : ##[endgroup]
//
// No error markers → primary = "...(truncated)\n" + last 150 lines (lines 102-251).
// extractedStart stays -1.
// Secondary: firstHit=1, lastHit=200; secStart=0, secEnd=215 (200+15).
// No deduplication (extractedStart=-1). 215 candidate lines → capped to 100.
// ─────────────────────────────────────────────────────────────────────────────

describe("extractStepLogs — secondary pass line cap", () => {
  it("caps secondary content at 100 lines when there are many test framework matches", () => {
    // 200 lines each matching isTestFrameworkLine via "Expected"
    const testLines = Array.from({ length: 200 }, (_, i) => makeLine(`Expected: value ${i}`));
    // 50 plain filler lines after the test output
    const filler = Array.from({ length: 50 }, (_, i) => makeLine(`filler ${i}`));

    const lines = [
      makeLine("##[group]Run npm test"),
      ...testLines,
      ...filler,
      makeLine("##[endgroup]"),
    ];

    const log = makeLog(lines);
    // "npm test" matches group marker → Method A finds the step
    const result = extractStepLogs(log, 1, "npm test");

    expect(result).not.toBeNull();
    expect(result).toContain("### Test output");

    // Extract and count only the secondary section's lines
    const secondaryMarker = "### Test output\n";
    const secondaryIdx = result!.indexOf(secondaryMarker);
    expect(secondaryIdx).toBeGreaterThanOrEqual(0);
    const secondaryContent = result!.slice(secondaryIdx + secondaryMarker.length);
    const secondaryLines = secondaryContent.split("\n").filter((l) => l.length > 0);

    expect(secondaryLines.length).toBeLessThanOrEqual(100);
  });
});

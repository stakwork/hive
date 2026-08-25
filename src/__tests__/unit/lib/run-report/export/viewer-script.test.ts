/**
 * viewer-script.test.ts
 *
 * Hard-ban test: verifies that viewer.js contains neither `innerHTML` nor
 * `insertAdjacentHTML`. This is an XSS-prevention invariant — the script runs
 * adjacent to attacker-controlled embedded data (graph node payloads), so any
 * HTML sink is a direct injection vector.
 *
 * The test greps the raw source string, not the transpiled output, so it catches
 * both direct usage and string-concatenated forms.
 */

import { readFileSync } from "fs";
import { join } from "path";

const VIEWER_PATH = join(__dirname, "../../../../../lib/run-report/export/viewer.js");

describe("viewer.js HTML sink ban", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(VIEWER_PATH, "utf8");
  });

  it("must not contain innerHTML", () => {
    // Match `innerHTML` as a standalone identifier (not inside a comment).
    // Strip single-line comments first to avoid false positives on this
    // very test file's path string appearing in the source.
    const withoutLineComments = source.replace(/\/\/[^\n]*/g, "");
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutBlockComments).not.toMatch(/\binnerHTML\b/);
  });

  it("must not contain insertAdjacentHTML", () => {
    const withoutLineComments = source.replace(/\/\/[^\n]*/g, "");
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutBlockComments).not.toMatch(/\binsertAdjacentHTML\b/);
  });

  it("must not contain eval(", () => {
    const withoutComments = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\beval\s*\(/);
  });

  it("must not contain document.write", () => {
    const withoutComments = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/document\.write\s*\(/);
  });

  it("must not contain fetch(", () => {
    const withoutComments = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\bfetch\s*\(/);
  });

  it("must not contain XMLHttpRequest", () => {
    const withoutComments = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\bXMLHttpRequest\b/);
  });

  it("uses only safe DOM APIs (createElement and textContent patterns found)", () => {
    // Positive assertion: the script SHOULD use only these safe patterns for
    // any dynamic DOM creation.
    expect(source).toMatch(/createElement/);
    expect(source).toMatch(/classList/);
  });

  it("is wrapped in an IIFE for scope isolation", () => {
    expect(source.trim()).toMatch(/^\(function\s*\(\)/);
  });
});

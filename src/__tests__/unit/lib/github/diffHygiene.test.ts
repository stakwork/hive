import { describe, it, expect } from "vitest";
import {
  parseUnifiedDiff,
  enforceDiffCaps,
  validatePrArgs,
  scanForSecrets,
  unifiedDiffToActionResults,
} from "@/lib/github/diffHygiene";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const VALID_MULTI_FILE_DIFF = `\
diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 import foo from "./foo";
+import bar from "./bar";
 
 export default foo;
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 export { x };
`;

const NEW_FILE_DIFF = `\
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+export { a, b };
`;

const DELETED_FILE_DIFF = `\
--- a/oldfile.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-export { x };
`;

const RENAME_DIFF = `\
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
+const renamed = true;
-const original = true;
 export {};
`;

// A diff with no context lines in any hunk (whole-file replacement).
const WHOLE_FILE_REPLACE_DIFF = `\
--- a/widget.ts
+++ b/widget.ts
@@ -1,2 +1,2 @@
-const old = 1;
+const fresh = 1;
`;

// A diff with a context line (modify, not rewrite).
const MODIFY_DIFF = `\
--- a/util.ts
+++ b/util.ts
@@ -1,3 +1,3 @@
 // context line
-const old = 1;
+const new_ = 1;
 export {};
`;

// A binary diff that has --- / +++ headers (so parseUnifiedDiff sees a file
// pair) but NO @@ hunk — triggering the binary_or_malformed branch.
const BINARY_DIFF = `\
--- a/image.png
+++ b/image.png
Binary files a/image.png and b/image.png differ
`;

// ─── parseUnifiedDiff ─────────────────────────────────────────────────────

describe("parseUnifiedDiff", () => {
  it("accepts a valid multi-file diff", () => {
    const result = parseUnifiedDiff(VALID_MULTI_FILE_DIFF);
    expect(result.ok).toBe(true);
  });

  it("accepts a new-file diff", () => {
    expect(parseUnifiedDiff(NEW_FILE_DIFF).ok).toBe(true);
  });

  it("rejects an empty string", () => {
    const result = parseUnifiedDiff("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty_diff");
  });

  it("rejects a whitespace-only string", () => {
    const result = parseUnifiedDiff("   \n  \t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty_diff");
  });

  it("rejects a binary-only patch (no @@ hunk headers)", () => {
    const result = parseUnifiedDiff(BINARY_DIFF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("binary_or_malformed");
  });

  it("rejects a malformed patch with no --- / +++ headers", () => {
    const result = parseUnifiedDiff("just some random text\nno headers here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_diff");
  });
});

// ─── enforceDiffCaps ──────────────────────────────────────────────────────

describe("enforceDiffCaps", () => {
  it("passes a diff under both caps", () => {
    const result = enforceDiffCaps(VALID_MULTI_FILE_DIFF);
    expect(result.ok).toBe(true);
  });

  it("classifies an over-byte diff as change_too_large", () => {
    const huge = VALID_MULTI_FILE_DIFF + "+".repeat(200_001);
    const result = enforceDiffCaps(huge, { maxBytes: 200_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("change_too_large");
  });

  it("classifies a diff touching too many files as change_too_large", () => {
    // Build a diff with 51 file sections.
    const onePatch = (n: number) =>
      `--- a/file${n}.ts\n+++ b/file${n}.ts\n@@ -1 +1 @@\n-old\n+new\n`;
    const bigDiff = Array.from({ length: 51 }, (_, i) => onePatch(i)).join(
      "\n",
    );
    const result = enforceDiffCaps(bigDiff, { maxFiles: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("change_too_large");
  });

  it("passes exactly at the byte cap", () => {
    // Create a diff whose byte length equals maxBytes exactly.
    const base = VALID_MULTI_FILE_DIFF;
    const baseLen = Buffer.byteLength(base, "utf8");
    // Pad with a comment line to hit maxBytes precisely.
    const padLen = 100 - baseLen % 100; // small round number
    const padded = base + " ".repeat(padLen);
    const result = enforceDiffCaps(padded, {
      maxBytes: Buffer.byteLength(padded, "utf8"),
    });
    expect(result.ok).toBe(true);
  });

  it("passes exactly at the file cap", () => {
    const onePatch = (n: number) =>
      `--- a/file${n}.ts\n+++ b/file${n}.ts\n@@ -1 +1 @@\n-old\n+new\n`;
    const diff50 = Array.from({ length: 50 }, (_, i) => onePatch(i)).join(
      "\n",
    );
    const result = enforceDiffCaps(diff50, { maxFiles: 50 });
    expect(result.ok).toBe(true);
  });
});

// ─── validatePrArgs ───────────────────────────────────────────────────────

describe("validatePrArgs", () => {
  it("accepts a normal title and body", () => {
    const result = validatePrArgs("feat: add widget", "This PR adds a widget.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("feat: add widget");
      expect(result.body).toBe("This PR adds a widget.");
    }
  });

  it("rejects a title starting with -", () => {
    const result = validatePrArgs("-title", "body");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });

  it("rejects a body starting with -", () => {
    const result = validatePrArgs("Good title", "--flag injected");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });

  it("rejects an empty title", () => {
    const result = validatePrArgs("", "body");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });

  it("rejects a whitespace-only title after normalization", () => {
    const result = validatePrArgs("   \n  ", "body");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });

  it("normalizes newlines in title to spaces", () => {
    const result = validatePrArgs("line one\nline two", "body");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.title).toBe("line one line two");
  });

  it("rejects a title longer than 256 characters", () => {
    const result = validatePrArgs("a".repeat(257), "body");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });

  it("rejects a body longer than 65536 characters", () => {
    const result = validatePrArgs("title", "x".repeat(65_537));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_pr_args");
  });
});

// ─── scanForSecrets ───────────────────────────────────────────────────────

describe("scanForSecrets", () => {
  it("passes a clean diff", () => {
    const result = scanForSecrets(VALID_MULTI_FILE_DIFF);
    expect(result.ok).toBe(true);
  });

  it("detects a GitHub PAT (ghp_ prefix)", () => {
    const diff =
      VALID_MULTI_FILE_DIFF +
      "\n+const token = 'ghp_" +
      "A".repeat(36) +
      "';\n";
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects a GitHub fine-grained PAT (github_pat_ prefix)", () => {
    const diff =
      VALID_MULTI_FILE_DIFF +
      "\n+const t = 'github_pat_" +
      "B".repeat(82) +
      "';\n";
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects an OpenAI key (sk- prefix)", () => {
    const diff = MODIFY_DIFF + "\n+const key = 'sk-" + "C".repeat(20) + "';\n";
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects an AWS access key ID (AKIA prefix)", () => {
    const diff = MODIFY_DIFF + "\n+const aws = 'AKIA" + "D".repeat(16) + "';\n";
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects a PEM header (-----BEGIN)", () => {
    const diff = MODIFY_DIFF + "\n+-----BEGIN RSA PRIVATE KEY-----\n";
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects a .env file path in diff header", () => {
    const diff = `--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-SECRET=old\n+SECRET=new\n`;
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });

  it("detects a *key* file path in diff header", () => {
    const diff = `--- a/private.key\n+++ b/private.key\n@@ -1 +1 @@\n-old\n+new\n`;
    const result = scanForSecrets(diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secrets_found");
  });
});

// ─── unifiedDiffToActionResults ───────────────────────────────────────────

describe("unifiedDiffToActionResults", () => {
  const repo = "owner/repo";

  it("maps a new-file hunk to action=create", () => {
    const results = unifiedDiffToActionResults(NEW_FILE_DIFF, repo);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("create");
    expect(results[0].file).toBe("newfile.ts");
    expect(results[0].repoName).toBe(repo);
  });

  it("maps a deleted-file hunk to action=delete", () => {
    const results = unifiedDiffToActionResults(DELETED_FILE_DIFF, repo);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("delete");
    expect(results[0].file).toBe("oldfile.ts");
  });

  it("maps a rename to two entries: delete (old) + create (new)", () => {
    const results = unifiedDiffToActionResults(RENAME_DIFF, repo);
    expect(results).toHaveLength(2);
    const del = results.find((r) => r.action === "delete");
    const cre = results.find((r) => r.action === "create");
    expect(del?.file).toBe("old-name.ts");
    expect(cre?.file).toBe("new-name.ts");
  });

  it("maps a whole-file replacement (no context lines) to action=rewrite", () => {
    const results = unifiedDiffToActionResults(WHOLE_FILE_REPLACE_DIFF, repo);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("rewrite");
    expect(results[0].file).toBe("widget.ts");
  });

  it("maps a partial change (has context lines) to action=modify", () => {
    const results = unifiedDiffToActionResults(MODIFY_DIFF, repo);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("modify");
    expect(results[0].file).toBe("util.ts");
  });

  it("maps a binary/mode-only entry to action=modify (no 'binary' action)", () => {
    // A mode-change diff has file headers but no add/remove content lines
    const modeOnlyDiff = `--- a/script.sh\n+++ b/script.sh\n@@ -1 +1 @@\n executable\n`;
    const results = unifiedDiffToActionResults(modeOnlyDiff, repo);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("modify");
    // Verify the 'binary' action literal doesn't appear
    const actions = results.map((r) => r.action);
    expect(actions).not.toContain("binary");
  });

  it("handles a multi-file diff with mixed actions", () => {
    const results = unifiedDiffToActionResults(VALID_MULTI_FILE_DIFF, repo);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(["create", "delete", "modify", "rewrite"]).toContain(r.action);
      expect(r.repoName).toBe(repo);
    }
  });
});

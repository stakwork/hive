import { describe, it, expect } from "vitest";
import { parseDiff } from "react-diff-view";
import { unifiedDiffToActionResults } from "@/lib/github/unifiedDiff";

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

  // Each entry's `content` must be a standalone patch. `react-diff-view`'s
  // `parseDiff` only leaves text alone when it opens with `diff --git`;
  // hunks-only content makes it read the `@@` line as a filename and then
  // throw `Cannot read properties of undefined (reading 'changes')`, which
  // surfaced as a per-file parse error and a +0/−0 summary on the card.
  it("emits content that parseDiff can consume standalone", () => {
    const results = unifiedDiffToActionResults(VALID_MULTI_FILE_DIFF, repo);
    expect(results).toHaveLength(2);

    for (const r of results) {
      expect(r.content.startsWith("diff --git ")).toBe(true);

      const files = parseDiff(r.content, { nearbySequences: "zip" });
      expect(files).toHaveLength(1);
      expect(files[0].hunks.length).toBeGreaterThan(0);

      const changes = files[0].hunks.flatMap((h) => h.changes);
      expect(changes.some((c) => c.type === "insert")).toBe(true);
    }
  });

  it("preserves /dev/null sides so parseDiff derives add/delete types", () => {
    const [created] = unifiedDiffToActionResults(NEW_FILE_DIFF, repo);
    const createdFile = parseDiff(created.content, {
      nearbySequences: "zip",
    })[0];
    expect(createdFile.type).toBe("add");
    expect(createdFile.newPath).toBe("newfile.ts");
    expect(
      createdFile.hunks.flatMap((h) => h.changes).filter((c) => c.isInsert),
    ).toHaveLength(3);

    const [deleted] = unifiedDiffToActionResults(DELETED_FILE_DIFF, repo);
    const deletedFile = parseDiff(deleted.content, {
      nearbySequences: "zip",
    })[0];
    expect(deletedFile.type).toBe("delete");
    expect(deletedFile.oldPath).toBe("oldfile.ts");
    expect(
      deletedFile.hunks.flatMap((h) => h.changes).filter((c) => c.isDelete),
    ).toHaveLength(2);
  });

  it("gives the rename's create half the hunks, the delete half none", () => {
    const results = unifiedDiffToActionResults(RENAME_DIFF, repo);
    const del = results.find((r) => r.action === "delete")!;
    const cre = results.find((r) => r.action === "create")!;

    expect(del.content).toBe("");
    expect(cre.content).toContain("--- a/old-name.ts");
    expect(cre.content).toContain("+++ b/new-name.ts");
    expect(
      parseDiff(cre.content, { nearbySequences: "zip" })[0].hunks,
    ).toHaveLength(1);
  });

  it("keeps hunk bodies that mimic file headers intact through parseDiff", () => {
    const [result] = unifiedDiffToActionResults(
      SQL_COMMENT_DELETION_DIFF,
      repo,
    );
    const file = parseDiff(result.content, { nearbySequences: "zip" })[0];
    const deletions = file.hunks
      .flatMap((h) => h.changes)
      .filter((c) => c.isDelete);

    // The "-- AlterTable" / "-- CreateIndex" comments are body lines, not a
    // second file: one file, and both deletions survive as content.
    expect(parseDiff(result.content).length).toBe(1);
    expect(deletions.map((c) => c.content)).toContain("-- AlterTable");
    expect(deletions.map((c) => c.content)).toContain("-- CreateIndex");
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

// ─── Content lines that mimic structural markers ──────────────────────────
//
// A removed line whose own content starts with "-- " renders as "--- ..." in
// a unified diff. SQL/Lua/Haskell comments all look like this — every Prisma
// migration in this repo opens with "-- AlterTable" — and a parser keying on
// `startsWith("--- ")` reads them as file headers.

// Deletes two "-- " SQL comments from a migration. One real file.
const SQL_COMMENT_DELETION_DIFF = `\
--- a/prisma/migrations/0001_init/migration.sql
+++ b/prisma/migrations/0001_init/migration.sql
@@ -1,5 +1,3 @@
--- AlterTable
--- CreateIndex
 ALTER TABLE "tasks" ADD COLUMN "proposal_id" TEXT;
-DROP INDEX "tasks_old_idx";
+CREATE INDEX "tasks_new_idx" ON "tasks"("proposal_id");
`;

// The pathological case: a deleted "-- " line immediately followed by an
// added "++ " line, which together mimic a --- / +++ header pair.
const ADJACENT_MARKER_LINES_DIFF = `\
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,2 @@
 # Notes
--- old bullet
+++ new marker
`;

describe("content lines that look like file headers", () => {
  it("unifiedDiffToActionResults yields one entry for the SQL migration", () => {
    const results = unifiedDiffToActionResults(
      SQL_COMMENT_DELETION_DIFF,
      "owner/repo",
    );
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe("prisma/migrations/0001_init/migration.sql");
    expect(results[0].action).toBe("modify");
  });

  it("keeps the full hunk body instead of truncating at a '--- ' content line", () => {
    const results = unifiedDiffToActionResults(
      SQL_COMMENT_DELETION_DIFF,
      "owner/repo",
    );
    // The last line of the hunk must survive collection.
    expect(results[0].content).toContain("tasks_new_idx");
    expect(results[0].content).toContain("--- AlterTable");
  });

  it("does not split a file on an adjacent '--- ' / '+++ ' content pair", () => {
    const results = unifiedDiffToActionResults(
      ADJACENT_MARKER_LINES_DIFF,
      "owner/repo",
    );
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe("notes.md");
  });
});

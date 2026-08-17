import { describe, test, expect } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { importComments } from "@/lib/docx-engine/importer/comment-importer";

const FIXTURE_DIR = join(process.cwd(), "src/__fixtures__/docx");

async function loadFixtureZip(name: string): Promise<JSZip> {
  const buf = readFileSync(join(FIXTURE_DIR, name));
  return JSZip.loadAsync(buf);
}

describe("importComments – sample-comments.docx", () => {
  test("returns 3 comments", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    expect(comments).toHaveLength(3);
  });

  test("comment 1 is authored by Carol White", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    const c1 = comments.find((c) => c.id === "1");
    expect(c1).toBeDefined();
    expect(c1!.author).toBe("Carol White");
  });

  test("comment 2 is authored by David Brown", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    const c2 = comments.find((c) => c.id === "2");
    expect(c2).toBeDefined();
    expect(c2!.author).toBe("David Brown");
  });

  test("comment 3 is authored by Carol White", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    const c3 = comments.find((c) => c.id === "3");
    expect(c3).toBeDefined();
    expect(c3!.author).toBe("Carol White");
  });

  test("comment body text is non-empty", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    for (const c of comments) {
      expect(c.body.length).toBeGreaterThan(0);
    }
  });

  test("comment 2 body mentions rate negotiation", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    const c2 = comments.find((c) => c.id === "2");
    expect(c2!.body).toContain("$6,500");
  });

  test("comment dates are ISO strings", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    for (const c of comments) {
      // Should parse as a valid date
      const d = new Date(c.date);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  test("returns empty array when word/comments.xml is absent", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const comments = await importComments(zip);
    expect(comments).toHaveLength(0);
  });

  test("all comments have non-empty ids", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const comments = await importComments(zip);
    for (const c of comments) {
      expect(c.id.length).toBeGreaterThan(0);
    }
  });
});

describe("importComments – sample-clean.docx (no comments)", () => {
  test("returns empty array", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const comments = await importComments(zip);
    expect(comments).toHaveLength(0);
  });
});

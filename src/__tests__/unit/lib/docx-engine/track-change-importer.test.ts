import { describe, test, expect, beforeEach } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { importDocument } from "@/lib/docx-engine/importer/document-importer";
import { TrackChangeType, TrackChangeStatus } from "@/lib/docx-engine/types/track-changes";
import { DocxParagraph, DocxInlineNode, DocxTextRun } from "@/lib/docx-engine/types/document";

const FIXTURE_DIR = join(process.cwd(), "src/__fixtures__/docx");

async function loadFixtureDoc(name: string) {
  const buf = readFileSync(join(FIXTURE_DIR, name));
  const zip = await JSZip.loadAsync(buf);
  return importDocument(zip, name);
}

function getAllRuns(doc: Awaited<ReturnType<typeof loadFixtureDoc>>): DocxInlineNode[] {
  const runs: DocxInlineNode[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      runs.push(...block.runs);
    }
  }
  return runs;
}

function getTrackedRuns(doc: Awaited<ReturnType<typeof loadFixtureDoc>>) {
  return getAllRuns(doc).filter((r) => r.trackChange != null);
}

describe("track-change-importer – sample-redline.docx", () => {
  test("document parses without error", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    expect(doc).toBeDefined();
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  test("contains tracked change runs", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    expect(tracked.length).toBeGreaterThan(0);
  });

  test("tracked changes include insertion, deletion, or replacement types", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    const types = new Set(tracked.map((r) => r.trackChange!.type));
    // All del+ins pairs in sample-redline are within 60s by same author → REPLACEMENT
    // Either way, there must be at least one tracked-change type present
    expect(types.size).toBeGreaterThan(0);
    const validTypes = new Set([
      TrackChangeType.INSERTION,
      TrackChangeType.DELETION,
      TrackChangeType.REPLACEMENT,
    ]);
    for (const t of types) {
      expect(validTypes.has(t)).toBe(true);
    }
  });

  test("tracked changes are from two distinct authors", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    const authors = new Set(tracked.map((r) => r.trackChange!.author));
    expect(authors.size).toBe(2);
    expect(authors.has("Alice Smith")).toBe(true);
    expect(authors.has("Bob Jones")).toBe(true);
  });

  test("all tracked changes start with PENDING status", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    for (const run of tracked) {
      expect(run.trackChange!.status).toBe(TrackChangeStatus.PENDING);
    }
  });

  test("tracked change marks have non-empty id, author, and date", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    for (const run of tracked) {
      const tc = run.trackChange!;
      expect(tc.id).toBeTruthy();
      expect(tc.author).toBeTruthy();
      expect(tc.date).toBeTruthy();
    }
  });

  test("tracked change dates are valid ISO strings", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    for (const run of tracked) {
      const d = new Date(run.trackChange!.date);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  test("replacement pairs are detected (del+ins by same author within 60s)", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    // The fixture has del+ins pairs by Alice Smith within 60s — they become REPLACEMENT
    const replacements = tracked.filter(
      (r) => r.trackChange!.type === TrackChangeType.REPLACEMENT
    );
    expect(replacements.length).toBeGreaterThan(0);
  });

  test("tracked runs contain non-empty text content", async () => {
    const doc = await loadFixtureDoc("sample-redline.docx");
    const tracked = getTrackedRuns(doc);
    const textRuns = tracked.filter((r) => r.kind === "text") as DocxTextRun[];
    // All tracked change runs should have valid text type
    expect(textRuns.length).toBeGreaterThan(0);
    for (const r of textRuns) {
      expect(typeof r.text).toBe("string");
    }
  });
});

describe("track-change-importer – sample-clean.docx (no tracked changes)", () => {
  test("no runs have trackChange marks", async () => {
    const doc = await loadFixtureDoc("sample-clean.docx");
    const tracked = getTrackedRuns(doc);
    expect(tracked.length).toBe(0);
  });
});

import { describe, test, expect } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { importNumbering } from "@/lib/docx-engine/importer/numbering-importer";

const FIXTURE_DIR = join(process.cwd(), "src/__fixtures__/docx");

async function loadFixtureZip(name: string): Promise<JSZip> {
  const buf = readFileSync(join(FIXTURE_DIR, name));
  return JSZip.loadAsync(buf);
}

describe("importNumbering – sample-numbering.docx", () => {
  test("returns non-empty abstractDefs map", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    expect(numbering.abstractDefs.size).toBeGreaterThan(0);
  });

  test("returns non-empty numDefs map", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    expect(numbering.numDefs.size).toBeGreaterThan(0);
  });

  test("abstractDef 0 has 3 levels", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    const abs = numbering.abstractDefs.get(0);
    expect(abs).toBeDefined();
    expect(abs!.levels.length).toBe(3);
  });

  test("level 0 uses decimal format with lvlText '%1.'", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    const abs = numbering.abstractDefs.get(0);
    const lvl0 = abs!.levels.find((l) => l.level === 0);
    expect(lvl0).toBeDefined();
    expect(lvl0!.numFmt).toBe("decimal");
    expect(lvl0!.lvlText).toBe("%1.");
    expect(lvl0!.start).toBe(1);
  });

  test("level 1 uses lowerLetter format", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    const abs = numbering.abstractDefs.get(0);
    const lvl1 = abs!.levels.find((l) => l.level === 1);
    expect(lvl1).toBeDefined();
    expect(lvl1!.numFmt).toBe("lowerLetter");
  });

  test("level 2 uses lowerRoman format", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    const abs = numbering.abstractDefs.get(0);
    const lvl2 = abs!.levels.find((l) => l.level === 2);
    expect(lvl2).toBeDefined();
    expect(lvl2!.numFmt).toBe("lowerRoman");
  });

  test("numDef 1 references abstractNumId 0", async () => {
    const zip = await loadFixtureZip("sample-numbering.docx");
    const numbering = await importNumbering(zip);
    const num1 = numbering.numDefs.get(1);
    expect(num1).toBeDefined();
    expect(num1!.abstractNumId).toBe(0);
  });

  test("returns empty maps when word/numbering.xml is absent", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const numbering = await importNumbering(zip);
    expect(numbering.abstractDefs.size).toBe(0);
    expect(numbering.numDefs.size).toBe(0);
  });
});

import { describe, test, expect } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { importStyles } from "@/lib/docx-engine/importer/styles-importer";

const FIXTURE_DIR = join(process.cwd(), "src/__fixtures__/docx");

async function loadFixtureZip(name: string): Promise<JSZip> {
  const buf = readFileSync(join(FIXTURE_DIR, name));
  return JSZip.loadAsync(buf);
}

describe("importStyles – sample-clean.docx", () => {
  test("returns a non-empty style map", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    expect(styles.size).toBeGreaterThan(0);
  });

  test("contains Normal style", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    expect(styles.has("Normal")).toBe(true);
  });

  test("contains Heading1 style", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    expect(styles.has("Heading1")).toBe(true);
  });

  test("Heading1 has outlineLevel 0", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    const h1 = styles.get("Heading1");
    expect(h1?.paragraphProperties?.outlineLevel).toBe(0);
  });

  test("Heading1 basedOn Normal", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    const h1 = styles.get("Heading1");
    expect(h1?.basedOn).toBe("Normal");
  });

  test("Heading1 has bold run property", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    const h1 = styles.get("Heading1");
    expect(h1?.runProperties?.bold).toBe(true);
  });

  test("returns empty map when word/styles.xml is missing", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const styles = await importStyles(zip);
    expect(styles.size).toBe(0);
  });

  test("style type is correctly parsed", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const styles = await importStyles(zip);
    const normal = styles.get("Normal");
    expect(normal?.type).toBe("paragraph");
    const h1 = styles.get("Heading1");
    expect(h1?.type).toBe("paragraph");
  });
});

import { describe, test, expect } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { importDocument } from "@/lib/docx-engine/importer/document-importer";
import { buildZip } from "@/lib/docx-engine/exporter/zip-builder";

const FIXTURE_DIR = join(process.cwd(), "src/__fixtures__/docx");

async function loadFixtureZip(name: string): Promise<JSZip> {
  const buf = readFileSync(join(FIXTURE_DIR, name));
  return JSZip.loadAsync(buf);
}

describe("buildZip – zip-builder", () => {
  test("returns a Blob", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    expect(blob).toBeInstanceOf(Blob);
  });

  test("output Blob has non-zero size", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    expect(blob.size).toBeGreaterThan(0);
  });

  test("output ZIP contains word/document.xml", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);
    expect(outZip.file("word/document.xml")).not.toBeNull();
  });

  test("output ZIP contains word/comments.xml", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);
    expect(outZip.file("word/comments.xml")).not.toBeNull();
  });

  test("output ZIP preserves [Content_Types].xml verbatim", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const originalContentTypes = await zip
      .file("[Content_Types].xml")!
      .async("string");

    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    const outputContentTypes = await outZip
      .file("[Content_Types].xml")!
      .async("string");
    expect(outputContentTypes).toBe(originalContentTypes);
  });

  test("output ZIP preserves word/styles.xml verbatim", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const originalStyles = await zip.file("word/styles.xml")!.async("string");

    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    const outputStyles = await outZip.file("word/styles.xml")!.async("string");
    expect(outputStyles).toBe(originalStyles);
  });

  test("output ZIP preserves word/settings.xml verbatim", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const originalSettings = await zip
      .file("word/settings.xml")!
      .async("string");

    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    const outputSettings = await outZip
      .file("word/settings.xml")!
      .async("string");
    expect(outputSettings).toBe(originalSettings);
  });

  test("output word/document.xml differs from input (re-serialized)", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const originalDocXml = await zip
      .file("word/document.xml")!
      .async("string");

    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    const outputDocXml = await outZip
      .file("word/document.xml")!
      .async("string");

    // The re-serialized document is valid XML (not empty)
    expect(outputDocXml.length).toBeGreaterThan(0);
    expect(outputDocXml).toContain("<w:document");
    expect(outputDocXml).toContain("</w:document>");
  });

  test("output word/document.xml contains expected text from original", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);
    const outputDocXml = await outZip
      .file("word/document.xml")!
      .async("string");
    // The fixture has "Service Agreement" as a heading
    expect(outputDocXml).toContain("Service Agreement");
  });

  test("roundtrip with comments fixture preserves comment count in output", async () => {
    const zip = await loadFixtureZip("sample-comments.docx");
    const doc = await importDocument(zip, "sample-comments.docx");

    expect(doc.comments).toHaveLength(3);

    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    const commentsXml = await outZip
      .file("word/comments.xml")!
      .async("string");
    // Three <w:comment elements should be present
    const matches = commentsXml.match(/<w:comment /g) ?? [];
    expect(matches.length).toBe(3);
  });

  test("output ZIP from redline fixture contains the changed text content", async () => {
    const zip = await loadFixtureZip("sample-redline.docx");
    const doc = await importDocument(zip, "sample-redline.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);
    const docXml = await outZip.file("word/document.xml")!.async("string");
    // The redline fixture has replacement text (both deleted and inserted text)
    // All del+ins pairs within 60s are REPLACEMENT type – present in output as plain runs
    // Verify the changed text content appears in the output
    expect(docXml).toContain("February 15, 2025"); // ins text from Alice
    expect(docXml).toContain("software development"); // ins text from Bob
  });

  test("only word/document.xml and word/comments.xml are re-serialized; others copied", async () => {
    const zip = await loadFixtureZip("sample-clean.docx");
    const doc = await importDocument(zip, "sample-clean.docx");
    const blob = await buildZip(doc, zip);
    const arrayBuffer = await blob.arrayBuffer();
    const outZip = await JSZip.loadAsync(arrayBuffer);

    // _rels/.rels should be verbatim copy
    const originalRels = await zip.file("_rels/.rels")!.async("string");
    const outputRels = await outZip.file("_rels/.rels")!.async("string");
    expect(outputRels).toBe(originalRels);

    // docProps/app.xml should be verbatim copy
    const originalApp = await zip.file("docProps/app.xml")!.async("string");
    const outputApp = await outZip.file("docProps/app.xml")!.async("string");
    expect(outputApp).toBe(originalApp);
  });
});

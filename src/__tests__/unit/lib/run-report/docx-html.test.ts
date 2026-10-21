import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxToHtml } from "@/lib/run-report/docx-html";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

const p = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("docxToHtml", () => {
  it("reads headings, paragraphs and tables, with tracked changes accepted", async () => {
    const out = await docxToHtml(
      await docx(
        p("Memorandum", "Title") +
          p("A.  Executive Summary", "Heading1") +
          `<w:p><w:r><w:t>Excess is </w:t></w:r><w:ins><w:r><w:t>$1,100,000</w:t></w:r></w:ins><w:del><w:r><w:delText>$100,000</w:delText></w:r></w:del><w:r><w:tab/><w:t>&amp; more</w:t><w:br/><w:t>&lt;b&gt;</w:t></w:r></w:p>` +
          p("   ") +
          `<w:tbl><w:tblPr/><w:tr><w:tc>${p("To")}</w:tc><w:tc>${p("Margaret Yun")}${p("PCTH")}</w:tc></w:tr></w:tbl>` +
          `<w:sdt><w:sdtContent>${p("In a content control")}</w:sdtContent></w:sdt>`,
      ),
    );
    expect(out).not.toBeNull();
    expect(out!.html.split("\n")).toEqual([
      "<h1>Memorandum</h1>",
      "<h1>A.  Executive Summary</h1>",
      "<p>Excess is $1,100,000\t&amp; more<br>&lt;b&gt;</p>",
      "<table><tbody><tr><td>To</td><td>Margaret Yun<br>PCTH</td></tr></tbody></table>",
      "<p>In a content control</p>",
    ]);
    expect(out!.text).toBe(
      ["Memorandum", "A.  Executive Summary", "Excess is $1,100,000\t& more\n<b>", "To | Margaret Yun\nPCTH", "In a content control"].join("\n"),
    );
  });

  it("is null for anything that is not a .docx", async () => {
    expect(await docxToHtml(new TextEncoder().encode("not a zip"))).toBeNull();
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    expect(await docxToHtml(await zip.generateAsync({ type: "uint8array" }))).toBeNull();
  });
});

/**
 * Generates DOCX fixture files for the docx-engine tests.
 * Run with: node scripts/generate-docx-fixtures.mjs
 */

import JSZip from "jszip";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../src/__fixtures__/docx");

mkdirSync(FIXTURES_DIR, { recursive: true });

// ─── Shared OOXML namespace declaration ──────────────────────────────────────

const W_NS =
  `xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
  `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
  `xmlns:v="urn:schemas-microsoft-com:vml" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
  `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
  `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
  `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
  `mc:Ignorable="w14"`;

// ─── Shared ZIP builder ───────────────────────────────────────────────────────

function buildContentTypes(hasComments = false) {
  const commentsOverride = hasComments
    ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  ${commentsOverride}
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/package/2006/metadata/core-properties+xml"/>
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

function buildDocRels(hasComments = false, hasNumbering = false) {
  const commentsRel = hasComments
    ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`
    : "";
  const numberingRel = hasNumbering
    ? `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  ${commentsRel}
  ${numberingRel}
</Relationships>`;
}

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

const FONT_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri"/>
  <w:font w:name="Times New Roman"/>
</w:fonts>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Word</Application>
</Properties>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:creator>Test Author</dc:creator>
</cp:coreProperties>`;

function buildStyles(extraStyles = "") {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS} w:docDefaults="">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  ${extraStyles}
</w:styles>`;
}

async function makeZip(files) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// ─── 1. sample-clean.docx ─────────────────────────────────────────────────────

const CLEAN_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Service Agreement</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement is entered into as of January 1, 2025.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>1. Services</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Provider shall deliver consulting services to Client.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>2. Payment</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Client shall pay Provider a monthly fee of $5,000.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>3. Term</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement shall remain in effect for one (1) year.</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const cleanZipBuf = await makeZip({
  "[Content_Types].xml": buildContentTypes(false),
  "_rels/.rels": ROOT_RELS,
  "word/document.xml": CLEAN_DOCUMENT_XML,
  "word/_rels/document.xml.rels": buildDocRels(false),
  "word/styles.xml": buildStyles(),
  "word/settings.xml": SETTINGS_XML,
  "word/fontTable.xml": FONT_TABLE_XML,
  "docProps/app.xml": APP_XML,
  "docProps/core.xml": CORE_XML,
});
writeFileSync(join(FIXTURES_DIR, "sample-clean.docx"), cleanZipBuf);
console.log("✓ sample-clean.docx");

// ─── 2. sample-redline.docx ───────────────────────────────────────────────────

const REDLINE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Service Agreement</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement is entered into as of </w:t></w:r>
      <w:del w:id="1" w:author="Alice Smith" w:date="2025-03-01T10:00:00Z">
        <w:r><w:delText>January 1, 2025</w:delText></w:r>
      </w:del>
      <w:ins w:id="2" w:author="Alice Smith" w:date="2025-03-01T10:00:30Z">
        <w:r><w:t>February 15, 2025</w:t></w:r>
      </w:ins>
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>1. Services</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Provider shall deliver </w:t></w:r>
      <w:del w:id="3" w:author="Bob Jones" w:date="2025-03-02T09:00:00Z">
        <w:r><w:delText>consulting</w:delText></w:r>
      </w:del>
      <w:ins w:id="4" w:author="Bob Jones" w:date="2025-03-02T09:00:45Z">
        <w:r><w:t>software development</w:t></w:r>
      </w:ins>
      <w:r><w:t xml:space="preserve"> services to Client.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>2. Payment</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Client shall pay Provider a monthly fee of </w:t></w:r>
      <w:del w:id="5" w:author="Alice Smith" w:date="2025-03-01T11:00:00Z">
        <w:r><w:delText>$5,000</w:delText></w:r>
      </w:del>
      <w:ins w:id="6" w:author="Alice Smith" w:date="2025-03-01T11:00:20Z">
        <w:r><w:t>$7,500</w:t></w:r>
      </w:ins>
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>3. Term</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement shall remain in effect for </w:t></w:r>
      <w:ins w:id="7" w:author="Bob Jones" w:date="2025-03-02T10:00:00Z">
        <w:r><w:t xml:space="preserve">two (2) </w:t></w:r>
      </w:ins>
      <w:del w:id="8" w:author="Bob Jones" w:date="2025-03-02T10:00:10Z">
        <w:r><w:delText>one (1) </w:delText></w:r>
      </w:del>
      <w:r><w:t>year.</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const redlineZipBuf = await makeZip({
  "[Content_Types].xml": buildContentTypes(false),
  "_rels/.rels": ROOT_RELS,
  "word/document.xml": REDLINE_DOCUMENT_XML,
  "word/_rels/document.xml.rels": buildDocRels(false),
  "word/styles.xml": buildStyles(),
  "word/settings.xml": SETTINGS_XML,
  "word/fontTable.xml": FONT_TABLE_XML,
  "docProps/app.xml": APP_XML,
  "docProps/core.xml": CORE_XML,
});
writeFileSync(join(FIXTURES_DIR, "sample-redline.docx"), redlineZipBuf);
console.log("✓ sample-redline.docx");

// ─── 3. sample-comments.docx ─────────────────────────────────────────────────

const COMMENTS_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Service Agreement</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement is entered into as of January 1, 2025.</w:t></w:r>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="0" w:name="_cmnt1"/>
      <w:r><w:t xml:space="preserve">Provider shall deliver consulting services</w:t></w:r>
      <w:commentRangeEnd w:id="1"/>
      <w:r>
        <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
        <w:commentReference w:id="1"/>
      </w:r>
      <w:r><w:t xml:space="preserve"> to Client under this agreement.</w:t></w:r>
      <w:bookmarkEnd w:id="0"/>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="2" w:name="_cmnt2"/>
      <w:r><w:t xml:space="preserve">Client shall pay </w:t></w:r>
      <w:r><w:t>$5,000</w:t></w:r>
      <w:commentRangeEnd w:id="2"/>
      <w:r>
        <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
        <w:commentReference w:id="2"/>
      </w:r>
      <w:r><w:t xml:space="preserve"> per month.</w:t></w:r>
      <w:bookmarkEnd w:id="2"/>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">This agreement expires on December 31, 2025.</w:t></w:r>
      <w:commentRangeEnd w:id="3"/>
      <w:r>
        <w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
        <w:commentReference w:id="3"/>
      </w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const COMMENTS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W_NS}>
  <w:comment w:id="1" w:author="Carol White" w:date="2025-03-05T14:00:00Z">
    <w:p><w:r><w:t>Please clarify the scope of consulting services.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="2" w:author="David Brown" w:date="2025-03-06T09:30:00Z">
    <w:p><w:r><w:t>This rate seems low. Should we negotiate to $6,500?</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="3" w:author="Carol White" w:date="2025-03-05T15:00:00Z">
    <w:p><w:r><w:t>Confirm renewal terms before finalising.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

const commentsZipBuf = await makeZip({
  "[Content_Types].xml": buildContentTypes(true),
  "_rels/.rels": ROOT_RELS,
  "word/document.xml": COMMENTS_DOCUMENT_XML,
  "word/comments.xml": COMMENTS_XML,
  "word/_rels/document.xml.rels": buildDocRels(true),
  "word/styles.xml": buildStyles(),
  "word/settings.xml": SETTINGS_XML,
  "word/fontTable.xml": FONT_TABLE_XML,
  "docProps/app.xml": APP_XML,
  "docProps/core.xml": CORE_XML,
});
writeFileSync(join(FIXTURES_DIR, "sample-comments.docx"), commentsZipBuf);
console.log("✓ sample-comments.docx");

// ─── 4. sample-numbering.docx ─────────────────────────────────────────────────

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;

const NUMBERING_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>First item</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>Second item</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>Sub-item a</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:t>Sub-item b</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const numberingZipBuf = await makeZip({
  "[Content_Types].xml": buildContentTypes(false),
  "_rels/.rels": ROOT_RELS,
  "word/document.xml": NUMBERING_DOCUMENT_XML,
  "word/numbering.xml": NUMBERING_XML,
  "word/_rels/document.xml.rels": buildDocRels(false, true),
  "word/styles.xml": buildStyles(),
  "word/settings.xml": SETTINGS_XML,
  "word/fontTable.xml": FONT_TABLE_XML,
  "docProps/app.xml": APP_XML,
  "docProps/core.xml": CORE_XML,
});
writeFileSync(join(FIXTURES_DIR, "sample-numbering.docx"), numberingZipBuf);
console.log("✓ sample-numbering.docx");

console.log("\nAll fixtures generated in src/__fixtures__/docx/");

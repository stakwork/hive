import { describe, it, expect } from "vitest";
import {
  buildArtifactPdf,
  buildMarkdownPdf,
  buildTextPdf,
} from "@/app/org/[githubLogin]/_components/artifacts/artifactPdfBuild";

describe("buildTextPdf", () => {
  it("fits short text on one page", async () => {
    const pdf = await buildTextPdf("t", "hello\nworld");
    expect(pdf.getNumberOfPages()).toBe(1);
  });
  it("paginates long text", async () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const pdf = await buildTextPdf("t", text);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(2);
  });
  it("wraps very long lines onto more lines", async () => {
    const one = await buildTextPdf("t", "x".repeat(50));
    const wide = await buildTextPdf("t", ("word ".repeat(2000)).trim());
    expect(one.getNumberOfPages()).toBe(1);
    expect(wide.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe("buildMarkdownPdf", () => {
  it("paginates a long document", async () => {
    const md = Array.from({ length: 80 }, (_, i) => `## Section ${i}\n\n- item **bold**\n\nParagraph with [link](http://x.y).`).join("\n\n");
    const pdf = await buildMarkdownPdf("t", md);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe("buildArtifactPdf", () => {
  it("returns a pdf blob for text", async () => {
    const blob = await buildArtifactPdf({ mode: "text", title: "t", text: "hi" });
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(100);
  });
});

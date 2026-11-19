import { describe, it, expect } from "vitest";
import { pdfFilename, pdfModeOf, supportsPdf } from "@/app/org/[githubLogin]/_components/artifacts/artifactPdf";

describe("supportsPdf", () => {
  it.each(["html", "markdown", "image", "code", "json", "log", "diff"] as const)("supports %s", (k) => {
    expect(supportsPdf(k)).toBe(true);
  });
  it.each(["video", "audio", "url", "app", "pdf", "graph", "pull_request", "claims"] as const)("hides %s", (k) => {
    expect(supportsPdf(k)).toBe(false);
    expect(pdfModeOf(k)).toBeNull();
  });
  it("maps modes", () => {
    expect(pdfModeOf("html")).toBe("html");
    expect(pdfModeOf("log")).toBe("text");
    expect(pdfModeOf("markdown")).toBe("markdown");
  });
});

describe("pdfFilename", () => {
  it("sanitizes unsafe characters", () => expect(pdfFilename('a/b:c*d?"e<f>g|h')).toBe("a-b-c-d-e-f-g-h.pdf"));
  it("falls back to artifact", () => {
    expect(pdfFilename("   ")).toBe("artifact.pdf");
    expect(pdfFilename("")).toBe("artifact.pdf");
  });
  it("does not double the extension", () => expect(pdfFilename("report.pdf")).toBe("report.pdf"));
  it("keeps other dots", () => expect(pdfFilename("v1.2 notes")).toBe("v1.2 notes.pdf"));
});

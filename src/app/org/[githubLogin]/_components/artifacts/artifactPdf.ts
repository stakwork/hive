import type { ArtifactKind } from "../../_state/canvasChatArtifacts";

/** How each kind becomes a PDF; absent kinds have no sensible PDF (video, audio, url, app, pdf, graph, pull request…). */
export type PdfMode = "text" | "markdown" | "image" | "html";

const PDF_MODES: Partial<Record<ArtifactKind, PdfMode>> = {
  html: "html",
  markdown: "markdown",
  image: "image",
  code: "text",
  json: "text",
  log: "text",
  diff: "text",
};

export function pdfModeOf(kind: ArtifactKind): PdfMode | null {
  return PDF_MODES[kind] ?? null;
}

/** Whether "Download PDF" is offered for this kind. */
export function supportsPdf(kind: ArtifactKind): boolean {
  return pdfModeOf(kind) !== null;
}

/** The PDF's file name: the title made safe like `downloadOf` does, plus `.pdf`. */
export function pdfFilename(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "artifact";
  return `${safe.replace(/\.pdf$/i, "") || "artifact"}.pdf`;
}

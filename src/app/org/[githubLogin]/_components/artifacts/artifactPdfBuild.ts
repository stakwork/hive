import type { jsPDF } from "jspdf";
import { htmlArtifactProxyUrl, type HtmlArtifactSource } from "@/lib/utils/html-body-proxy";
import { injectHtmlArtifactCsp, HTML_ARTIFACT_CSP } from "@/lib/utils/html-artifact-csp";
import {
  capturePlan,
  chunkIndexOf,
  injectSnapshotScript,
  pageRanges,
  parseSnapshotMessage,
  SNAPSHOT_REQUEST,
  type Snapshot,
} from "./artifactPdfLayout";

/**
 * Builds the PDF for an artifact, client-side. Only ever imported
 * dynamically, so jspdf and html2canvas stay out of the initial bundle.
 */

const MARGIN = 15; // mm
const PAGE_W = 210;
const PAGE_H = 297;

async function newPdf(orientation: "p" | "l" = "p"): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  return new jsPDF(orientation, "mm", "a4");
}

interface Cursor {
  pdf: jsPDF;
  y: number;
}

function ensureRoom(c: Cursor, height: number) {
  if (c.y + height > PAGE_H - MARGIN) {
    c.pdf.addPage();
    c.y = MARGIN;
  }
}

/** Writes wrapped lines, breaking onto new pages as needed. */
function writeWrapped(c: Cursor, text: string, size: number, font: "courier" | "helvetica", style: "normal" | "bold" | "italic", indent = 0) {
  const { pdf } = c;
  pdf.setFont(font, style);
  pdf.setFontSize(size);
  const lineH = size * 0.3528 * 1.35;
  const width = PAGE_W - MARGIN * 2 - indent;
  for (const raw of text.split("\n")) {
    const lines: string[] = raw === "" ? [""] : pdf.splitTextToSize(raw.replace(/\t/g, "    "), width);
    for (const line of lines) {
      ensureRoom(c, lineH);
      if (line) pdf.text(line, MARGIN + indent, c.y + lineH * 0.8);
      c.y += lineH;
    }
  }
}

/** Monospace text (code, JSON, logs, diffs) with a title, wrapped and paginated. */
export async function buildTextPdf(title: string, text: string): Promise<jsPDF> {
  const pdf = await newPdf();
  const c: Cursor = { pdf, y: MARGIN };
  writeWrapped(c, title, 14, "helvetica", "bold");
  c.y += 3;
  pdf.setTextColor(30, 30, 30);
  writeWrapped(c, text, 8, "courier", "normal");
  return pdf;
}

const stripInline = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/~~(.*?)~~/g, "$1");

/** A readable text layout of markdown: headings, lists, quotes, code blocks, rules. */
export async function buildMarkdownPdf(title: string, markdown: string): Promise<jsPDF> {
  const pdf = await newPdf();
  const c: Cursor = { pdf, y: MARGIN };
  const sizes = [20, 16, 13, 12, 11, 11];
  let inCode = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      c.y += 1;
      continue;
    }
    if (inCode) {
      writeWrapped(c, line, 8.5, "courier", "normal", 3);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      c.y += 3;
      ensureRoom(c, 14);
      writeWrapped(c, stripInline(heading[2]), sizes[heading[1].length - 1], "helvetica", "bold");
      c.y += 1;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      ensureRoom(c, 4);
      pdf.setDrawColor(180);
      pdf.line(MARGIN, c.y + 2, PAGE_W - MARGIN, c.y + 2);
      c.y += 4;
    } else if (/^\s*[-*+]\s+/.test(line)) {
      const depth = Math.floor((/^\s*/.exec(line)![0].length) / 2);
      writeWrapped(c, `\u2022 ${stripInline(line.replace(/^\s*[-*+]\s+/, ""))}`, 10.5, "helvetica", "normal", 4 + depth * 5);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      writeWrapped(c, stripInline(line.trim()), 10.5, "helvetica", "normal", 4);
    } else if (/^\s*>/.test(line)) {
      writeWrapped(c, stripInline(line.replace(/^\s*>\s?/, "")), 10.5, "helvetica", "italic", 6);
    } else if (/^\s*\|/.test(line)) {
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) writeWrapped(c, stripInline(line.trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim()).join("  |  ")), 9.5, "helvetica", "normal");
    } else if (line.trim() === "") {
      c.y += 2.5;
    } else {
      writeWrapped(c, stripInline(line), 10.5, "helvetica", "normal");
    }
  }
  pdf.setProperties({ title });
  return pdf;
}

async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** One image, scaled to fit within a single page (landscape when it is wide). */
export async function buildImagePdf(url: string): Promise<jsPDF> {
  const dataUrl = await toDataUrl(url);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image failed to load"));
    el.src = dataUrl;
  });
  // Re-encode so any format the browser can draw (webp, svg, gif) becomes one jspdf accepts.
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const landscape = canvas.width > canvas.height;
  const pdf = await newPdf(landscape ? "l" : "p");
  const pw = landscape ? PAGE_H : PAGE_W;
  const ph = landscape ? PAGE_W : PAGE_H;
  const scale = Math.min((pw - MARGIN * 2) / canvas.width, (ph - MARGIN * 2) / canvas.height);
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
  return pdf;
}

const HTML_WIDTH = 1024;

/**
 * The page as a static, script-less document for html2canvas. The viewer CSP has
 * `frame-src 'none'` / `default-src 'none'`, which blocks the scratch iframe html2canvas
 * clones the page into — so the capture frame gets the same policy minus that, with
 * scripts off entirely (the frame is also sandboxed without allow-scripts).
 */
const CAPTURE_CSP = HTML_ARTIFACT_CSP.split("; ")
  .filter((d) => !d.startsWith("frame-src") && !d.startsWith("script-src"))
  .concat("script-src 'none'", "frame-src about: blob: data:")
  .join("; ");

function toCaptureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll('meta[http-equiv]').forEach((m) => {
    if (/content-security-policy/i.test(m.getAttribute("http-equiv") ?? "")) m.remove();
  });
  doc.querySelectorAll("script").forEach((el) => el.remove());
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", CAPTURE_CSP);
  doc.head.insertBefore(meta, doc.head.firstChild);
  const dt = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "";
  return dt + doc.documentElement.outerHTML;
}
const SNAPSHOT_TIMEOUT_MS = 15_000;
const SNAPSHOT_NUDGE_MS = 8_000;

const makeNonce = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

function offscreenFrame(sandbox: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", sandbox);
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${HTML_WIDTH}px;height:800px;border:0;visibility:hidden;`;
  return frame;
}

function loadFrame(frame: HTMLIFrameElement, url: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Page timed out")), timeoutMs);
    frame.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

/**
 * Runs the page's scripts in a frame that is sandboxed exactly like the viewer's
 * (`allow-scripts` only, opaque origin) and gets its rendered DOM back as a static
 * snapshot by message. Null when it does not answer in time.
 */
async function snapshotRenderedPage(html: string): Promise<Snapshot | null> {
  const nonce = makeNonce();
  const url = URL.createObjectURL(new Blob([injectSnapshotScript(html, nonce)], { type: "text/html; charset=utf-8" }));
  const frame = offscreenFrame("allow-scripts");
  let onMessage: ((e: MessageEvent) => void) | null = null;
  let nudge: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = new Promise<Snapshot | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS);
      onMessage = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow) return;
        const parsed = parseSnapshotMessage(e.data, nonce);
        if (!parsed) return;
        clearTimeout(timer);
        resolve(parsed);
      };
      window.addEventListener("message", onMessage);
    });
    await loadFrame(frame, url, SNAPSHOT_TIMEOUT_MS).catch(() => undefined);
    nudge = setTimeout(
      () => frame.contentWindow?.postMessage({ type: SNAPSHOT_REQUEST, nonce }, "*"),
      SNAPSHOT_NUDGE_MS,
    );
    return await snapshot;
  } finally {
    clearTimeout(nudge);
    if (onMessage) window.removeEventListener("message", onMessage);
    frame.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * A page as a PDF, in two frames. The page is untrusted, so its scripts run only in a
 * frame with `sandbox="allow-scripts"` and an opaque origin (never together with
 * `allow-same-origin`, which would let it lift its own sandbox); that frame posts back the
 * DOM it rendered. The snapshot — static, scripts removed, CSP re-injected — is then
 * drawn in a same-origin, script-less frame 1024px wide, which html2canvas can read. It is
 * captured in vertical chunks at a readable scale and cut into A4 pages. If the page does
 * not answer in time, the page as fetched is captured instead. Both frames are removed.
 */
export async function buildHtmlPdf(source: HtmlArtifactSource): Promise<jsPDF> {
  const res = await fetch(htmlArtifactProxyUrl(source), { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`Page ${res.status}`);
  const fetched = injectHtmlArtifactCsp(await res.text());
  const snapshot = await snapshotRenderedPage(fetched).catch(() => null);
  return buildPdfFromStaticHtml(snapshot ? snapshot.html : fetched);
}

async function buildPdfFromStaticHtml(html: string): Promise<jsPDF> {
  const staticHtml = toCaptureHtml(html);

  const blobUrl = URL.createObjectURL(new Blob([staticHtml], { type: "text/html; charset=utf-8" }));
  const frame = offscreenFrame("allow-same-origin");
  try {
    await loadFrame(frame, blobUrl, 20_000);
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Page not readable");
    await doc.fonts?.ready?.catch(() => undefined);
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete
          ? undefined
          : new Promise<void>((r) => {
              img.onload = img.onerror = () => r();
              setTimeout(r, 5000);
            }),
      ),
    );
    // Capture the frame's own document, never the Hive UI around it.
    const root = doc.documentElement;
    // Let the frame grow to the whole page so nothing is clipped by the viewport.
    frame.style.height = `${Math.max(root.scrollHeight, doc.body.scrollHeight)}px`;
    await new Promise((r) => setTimeout(r, 100));
    const height = Math.max(root.scrollHeight, doc.body.scrollHeight);

    const { default: html2canvas } = await import("html2canvas");
    const plan = capturePlan(height, HTML_WIDTH);
    const pages = pageRanges(height, HTML_WIDTH);
    const pdf = await newPdf();
    let chunkCanvas: HTMLCanvasElement | null = null;
    let chunkAt = -1;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const ci = chunkIndexOf(plan, page);
      if (ci !== chunkAt) {
        const chunk = plan.chunks[ci];
        chunkCanvas = await html2canvas(root, {
          backgroundColor: "#ffffff",
          scale: plan.scale,
          x: 0,
          y: chunk.top,
          width: HTML_WIDTH,
          height: chunk.height,
          windowWidth: HTML_WIDTH,
          windowHeight: height,
          useCORS: true,
          allowTaint: true,
          logging: false,
        });
        chunkAt = ci;
      }
      const src = chunkCanvas!;
      const sy = Math.round((page.top - plan.chunks[ci].top) * plan.scale);
      const sh = Math.max(1, Math.min(src.height - sy, Math.round(page.height * plan.scale)));
      const slice = document.createElement("canvas");
      slice.width = src.width;
      slice.height = sh;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("No canvas");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, slice.width, sh);
      ctx.drawImage(src, 0, sy, src.width, sh, 0, 0, src.width, sh);
      if (i > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PAGE_W, (sh * PAGE_W) / src.width);
    }
    return pdf;
  } finally {
    frame.remove();
    URL.revokeObjectURL(blobUrl);
  }
}

export interface PdfInput {
  mode: "text" | "markdown" | "image" | "html";
  title: string;
  /** Text for text/markdown modes. */
  text?: string;
  /** Image address. */
  url?: string;
  htmlSource?: HtmlArtifactSource;
}

/** Builds the PDF and returns it as a Blob. */
export async function buildArtifactPdf(input: PdfInput): Promise<Blob> {
  let pdf: jsPDF;
  switch (input.mode) {
    case "text":
      pdf = await buildTextPdf(input.title, input.text ?? "");
      break;
    case "markdown":
      pdf = await buildMarkdownPdf(input.title, input.text ?? "");
      break;
    case "image":
      if (!input.url) throw new Error("No image");
      pdf = await buildImagePdf(input.url);
      break;
    case "html":
      if (!input.htmlSource) throw new Error("No page");
      pdf = await buildHtmlPdf(input.htmlSource);
      break;
  }
  return pdf.output("blob");
}

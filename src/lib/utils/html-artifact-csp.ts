/**
 * Content Security Policy for stored HTML pages rendered by
 * `HtmlArtifactFrame`.
 *
 * The iframe sandbox (`allow-scripts` without `allow-same-origin`) is the
 * primary boundary: the page runs in an opaque origin and can never reach
 * Hive's cookies, storage, DOM, or top-level navigation. This policy is the
 * second layer. It decides where that sandboxed page may pull code and
 * assets *from*, and what it may talk *to*:
 *
 *   - scripts, styles, fonts, and runtime fetches only from a fixed CDN
 *     allowlist (plus inline, which model-generated pages always use);
 *   - `connect-src` is capped to the same CDNs so a page can't fetch
 *     arbitrary code from elsewhere and `eval` it around `script-src`;
 *   - no forms, nested frames, plugins, or `<base>` rewriting.
 *
 * Images and media may load from any https host. That is a one-way side
 * channel (a script could encode data into an image URL), accepted because
 * the frame holds no secrets: the only content inside it is the page's own
 * markup, which org members can already read.
 *
 * Hive sets no document-level CSP of its own, so nothing is inherited by
 * the blob document; this meta tag is the whole policy. It is delivered as
 * `<meta http-equiv>` because a blob: document has no HTTP headers. Meta
 * delivery cannot carry `frame-ancestors`, `sandbox`, or `report-uri`,
 * none of which are needed here.
 */

/** Hosts a page may load scripts, styles, fonts, and workers from. */
export const HTML_ARTIFACT_CDN_HOSTS = [
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
] as const;

const CDNS = HTML_ARTIFACT_CDN_HOSTS.join(" ");

export const HTML_ARTIFACT_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS}`,
  `style-src 'unsafe-inline' https://fonts.googleapis.com ${CDNS}`,
  `font-src data: https://fonts.gstatic.com ${CDNS}`,
  "img-src https: data: blob:",
  "media-src https: data: blob:",
  `connect-src ${CDNS}`,
  `worker-src blob: ${CDNS}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function serializeDoctype(doctype: DocumentType | null): string {
  if (!doctype) return "";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${doctype.publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

/**
 * Return `html` with the policy above as the first child of `<head>`.
 *
 * The document is parsed with `DOMParser`, which never executes scripts
 * or loads subresources, so this is safe to run on untrusted markup. Going
 * through a real parser (rather than string-splicing on `<head>`) means
 * the meta tag always lands in the real head element, even when the page
 * omits `<head>`, opens with a comment, or mentions `<head>` inside a
 * comment or attribute. Because it is the first thing in head, every
 * later element is subject to it. A page's own CSP meta tags are kept;
 * multiple policies only ever combine restrictively.
 *
 * The original doctype is preserved (or left absent) so standards/quirks
 * mode is unchanged by the rewrite.
 */
export function injectHtmlArtifactCsp(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", HTML_ARTIFACT_CSP);
  doc.head.insertBefore(meta, doc.head.firstChild);
  return serializeDoctype(doc.doctype) + doc.documentElement.outerHTML;
}

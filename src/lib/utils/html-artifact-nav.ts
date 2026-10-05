/**
 * Navigation bridge for stored HTML pages rendered by `HtmlArtifactFrame`.
 *
 * The page runs in a sandboxed iframe with an opaque origin and no
 * `allow-top-navigation`, so a click on an internal relative link such as
 * `/org/acme/h/page` would try to load it inside the blob frame and show a
 * white screen. Instead, a tiny inline script posts the path to the parent,
 * which validates the sender and the path (`isAllowedArtifactNavPath`) and
 * navigates with the Next.js router. The sandbox and CSP are unchanged.
 */

export const HTML_ARTIFACT_NAV_MESSAGE_TYPE = "hive-artifact-navigate";

const ALLOWED_PREFIXES = ["/org/", "/w/"];

/**
 * True only for a same-app path with no scheme: starts with `/org/` or
 * `/w/`, is not protocol-relative, and has no backslash, whitespace,
 * control characters, or `:` before the first `/` after the leading slash.
 */
export function isAllowedArtifactNavPath(href: unknown): href is string {
  if (typeof href !== "string") return false;
  if (!ALLOWED_PREFIXES.some((p) => href.startsWith(p))) return false;
  if (href.startsWith("//")) return false;
  if (href.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(href)) return false;
  const rest = href.slice(1);
  const slash = rest.indexOf("/");
  const firstSegment = slash === -1 ? rest : rest.slice(0, slash);
  if (firstSegment.includes(":")) return false;
  return true;
}

const NAV_BRIDGE_SCRIPT = `
document.addEventListener('click', function (event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  var target = event.target;
  var anchor = target && target.closest ? target.closest('a[href]') : null;
  if (!anchor) return;
  var href = anchor.getAttribute('href');
  if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
  event.preventDefault();
  window.parent.postMessage({ type: ${JSON.stringify(HTML_ARTIFACT_NAV_MESSAGE_TYPE)}, href: href }, '*');
}, true);
`;

function serializeDoctype(doctype: DocumentType | null): string {
  if (!doctype) return "";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${doctype.publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

/**
 * Return `html` with the click-forwarding script at the end of `<body>`.
 *
 * Parsed with `DOMParser` (no script execution, no subresource loads), like
 * `injectHtmlArtifactCsp`. The target origin is `"*"` because the frame's
 * origin is opaque; the parent checks `event.source` and the path instead.
 * The original doctype is preserved.
 */
export function injectHtmlArtifactNavBridge(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.createElement("script");
  script.textContent = NAV_BRIDGE_SCRIPT;
  // DOMParser always synthesizes a <body>, so this also covers pages
  // that omit it.
  (doc.body ?? doc.documentElement).appendChild(script);
  return serializeDoctype(doc.doctype) + doc.documentElement.outerHTML;
}

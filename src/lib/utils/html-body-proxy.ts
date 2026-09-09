/**
 * Response headers for the HTML page body proxies.
 *
 * The bytes are served as an opaque download, never as `text/html`: a
 * cookie-authenticated HTML response on Hive's own origin would be stored
 * XSS the moment it is navigated to or used as an iframe `src`.
 * `HtmlArtifactFrame` is the only intended consumer — it fetches with
 * credentials and renders the bytes from a blob URL in a locked sandbox.
 */
export function htmlBodyProxyHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": "attachment",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "private, no-store",
  };
}

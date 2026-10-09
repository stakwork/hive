/**
 * Shared helpers for the HTML page body proxies.
 *
 * The bytes are served as an opaque download, never as `text/html`: a
 * cookie-authenticated HTML response on Hive's own origin would be stored
 * XSS the moment it is navigated to or used as an iframe `src`. There are
 * exactly two intended consumers:
 *
 *   - `HtmlArtifactFrame`, which fetches with credentials and renders the
 *     bytes from a blob URL in a locked sandbox, and
 *   - the share page's Download link, a same-origin `<a download>` pointing
 *     at the proxy. Because the response is `attachment` + `octet-stream`
 *     + `nosniff`, following that link saves a file and never renders.
 *
 * The one exception is a page a strut job wrote, read through the strut
 * artifact reader (`api/orgs/[githubLogin]/strut/artifacts`): that route
 * also serves images and PDFs, so it answers with the file's own type —
 * under strut's `Content-Security-Policy: sandbox`, so a navigation to it
 * renders a static page in an opaque origin, never script on Hive's
 * origin. The frame never navigates to it either way: it fetches the bytes
 * and renders them from a blob.
 */

import { strutArtifactReaderUrl } from "@/lib/strut-jobs";

/**
 * Three address shapes — never a raw `s3Key`, never a URL. The third is a
 * page a strut job wrote on a swarm: `key` is strut's own link to the file
 * (`/jobs/<job>/files/<path>`), which the reader checks against Hive's rows
 * before asking the swarm.
 */
export type HtmlArtifactSource =
  | { githubLogin: string; slug: string }
  | { taskId: string; artifactId: string }
  | { githubLogin: string; swarmId: string; key: string };

/** Same-origin path of the authenticated body proxy for a page. */
export function htmlArtifactProxyUrl(source: HtmlArtifactSource): string {
  if ("swarmId" in source) return strutArtifactReaderUrl(source.githubLogin, source.swarmId, source.key);
  if ("githubLogin" in source) {
    return `/api/orgs/${encodeURIComponent(source.githubLogin)}/html-pages/${encodeURIComponent(source.slug)}`;
  }
  return `/api/tasks/${encodeURIComponent(source.taskId)}/artifacts/${encodeURIComponent(source.artifactId)}/html`;
}

const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]/g;
const DEFAULT_FILENAME_STEM = "page";

/**
 * `<stem>.html`, where `stem` (normally the page slug) is reduced to a
 * conservative ASCII set so a value taken from the URL can never inject
 * header syntax (quotes, `;`, CR/LF) into `Content-Disposition`. Leading
 * dots are dropped so the result is never a hidden file, and an existing
 * `.html`/`.htm` suffix is not doubled. Falls back to `page.html` when
 * nothing usable remains.
 */
export function htmlDownloadFilename(stem: string): string {
  const safe = stem
    .replace(UNSAFE_FILENAME_CHARS, "")
    .replace(/^\.+/, "")
    .replace(/\.html?$/i, "");
  return `${safe || DEFAULT_FILENAME_STEM}.html`;
}

/**
 * Response headers for the body proxies. `filenameStem` names the
 * attachment (see `htmlDownloadFilename`) so a direct navigation, `curl`,
 * or the share page's Download link all save `<slug>.html`.
 */
export function htmlBodyProxyHeaders(filenameStem: string): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${htmlDownloadFilename(filenameStem)}"`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "private, no-store",
  };
}

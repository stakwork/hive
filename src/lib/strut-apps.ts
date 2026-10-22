/**
 * Strut APPS as hive frames them (strut `plans/apps.md` §6, §7.4): the
 * addresses and the pure rules the app frame (`components/strut-app-frame`)
 * and its two routes share. Client-safe: no db, no secrets.
 *
 * An app is a built front-end document on a swarm's strut, a WORKSPACE app
 * (`/apps/<name>/<vN>`, the active version unless one is named) — what the
 * builder publishes. Hive reads its document through
 * `api/orgs/[githubLogin]/strut/apps/document` and relays the page's MCP
 * `tools/call` through `…/strut/apps/mcp`; the swarm key never reaches the
 * browser. (A JOB's app, a directory in a job's, is retired on strut's side:
 * strut plans/chained-orchestrators.md §6.)
 */

/** Where an app is: its swarm, and the workspace app by name (and version). */
export type StrutAppSource = { githubLogin: string; swarmId: string; app: string; version?: string };

/** The document inside an app's directory, as `app/build` writes it. */
export const STRUT_APP_DOCUMENT = "dist/index.html";

const MAX_PART = 200;
const VERSION_RE = /^v\d{1,6}$/;
/** Strut's app names: lowercase words, `/`-separated (`acme/hvac/invoices`). Hive only keeps them out of URL syntax. */
const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** A workspace app's name hive will put in a strut URL. */
export const isStrutAppName = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_PART && APP_NAME_RE.test(v);

/** A version label (`v1`, `v2`, …). */
export const isStrutAppVersion = (v: unknown): v is string => typeof v === "string" && VERSION_RE.test(v);

/** `path` with each segment encoded, for a strut URL. */
export const encodeStrutPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** Same-origin URL of the document route for an app. */
export function strutAppDocumentUrl(source: StrutAppSource): string {
  const query = new URLSearchParams({ swarmId: source.swarmId, app: source.app });
  if (source.version) query.set("version", source.version);
  return `/api/orgs/${encodeURIComponent(source.githubLogin)}/strut/apps/document?${query}`;
}

/** Same-origin URL of the MCP relay for an app's swarm. The relay never needs to know which app: strut reads that off the token on each call. */
export function strutAppRelayUrl(source: Pick<StrutAppSource, "githubLogin" | "swarmId">): string {
  return `/api/orgs/${encodeURIComponent(source.githubLogin)}/strut/apps/mcp?${new URLSearchParams({ swarmId: source.swarmId })}`;
}

/**
 * A workspace app's document as strut links it (strut CALLBACKS.md §4, the
 * builder's deliverable): `/apps/<name, encoded>/<vN>/files/dist/index.html`.
 * Hive keys an app ref by this link, spelled as strut spells it (the name
 * encoded whole, `/` included), so strut's `url` and a key hive builds are
 * one identity. With no version — `/apps/<name>/files/dist/index.html`, a
 * spelling strut never serves — the active version: what a peer's unpinned
 * entry names (`app: { name }`, read against the peer's swarm when it is
 * looked at, never resolved here).
 */
export function workspaceAppDocumentKey(app: string, version?: string): string {
  return `/apps/${encodeURIComponent(app)}/${version ? `${version}/` : ""}files/${STRUT_APP_DOCUMENT}`;
}

/**
 * A workspace app's document link (`workspaceAppDocumentKey`) back to the
 * app's name and, when the link names one, its version. Null for any other
 * link. A name whose last segment is itself
 * `vN`-shaped reads as strut would spell it: that segment is the version.
 */
export function workspaceAppOfKey(key: unknown): { app: string; version?: string } | null {
  if (typeof key !== "string") return null;
  const match = /^\/apps\/(.+?)(?:\/(v\d{1,6}))?\/files\/dist\/index\.html$/.exec(key);
  if (!match) return null;
  let app: string;
  try {
    app = match[1].split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  if (!isStrutAppName(app)) return null;
  return match[2] ? { app, version: match[2] } : { app };
}

/** The deep-link params strut reads (its `web/src/embed.ts` vocabulary). */
const STRUT_LINK_PARAMS = new Set(["wf", "run", "v", "job", "app", "chat"]);
const MAX_LINK_VALUE = 512;

/**
 * What a page's `ui/open-link` names in strut, when it is a strut deep link:
 * a query-only link (`?wf=<workflow>&run=<id>`, what `strut/views` opens),
 * reduced to strut's own params — the query hive carries as `?strut=`
 * (`lib/utils/strut-links`). Null for anything else; an absolute URL is
 * the host's to open in a new tab.
 */
export function strutDeepLinkOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("?") || url.length > 2_048) return null;
  const out = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(url.slice(1))) {
    if (STRUT_LINK_PARAMS.has(k) && v && v.length <= MAX_LINK_VALUE) out.set(k, v);
  }
  const query = out.toString();
  return query || null;
}

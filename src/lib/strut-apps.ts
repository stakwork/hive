/**
 * Strut APPS as hive frames them (strut `plans/apps.md` §6, §7.4): the
 * addresses and the pure rules the app frame (`components/strut-app-frame`)
 * and its two routes share. Client-safe: no db, no secrets.
 *
 * An app is a built front-end document on a swarm's strut — a WORKSPACE app
 * (`/apps/<name>/<vN>`, the active version unless one is named) or a JOB's
 * app (a directory of the job's, `/jobs/<job>/files/<path>`). Hive reads its
 * document through `api/orgs/[githubLogin]/strut/apps/document` and relays
 * the page's MCP `tools/call` through `…/strut/apps/mcp`; the swarm key
 * never reaches the browser.
 */

/** Where an app is: its swarm, and a workspace app by name or a job's app by its directory. */
export type StrutAppSource =
  | { githubLogin: string; swarmId: string; app: string; version?: string }
  | { githubLogin: string; swarmId: string; job: string; path: string };

/** The document inside an app's directory, as `app/build` writes it. */
export const STRUT_APP_DOCUMENT = "dist/index.html";

const MAX_PART = 200;
const MAX_PATH = 1_024;
const VERSION_RE = /^v\d{1,6}$/;
/** Strut's app names: lowercase words, `/`-separated (`acme/hvac/invoices`). Hive only keeps them out of URL syntax. */
const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** A workspace app's name hive will put in a strut URL. */
export const isStrutAppName = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_PART && APP_NAME_RE.test(v);

/** A version label (`v1`, `v2`, …). */
export const isStrutAppVersion = (v: unknown): v is string => typeof v === "string" && VERSION_RE.test(v);

/** A job id as strut's file routes take it (one URL segment once encoded; `peer/<job>` included). */
export const isStrutJobId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_PART && !/[\s\\]/.test(v) && !v.split("/").includes("..");

/** A directory inside a job's: relative, no `..`, no empty segment. */
export function isStrutAppPath(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > MAX_PATH || /[\s\\?#%]/.test(v)) return false;
  const segments = v.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

/** `path` with each segment encoded, for a strut URL. */
export const encodeStrutPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** Same-origin URL of the document route for an app. */
export function strutAppDocumentUrl(source: StrutAppSource): string {
  const query = new URLSearchParams({ swarmId: source.swarmId });
  if ("app" in source) {
    query.set("app", source.app);
    if (source.version) query.set("version", source.version);
  } else {
    query.set("job", source.job);
    query.set("path", source.path);
  }
  return `/api/orgs/${encodeURIComponent(source.githubLogin)}/strut/apps/document?${query}`;
}

/** Same-origin URL of the MCP relay for an app's swarm. The relay never needs to know which app: strut reads that off the token on each call. */
export function strutAppRelayUrl(source: Pick<StrutAppSource, "githubLogin" | "swarmId">): string {
  return `/api/orgs/${encodeURIComponent(source.githubLogin)}/strut/apps/mcp?${new URLSearchParams({ swarmId: source.swarmId })}`;
}

/**
 * A job's app as strut links it — its deliverable's `url`,
 * `/jobs/<job, encoded>/files/<path>/dist/index.html` — back to the job and
 * the app's directory. Null for any other link.
 */
export function jobAppOfKey(key: unknown): { job: string; path: string } | null {
  if (typeof key !== "string") return null;
  const match = /^\/jobs\/([^/]+)\/files\/(.+)\/dist\/index\.html$/.exec(key);
  if (!match) return null;
  let job: string;
  let path: string;
  try {
    job = decodeURIComponent(match[1]);
    path = match[2].split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  return isStrutJobId(job) && isStrutAppPath(path) ? { job, path } : null;
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

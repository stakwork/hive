/**
 * Hive's server side of strut APPS (strut `plans/apps.md` §7.2, §7.4): what
 * the routes under `api/orgs/[githubLogin]/strut/apps` do once a
 * member is signed in.
 *
 * - **The swarm** (`authorizeAppSwarm`): the caller must belong to the org,
 *   the swarm to a workspace of that org the caller can read — membership,
 *   never the public viewer — before the swarm key is decrypted. The key
 *   stays on the server.
 * - **The document** (`fetchStrutAppDocument`): list the app's files with
 *   the key, which mints the app's FILE TOKEN (`app:<name>@<vN>`), then
 *   read `dist/index.html?t=`
 *   — strut writes that token into the document's
 *   `<meta name="strut-app-token">` as it serves it. That token is worth
 *   that app's files and nothing else, and is the app's identity to
 *   `step_run`; it is meant to be in the page. A strut with no secret mints
 *   no token and writes the unsigned scope (its dev mode).
 * - **The relay** (`relayRefusal`, `relayToStrutMcp`): the frame's JSON-RPC
 *   message, forwarded AS IT IS to the swarm's `/lab/mcp` with the swarm key
 *   and the member as `x-strut-actor`. Only an ALLOWLIST passes:
 *   `initialize`, `notifications/initialized`, `tools/list`, and
 *   `tools/call` of `step_run`. The swarm key opens strut's whole assistant
 *   tool set on `/mcp` (`ask_workflow_builder`, `run_workflow`, …) and strut
 *   can gate only `step_run` by the app's grants, so code a model wrote must
 *   never reach anything else through hive's credential.
 * - **The role floor** (`relayStepRefusal`): strut records the actor but
 *   knows nothing of Hive roles, so the relay is the only place they hold.
 *   A `step_run` that launches or cancels a run needs DEVELOPER or above,
 *   and a workspace's apps launch at most 60 runs a minute between them
 *   (`STRUT_APP_LAUNCHES_PER_MINUTE`). Every other step passes on read access.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { checkRateLimitSafe } from "@/lib/benchmarks/access";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { EncryptionService } from "@/lib/encryption";
import { isStrutAppName, isStrutAppRelease, isStrutAppVersion, STRUT_APP_DOCUMENT, type PinnedStrutApp } from "@/lib/strut-apps";
import { strutLabBaseUrl } from "@/services/bifrost/strut-delegation";
import { validateWorkspaceAccess } from "@/services/workspace";

const READ_TIMEOUT_MS = 20_000;
/** A built app is ~1–3 MB (plans/apps.md §2.5); anything far past that is not one. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type AppRouteFailure = { ok: false; status: number; error: string };

const fail = (status: number, error: string): AppRouteFailure => ({ ok: false, status, error });

/** An app's swarm, cleared for the caller. `swarmApiKey` is decrypted: never log it, never send it to the browser. */
export interface AppSwarm {
  swarmId: string;
  swarmUrl: string;
  labBase: string;
  swarmApiKey: string;
  orgId: string;
  /** The workspace the swarm is (one per swarm): where its pinned apps are tabs. */
  workspace: { id: string; slug: string; name: string };
  /** The caller's role in `workspace` (null only if Hive could not say: then nothing role-gated passes). */
  role: WorkspaceRole | null;
}

/** The org, the swarm in it, the member's read access to the swarm's workspace — then the key. */
export async function authorizeAppSwarm(
  userId: string,
  githubLogin: string,
  swarmId: string,
): Promise<{ ok: true; swarm: AppSwarm } | AppRouteFailure> {
  if (!swarmId || swarmId.length > 200) return fail(400, "swarmId is required");
  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return fail(404, "Not found");
  const swarm = await db.swarm.findUnique({
    where: { id: swarmId },
    select: {
      swarmUrl: true,
      swarmApiKey: true,
      workspace: { select: { id: true, slug: true, name: true, sourceControlOrgId: true, deleted: true } },
    },
  });
  if (!swarm || swarm.workspace.deleted || swarm.workspace.sourceControlOrgId !== orgId) return fail(403, "Forbidden");
  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canRead) return fail(403, "Forbidden");
  if (!swarm.swarmUrl || !swarm.swarmApiKey) return fail(404, "The swarm has no strut");
  let swarmApiKey: string;
  try {
    swarmApiKey = EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey);
  } catch {
    return fail(502, "Swarm credentials unavailable");
  }
  return {
    ok: true,
    swarm: {
      swarmId,
      swarmUrl: swarm.swarmUrl,
      labBase: strutLabBaseUrl(swarm.swarmUrl),
      swarmApiKey,
      orgId,
      workspace: { id: swarm.workspace.id, slug: swarm.workspace.slug, name: swarm.workspace.name },
      role: access.userRole ?? null,
    },
  };
}

/** Which app: a workspace app, its active version unless `version` names one. */
export type StrutAppAddress = { app: string; version?: string };

type LabRead = { ok: true; res: Response } | AppRouteFailure;

async function labGet(swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">, path: string, headers: Record<string, string> = {}): Promise<LabRead> {
  let res: Response;
  try {
    res = await fetch(`${swarm.labBase}${path}`, {
      headers: { ...headers, "x-api-token": swarm.swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("[strut-apps] swarm unreachable", { swarmId: swarm.swarmId, error: err instanceof Error ? err.message : String(err) });
    return fail(502, "Could not reach the swarm");
  }
  // Only a conditional read (`If-None-Match`) can be answered 304.
  if (res.status === 304) return { ok: true, res };
  if (res.status === 404) return fail(404, "No such app on the swarm");
  if (!res.ok) {
    console.warn("[strut-apps] swarm refused", { swarmId: swarm.swarmId, status: res.status });
    return fail(502, `The swarm answered ${res.status}`);
  }
  return { ok: true, res };
}

async function labJson(swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">, path: string): Promise<{ ok: true; body: Record<string, unknown> } | AppRouteFailure> {
  const read = await labGet(swarm, path);
  if (!read.ok) return read;
  const body: unknown = await read.res.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? { ok: true, body: body as Record<string, unknown> } : fail(502, "The swarm answered something hive cannot read");
}

/** Does an `If-None-Match` header name this ETag? (`*`, a list, weak or strong.) */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((t) => t.trim() === "*" || bare(t) === bare(etag));
}

/** An ETag for a document strut sent without one: its bytes' hash. */
const etagOf = (html: string): string => `"${createHash("sha256").update(html).digest("hex").slice(0, 32)}"`;

export type StrutAppDocument =
  | { ok: true; notModified: true; etag: string }
  | { ok: true; notModified: false; html: string; etag: string };

/**
 * The app's document, as strut serves it under the app's file token: list
 * the files (which mints the token), then read `dist/index.html?t=<token>`.
 *
 * A version's document is the same bytes every time it is served (its
 * token is a signature of the version, not a nonce), so it carries an
 * ETag: strut's when strut sends one, else the hash of the bytes.
 * `ifNoneMatch` (the browser's) is passed on to strut, which answers 304
 * without sending the megabytes; an older strut ignores it, and the hash
 * still spares the browser the download.
 */
export async function fetchStrutAppDocument(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  at: StrutAppAddress,
  opts: { ifNoneMatch?: string | null } = {},
): Promise<StrutAppDocument | AppRouteFailure> {
  const name = encodeURIComponent(at.app);
  let version = at.version;
  if (!version) {
    const versions = await labJson(swarm, `/apps/${name}/versions`);
    if (!versions.ok) return versions;
    if (typeof versions.body.active !== "string" || !versions.body.active) return fail(404, `App "${at.app}" has no active version`);
    version = versions.body.active;
  }
  const dir = `/apps/${name}/${encodeURIComponent(version)}/files`;
  const files = await labJson(swarm, dir);
  if (!files.ok) return files;
  const token = typeof files.body.token === "string" && files.body.token ? files.body.token : null;
  const conditional: Record<string, string> = opts.ifNoneMatch ? { "if-none-match": opts.ifNoneMatch } : {};
  const doc = await labGet(swarm, `${dir}/${STRUT_APP_DOCUMENT}${token ? `?${new URLSearchParams({ t: token })}` : ""}`, conditional);
  if (!doc.ok) return doc.status === 404 ? fail(404, "The app has not been built (no dist/index.html)") : doc;
  const strutEtag = doc.res.headers.get("etag");
  if (doc.res.status === 304) {
    if (strutEtag) return { ok: true, notModified: true, etag: strutEtag };
    return fail(502, "The swarm answered 304 without an ETag");
  }
  const declared = Number(doc.res.headers.get("content-length"));
  if (declared > MAX_DOCUMENT_BYTES) return fail(502, "The app's document is too large");
  const html = await doc.res.text();
  if (html.length > MAX_DOCUMENT_BYTES) return fail(502, "The app's document is too large");
  return { ok: true, notModified: false, html, etag: strutEtag ?? etagOf(html) };
}

// ─── The relay ──────────────────────────────────────────────────────────

/** The methods the relay forwards. Everything else is refused before the swarm is called. */
export const RELAY_METHODS: ReadonlySet<string> = new Set(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
/** The one tool an app may call (strut gates it by the app's grants). */
export const RELAY_TOOL = "step_run";
/** A step_run's config + input is small; this is far past any of them. */
export const MAX_RELAY_BODY_BYTES = 1024 * 1024;

type JsonRpcId = string | number | null;

/** A JSON-RPC error answering `id`, as the relay refuses a message. */
export interface RelayRefusal {
  id: JsonRpcId;
  /** A request (it has an id) gets the error as its JSON-RPC answer; a notification has none, so its refusal is an HTTP 400. */
  isRequest: boolean;
  code: number;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOf = (message: Record<string, unknown>): JsonRpcId =>
  typeof message.id === "string" || typeof message.id === "number" ? message.id : null;

/**
 * Why hive refuses to forward a JSON-RPC message from an app's frame, or
 * null when it may pass: one message (no batch), an allowlisted method, and
 * for `tools/call` the tool `step_run` and nothing else.
 */
export function relayRefusal(message: unknown): RelayRefusal | null {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    const id = isRecord(message) ? idOf(message) : null;
    return { id, isRequest: id !== null, code: -32600, message: "Invalid Request: hive relays one JSON-RPC request or notification at a time" };
  }
  const isRequest = "id" in message;
  const id = idOf(message);
  if (!RELAY_METHODS.has(message.method)) {
    return { id, isRequest, code: -32601, message: `Method not found: hive relays only ${[...RELAY_METHODS].join(", ")} for a strut app` };
  }
  if (message.method === "tools/call") {
    const name = isRecord(message.params) ? message.params.name : undefined;
    if (name !== RELAY_TOOL) {
      return { id, isRequest, code: -32602, message: `Tool not allowed: a strut app may call only ${RELAY_TOOL} through hive` };
    }
  }
  return null;
}

/** The `step_run` types that start a paid workflow run or stop one: DEVELOPER and up. */
export const RELAY_LAUNCH_STEPS: ReadonlySet<string> = new Set(["run/launch", "run/cancel"]);
/** `run/launch`es from one workspace's apps, all apps together, per window, when `STRUT_APP_LAUNCHES_PER_MINUTE` is unset. */
export const RELAY_LAUNCH_RATE_LIMIT = 60;
export const RELAY_LAUNCH_WINDOW_SECS = 60;

/** The launch limit in force: `STRUT_APP_LAUNCHES_PER_MINUTE` when it is a positive integer, else the default. */
export function relayLaunchRateLimit(): number {
  const n = Number(process.env.STRUT_APP_LAUNCHES_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : RELAY_LAUNCH_RATE_LIMIT;
}
/** Implementation-defined JSON-RPC codes (-32000…-32099) for the role floor, after HTTP's 403 and 429. */
export const RELAY_FORBIDDEN = -32003;
export const RELAY_RATE_LIMITED = -32029;

/** Strut's step reference: `run/launch@v1` is a pinned `run/launch` (strut `src/step-ref.ts`). */
const STEP_PIN = /^(.+)@([^@/]+)$/;

/**
 * The step type of a `tools/call` of `step_run`, bare as strut matches it
 * (`run/launch@v1` → `run/launch`); null for any other message.
 */
export function relayStepType(message: unknown): string | null {
  if (!isRecord(message) || message.method !== "tools/call" || !isRecord(message.params) || message.params.name !== RELAY_TOOL) return null;
  const args = message.params.arguments;
  const type = isRecord(args) ? args.type : undefined;
  if (typeof type !== "string") return null;
  return STEP_PIN.exec(type)?.[1] ?? type;
}

/**
 * Why hive refuses a `step_run` the allowlist passed, by the member's role
 * in the swarm's workspace, or null when it may pass. `run/launch` and
 * `run/cancel` need DEVELOPER or above; a `run/launch` also counts against
 * the workspace's limit (`checkRateLimitSafe`, which fails open). Every
 * other step passes.
 */
export async function relayStepRefusal(
  message: unknown,
  swarm: Pick<AppSwarm, "role" | "workspace">,
): Promise<RelayRefusal | null> {
  const type = relayStepType(message);
  if (!type || !RELAY_LAUNCH_STEPS.has(type) || !isRecord(message)) return null;
  const isRequest = "id" in message;
  const id = idOf(message);
  if (!swarm.role || WORKSPACE_PERMISSION_LEVELS[swarm.role] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]) {
    return { id, isRequest, code: RELAY_FORBIDDEN, message: `Developer access required: ${type} needs the Developer role or above in this workspace` };
  }
  if (type !== "run/launch") return null;
  const limit = relayLaunchRateLimit();
  const rate = await checkRateLimitSafe(`strut-app:launch-minute:${swarm.workspace.id}`, limit, RELAY_LAUNCH_WINDOW_SECS);
  if (rate.allowed) return null;
  const wait = rate.retryAfter ? `in ${rate.retryAfter} s` : "shortly";
  return {
    id,
    isRequest,
    code: RELAY_RATE_LIMITED,
    message: `Too many runs: this workspace's apps launch at most ${limit} a minute. Try again ${wait}.`,
  };
}

/** The answer hive gives for a refused message, in the Streamable HTTP shape the frame's MCP client reads. */
export function refusalResponse(refusal: RelayRefusal): Response {
  const body = JSON.stringify({ jsonrpc: "2.0", id: refusal.id, error: { code: refusal.code, message: refusal.message } });
  return new Response(body, {
    status: refusal.isRequest ? 200 : 400,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Request headers the frame's MCP client sends that strut's door reads. */
const FORWARDED_REQUEST_HEADERS = ["mcp-protocol-version", "mcp-session-id", "last-event-id"] as const;
/** Response headers strut sets that the frame's MCP client reads. */
const KEPT_RESPONSE_HEADERS = ["content-type", "mcp-session-id"] as const;

/**
 * `POST {lab}/mcp` with the message exactly as the frame sent it (`body`,
 * the raw text), the swarm key, the member as `x-strut-actor`, and the
 * Streamable HTTP `Accept`; strut's answer — JSON or an event stream — is
 * streamed back as it comes.
 */
export async function relayToStrutMcp(opts: {
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">;
  actor: string;
  body: string;
  requestHeaders: Headers;
  signal?: AbortSignal;
}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-token": opts.swarm.swarmApiKey,
    "x-strut-actor": opts.actor,
  };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = opts.requestHeaders.get(name);
    if (value) headers[name] = value;
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${opts.swarm.labBase}/mcp`, { method: "POST", headers, body: opts.body, cache: "no-store", signal: opts.signal });
  } catch (err) {
    console.warn("[strut-apps] relay: swarm unreachable", { swarmId: opts.swarm.swarmId, error: err instanceof Error ? err.message : String(err) });
    return new Response(JSON.stringify({ error: "Could not reach the swarm" }), { status: 502, headers: { "content-type": "application/json" } });
  }
  // The swarm refusing HIVE's key is not the member's session failing: a
  // 401 here would read to the frame's MCP client as its own to answer.
  if (upstream.status === 401 || upstream.status === 403) {
    console.warn("[strut-apps] relay: swarm refused the key", { swarmId: opts.swarm.swarmId, status: upstream.status });
    return new Response(JSON.stringify({ error: `The swarm answered ${upstream.status}` }), { status: 502, headers: { "content-type": "application/json" } });
  }
  const out = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  for (const name of KEPT_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// ─── The tabs ───────────────────────────────────────────────────────────

/**
 * The apps the swarm's strut has pinned as tabs: `GET /apps`, the entries
 * with `pinned: true`, in strut's order. The flag is the app record's, set
 * by a person (`PUT /apps/:name/pin`) or the builder (`app/pin`); the swarm
 * IS one workspace's, so a pinned app is a tab of that workspace.
 */
export async function listPinnedStrutApps(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
): Promise<{ ok: true; apps: PinnedStrutApp[] } | AppRouteFailure> {
  const listed = await labJson(swarm, "/apps");
  if (!listed.ok) return listed;
  const entries = Array.isArray(listed.body.apps) ? listed.body.apps : [];
  const apps = entries.flatMap((entry): PinnedStrutApp[] => {
    if (!isRecord(entry) || entry.pinned !== true || !isStrutAppName(entry.name)) return [];
    const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : entry.name;
    return [{ name: entry.name, title }];
  });
  return { ok: true, apps };
}

/** Whether one app is pinned, read off `GET /apps`; 404 when the swarm's strut has no such app. */
export async function readStrutAppPin(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  app: string,
): Promise<{ ok: true; pinned: boolean } | AppRouteFailure> {
  const listed = await labJson(swarm, "/apps");
  if (!listed.ok) return listed;
  const entries = Array.isArray(listed.body.apps) ? listed.body.apps : [];
  const entry = entries.find((e) => isRecord(e) && e.name === app);
  return entry && isRecord(entry) ? { ok: true, pinned: entry.pinned === true } : fail(404, "No such app on the swarm");
}

/**
 * A `PUT` to a person's door on strut (`/apps/:name/pin`, `/apps/:name/active`)
 * with the swarm key — a peer key would not do. Strut's own 4xx and its
 * message come back as they are; anything else is a 502.
 */
async function labPut(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  path: string,
  body: Record<string, unknown>,
  what: string,
  headers: Record<string, string> = {},
): Promise<{ ok: true; body: Record<string, unknown> } | AppRouteFailure> {
  let res: Response;
  try {
    res = await fetch(`${swarm.labBase}${path}`, {
      method: "PUT",
      headers: { ...headers, "x-api-token": swarm.swarmApiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`[strut-apps] ${what}: swarm unreachable`, { swarmId: swarm.swarmId, error: err instanceof Error ? err.message : String(err) });
    return fail(502, "Could not reach the swarm");
  }
  const answer: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, body: isRecord(answer) ? answer : {} };
  const error = isRecord(answer) && typeof answer.error === "string" ? answer.error : `The swarm answered ${res.status}`;
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) return fail(res.status, error);
  console.warn(`[strut-apps] ${what}: swarm refused`, { swarmId: swarm.swarmId, status: res.status });
  return fail(502, error);
}

/** Pin the app as a tab, or unpin it: strut's `PUT /apps/:name/pin` (the name encoded whole, as the document route spells it). */
export async function setStrutAppPin(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  app: string,
  pinned: boolean,
): Promise<{ ok: true; pinned: boolean } | AppRouteFailure> {
  const put = await labPut(swarm, `/apps/${encodeURIComponent(app)}/pin`, { pinned }, "pin");
  if (!put.ok) return put;
  return { ok: true, pinned: typeof put.body.pinned === "boolean" ? put.body.pinned : pinned };
}

// ─── The versions ───────────────────────────────────────────────────────

/** One published version of an app, as the version picker lists it. */
export interface StrutAppVersion {
  /** `v1`, `v2`, … */
  version: string;
  createdAt?: string;
}

/**
 * A RELEASE (strut `plans/app-releases.md` §1): a page version a person made
 * live, with the versions of the workflows and custom steps it calls as
 * they were then. Hive keeps the lock's labels only, by name.
 */
export interface StrutAppRelease {
  /** `r1`, `r2`, … */
  id: string;
  version: string;
  createdAt?: string;
  /** The actor who made it live. */
  by?: string;
  lock: { workflows: Record<string, string>; steps: Record<string, string>; floating: string[] };
}

/** A workflow or step the live release locked that has moved on since (`current: null`: gone). */
export interface StrutAppDrift {
  kind: "workflow" | "step";
  name: string;
  locked: string;
  current: string | null;
}

/** What `GET /apps/:name/versions` says of an app, as hive reads it. */
export interface StrutAppVersions {
  /** The version everyone opens (strut's `active`). */
  live: string;
  /** Newest first. */
  versions: StrutAppVersion[];
  /** Strut reported the app's mode (`live`): it has releases, so it can be held. False on a strut without them. */
  holdable: boolean;
  /** The live release's id; null while the app follows latest. */
  release: string | null;
  /** Oldest first. */
  releases: StrutAppRelease[];
  /** What the live release's lock names that has moved on since. */
  behind: StrutAppDrift[];
}

const versionNumber = (label: string): number => Number(label.slice(1));

/** A lock's `{ name: { version, hash? } }`, as `{ name: version }`. */
const lockLabels = (entries: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(isRecord(entries) ? entries : {}).flatMap(([name, at]) =>
      isRecord(at) && typeof at.version === "string" ? [[name, at.version]] : [],
    ),
  );

function readRelease(entry: unknown): StrutAppRelease[] {
  if (!isRecord(entry) || !isStrutAppRelease(entry.id) || !isStrutAppVersion(entry.version)) return [];
  const lock = isRecord(entry.lock) ? entry.lock : {};
  return [
    {
      id: entry.id,
      version: entry.version,
      ...(typeof entry.createdAt === "string" ? { createdAt: entry.createdAt } : {}),
      ...(typeof entry.by === "string" && entry.by ? { by: entry.by } : {}),
      lock: {
        workflows: lockLabels(lock.workflows),
        steps: lockLabels(lock.steps),
        floating: Array.isArray(lock.floating) ? lock.floating.filter((f): f is string => typeof f === "string") : [],
      },
    },
  ];
}

function readDrift(entry: unknown): StrutAppDrift[] {
  if (!isRecord(entry) || (entry.kind !== "workflow" && entry.kind !== "step") || typeof entry.name !== "string" || typeof entry.locked !== "string") return [];
  return [{ kind: entry.kind, name: entry.name, locked: entry.locked, current: typeof entry.current === "string" ? entry.current : null }];
}

/**
 * The app's versions, newest first, the LIVE one — the version strut
 * serves when none is named (its active version) — and its releases:
 * strut's `GET /apps/:name/versions`, the record only, no files read. A
 * strut without releases sends no `live`: the app follows latest and
 * cannot be held (`holdable: false`).
 */
export async function readStrutAppVersions(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  app: string,
): Promise<({ ok: true } & StrutAppVersions) | AppRouteFailure> {
  const read = await labJson(swarm, `/apps/${encodeURIComponent(app)}/versions`);
  if (!read.ok) return read;
  const { active, versions, live, releases, behind } = read.body;
  if (!isStrutAppVersion(active)) return fail(404, `App "${app}" has no live version`);
  const listed = Object.entries(isRecord(versions) ? versions : {}).flatMap(([version, info]): StrutAppVersion[] => {
    if (!isStrutAppVersion(version)) return [];
    const createdAt = isRecord(info) && typeof info.createdAt === "string" ? info.createdAt : undefined;
    return [{ version, ...(createdAt ? { createdAt } : {}) }];
  });
  listed.sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
  const holdable = typeof live === "string";
  return {
    ok: true,
    live: active,
    versions: listed,
    holdable,
    release: isStrutAppRelease(live) ? live : null,
    releases: holdable && Array.isArray(releases) ? releases.flatMap(readRelease) : [],
    behind: holdable && Array.isArray(behind) ? behind.flatMap(readDrift) : [],
  };
}

/**
 * What a person makes live (strut's `PUT /apps/:name/active`):
 * `{ version: "vN" }` PROMOTES — a new release of it with a lock on what it
 * calls taken now, made live, the app held (on the live version itself, a
 * fresh lock); `{ release: "rN" }` rolls back (or forward) to a release;
 * `{ version: "latest" }` follows the newest publish again.
 */
export type StrutAppLiveTarget = { version: string } | { release: string };

/**
 * Make `target` live, for everyone who opens the app, as `actor` (strut
 * records them as the release's `by`). Answers the live version and the
 * live release (null while following latest).
 */
export async function setStrutAppLive(
  swarm: Pick<AppSwarm, "labBase" | "swarmApiKey" | "swarmId">,
  app: string,
  target: StrutAppLiveTarget,
  opts: { actor?: string } = {},
): Promise<{ ok: true; live: string; release: string | null } | AppRouteFailure> {
  const put = await labPut(swarm, `/apps/${encodeURIComponent(app)}/active`, target, "set live", opts.actor ? { "x-strut-actor": opts.actor } : {});
  if (!put.ok) return put;
  const asked = "version" in target && isStrutAppVersion(target.version) ? target.version : undefined;
  const live = isStrutAppVersion(put.body.active) ? put.body.active : asked;
  if (!live) return fail(502, "The swarm did not say which version is live");
  return { ok: true, live, release: isStrutAppRelease(put.body.live) ? put.body.live : null };
}

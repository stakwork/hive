/**
 * Client for the public `cwe-catalog` strut workflow on the infosec "door" —
 * the MITRE CWE catalogue shared by every workspace. No auth: a run is
 * launched (`POST …/public/workflows/cwe-catalog/run`) and read back
 * (`GET …/runs/:runId?wait=25&t=token`) until it finishes; the answer is
 * `output.result`.
 *
 * Env: `INFOSEC_DOOR_URL` (default `https://infosec.sphinx.chat:3355/lab`).
 *
 * Launches are rate limited per caller address (shared on Vercel), so 429 /
 * 503 / network errors are retried with a short back-off, reusing the same
 * launch `key`. "ready" answers are cached for an hour — the catalogue only
 * changes on a MITRE ingest — and identical concurrent requests share one run.
 */

import { logger } from "@/lib/logger";

export const DEFAULT_INFOSEC_DOOR_URL = "https://infosec.sphinx.chat:3355/lab";
export const INFOSEC_BUSY_MESSAGE = "The infosec catalogue is busy, try again in a minute";

const TOTAL_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_BACKOFF_MS = [1_000, 2_000];
const READ_WAIT_SECONDS = 25;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export type InfosecDoorErrorKind = "busy" | "timeout" | "unavailable" | "failed";

export class InfosecDoorError extends Error {
  constructor(
    message: string,
    readonly kind: InfosecDoorErrorKind,
  ) {
    super(message);
    this.name = "InfosecDoorError";
  }
}

export type CweCatalogInput =
  | { op: "view"; view: string }
  | { op: "search"; q: string }
  | { op: "cwe"; cwe_id: string }
  | { op: "cwe"; ref_id: string }
  | { op: "related"; ref_id: string; cve_limit?: number }
  | { op: "related"; cwe_id: string; cve_limit?: number };

/** `output.result`: `status` plus op-specific fields. */
export type CweCatalogResult = { status: "ready" | "error"; error?: string } & Record<string, unknown>;

const cache = new Map<string, { expires: number; result: CweCatalogResult }>();
const inFlight = new Map<string, Promise<CweCatalogResult>>();

export function clearInfosecDoorCache(): void {
  cache.clear();
  inFlight.clear();
}

/** op + args with strings trimmed and keys sorted, so equal requests share an entry. */
function cacheKey(input: CweCatalogInput): string {
  const entries = Object.entries(input)
    .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function remember(key: string, result: CweCatalogResult): void {
  const now = Date.now();
  for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
  while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { expires: now + CACHE_TTL_MS, result });
}

function baseUrl(): string {
  return (process.env.INFOSEC_DOOR_URL || DEFAULT_INFOSEC_DOOR_URL).replace(/\/$/, "");
}

const timeoutError = () => new InfosecDoorError("The infosec catalogue did not answer in time", "timeout");

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function retryDelay(response: Response | null, attempt: number): number {
  const seconds = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return DEFAULT_BACKOFF_MS[attempt] ?? 2_000;
}

/** One HTTP step, retried on 429 / 503 / network errors within `signal`. */
async function step(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt + 1 >= MAX_ATTEMPTS;
    let response: Response | null = null;
    try {
      response = await fetch(url, { ...init, cache: "no-store", signal });
    } catch (error) {
      if (isTimeout(error) || signal.aborted) throw timeoutError();
      if (last) throw new InfosecDoorError("The infosec catalogue could not be reached", "unavailable");
    }
    if (response && response.status !== 429 && response.status !== 503) return response;
    if (last) {
      if (response?.status === 429) throw new InfosecDoorError(INFOSEC_BUSY_MESSAGE, "busy");
      throw new InfosecDoorError("The infosec catalogue is unavailable", "unavailable");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    if (signal.aborted) throw timeoutError();
  }
}

async function execute(input: CweCatalogInput): Promise<CweCatalogResult> {
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const base = `${baseUrl()}/public/workflows/cwe-catalog`;
  const launched = await step(
    `${base}/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      // One key per launch, reused by every retry of it.
      body: JSON.stringify({ input, key: crypto.randomUUID() }),
    },
    signal,
  );
  if (!launched.ok) throw new InfosecDoorError(`The infosec catalogue refused the request (${launched.status})`, "unavailable");
  const run = (await launched.json().catch(() => null)) as { runId?: unknown; token?: unknown } | null;
  if (typeof run?.runId !== "string" || typeof run.token !== "string") {
    throw new InfosecDoorError("The infosec catalogue returned no run", "unavailable");
  }

  const readUrl = `${base}/runs/${encodeURIComponent(run.runId)}?wait=${READ_WAIT_SECONDS}&t=${encodeURIComponent(run.token)}`;
  for (;;) {
    const response = await step(readUrl, {}, signal);
    if (!response.ok) throw new InfosecDoorError(`The infosec catalogue read failed (${response.status})`, "unavailable");
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      output?: { result?: CweCatalogResult } | null;
    } | null;
    if (!body) throw new InfosecDoorError("The infosec catalogue returned an unreadable run", "unavailable");
    if (body.status === "success") {
      const result = body.output?.result;
      if (!result || typeof result !== "object") throw new InfosecDoorError("The infosec catalogue returned no result", "failed");
      return result;
    }
    if (body.status === "error") {
      const said = body.output?.result?.error;
      throw new InfosecDoorError(typeof said === "string" && said ? said : "The infosec catalogue run failed", "failed");
    }
    // running / queued / pending: read again (each read waits up to 25 s server-side).
    if (signal.aborted) throw timeoutError();
  }
}

/** Run the `cwe-catalog` workflow for `input` and return its `output.result`. */
export function runCweCatalog(input: CweCatalogInput): Promise<CweCatalogResult> {
  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.result);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const started = Date.now();
  const run = execute(input)
    .then((result) => {
      if (result.status === "ready") remember(key, result);
      return result;
    })
    .catch((error: unknown) => {
      if (error instanceof InfosecDoorError) {
        logger.warn("[SystemMap] infosec door failed", "system-map", { op: input.op, kind: error.kind, ms: Date.now() - started });
      }
      throw error;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

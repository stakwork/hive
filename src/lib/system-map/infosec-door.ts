/**
 * Client for the public `cwe-catalog` strut workflow on the infosec "door"
 * — the MITRE CWE catalogue shared by every workspace. No auth: a run is
 * launched (`POST …/public/workflows/cwe-catalog/run`) and read back
 * (`GET …/runs/:runId?wait=25&t=token`) until it finishes; the answer is
 * `output.result`.
 *
 * Env: `INFOSEC_DOOR_URL` (default `https://infosec.sphinx.chat:3355/lab`).
 *
 * "ready" answers are cached for an hour (the catalogue only changes on a
 * MITRE ingest) and identical concurrent requests share one run. Launches
 * are rate limited per caller address, so a 429 is retried with a short
 * back-off before giving up as `busy`.
 */

export const DEFAULT_INFOSEC_DOOR_URL = "https://infosec.sphinx.chat:3355/lab";
const READ_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const TOTAL_BUDGET_MS = 60_000;
const BUSY_BUDGET_MS = 20_000;
const MAX_LAUNCH_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [2_000, 4_000];
const CACHE_TTL_MS = 60 * 60 * 1000;
const READ_WAIT_SECONDS = 25;

export type InfosecDoorErrorKind = "busy" | "timeout" | "unavailable" | "failed" | "not_found";

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
  | { op: "related"; ref_id: string; cve_limit?: number }
  | { op: "cwe"; ref_id: string };

/** What the workflow answers (`output.result`): `status` plus op-specific fields. */
export type CweCatalogResult = { status: "ready" | "error"; error?: string } & Record<string, unknown>;

const cache = new Map<string, { at: number; result: CweCatalogResult }>();
const inFlight = new Map<string, Promise<CweCatalogResult>>();

export function clearInfosecDoorCache(): void {
  cache.clear();
  inFlight.clear();
}

function baseUrl(): string {
  return (process.env.INFOSEC_DOOR_URL || DEFAULT_INFOSEC_DOOR_URL).replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isTimeout(error)) throw new InfosecDoorError("Infosec catalogue did not answer in time", "timeout");
    throw new InfosecDoorError("Infosec catalogue could not be reached", "unavailable");
  }
}

async function launch(input: CweCatalogInput, startedAt: number): Promise<{ runId: string; token: string }> {
  const url = `${baseUrl()}/public/workflows/cwe-catalog/run`;
  for (let attempt = 0; ; attempt++) {
    const response = await request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, key: crypto.randomUUID() }),
      },
      LAUNCH_TIMEOUT_MS,
    );
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (DEFAULT_BACKOFF_MS[attempt] ?? 4_000);
      if (attempt + 1 >= MAX_LAUNCH_ATTEMPTS || Date.now() - startedAt + delay > BUSY_BUDGET_MS) {
        throw new InfosecDoorError("Infosec catalogue is busy, try again in a minute", "busy");
      }
      await sleep(delay);
      continue;
    }
    if (!response.ok) throw new InfosecDoorError(`Infosec catalogue launch failed (${response.status})`, "unavailable");
    const body = (await response.json().catch(() => null)) as { runId?: unknown; token?: unknown } | null;
    if (typeof body?.runId !== "string" || typeof body.token !== "string") {
      throw new InfosecDoorError("Infosec catalogue launch returned no run", "unavailable");
    }
    return { runId: body.runId, token: body.token };
  }
}

async function execute(input: CweCatalogInput): Promise<CweCatalogResult> {
  const startedAt = Date.now();
  const { runId, token } = await launch(input, startedAt);
  const url = `${baseUrl()}/public/workflows/cwe-catalog/runs/${encodeURIComponent(runId)}?wait=${READ_WAIT_SECONDS}&t=${encodeURIComponent(token)}`;
  while (Date.now() - startedAt < TOTAL_BUDGET_MS) {
    const response = await request(url, {}, READ_TIMEOUT_MS);
    if (!response.ok) throw new InfosecDoorError(`Infosec catalogue read failed (${response.status})`, "unavailable");
    const run = (await response.json().catch(() => null)) as {
      status?: string;
      output?: { result?: CweCatalogResult } | null;
    } | null;
    if (!run) throw new InfosecDoorError("Infosec catalogue returned an unreadable run", "unavailable");
    if (run.status === "success") {
      const result = run.output?.result;
      if (!result || typeof result !== "object") throw new InfosecDoorError("Infosec catalogue returned no result", "failed");
      return result;
    }
    if (run.status === "running" || run.status === "pending" || run.status === "queued") continue;
    throw new InfosecDoorError(`Infosec catalogue run ${run.status ?? "failed"}`, "failed");
  }
  throw new InfosecDoorError("Infosec catalogue did not answer in time", "timeout");
}

/** Run the `cwe-catalog` workflow for `input` and return its `output.result`. */
export function runCweCatalog(input: CweCatalogInput): Promise<CweCatalogResult> {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.result);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = execute(input)
    .then((result) => {
      if (result.status === "ready") cache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

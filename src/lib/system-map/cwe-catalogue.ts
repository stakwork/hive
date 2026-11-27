/**
 * The CWE catalogue behind the Infosec page's CWE lists tab, read from the
 * public `cwe-catalog` workflow (`infosec-door.ts`) — the same catalogue for
 * every workspace. The workflow does the graph walking and already answers in
 * the Hive response types; this module sends the op and turns an answer or a
 * failure into what the routes return, including the HTTP status for an error.
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import type { CweEntry, CweListMember, CweRelatedResponse } from "@/types/system-map";
import { InfosecDoorError, runCweCatalog, type CweCatalogResult, type InfosecDoorErrorKind } from "./infosec-door";

/** HTTP status the routes use for each door error kind. */
export const INFOSEC_DOOR_HTTP_STATUS: Record<InfosecDoorErrorKind, number> = {
  busy: 503,
  timeout: 504,
  unavailable: 502,
  failed: 502,
};

const NOT_FOUND = /not found|not in the|not a view/i;

export type CatalogueError = { ok: false; error: string; status: number; retryAfter?: number };

/** Seconds a busy client should wait (the door's limit is per minute). */
const BUSY_RETRY_AFTER_SECONDS = 60;

function fail(error: unknown): CatalogueError {
  if (error instanceof InfosecDoorError) {
    const out: CatalogueError = { ok: false, error: error.message, status: INFOSEC_DOOR_HTTP_STATUS[error.kind] };
    if (error.kind === "busy") out.retryAfter = BUSY_RETRY_AFTER_SECONDS;
    return out;
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error), status: 502 };
}

/** The door answered `status: "error"`: a missing view / CWE is a 404, anything else a 502. */
function answeredError(result: CweCatalogResult): CatalogueError {
  const error = typeof result.error === "string" && result.error ? result.error : "Infosec catalogue failed";
  return { ok: false, error, status: NOT_FOUND.test(error) ? 404 : 502 };
}

export type ListCweViewResult =
  | { ok: true; view: { id: string; name: string }; members: CweListMember[] }
  | CatalogueError;

/** A curated CWE view: its members, and the usable children of those MITRE says not to map to directly. */
export async function listCweView(viewId: string): Promise<ListCweViewResult> {
  try {
    const result = await runCweCatalog({ op: "view", view: viewId });
    if (result.status !== "ready") return answeredError(result);
    const members = (result.members as CweListMember[] | undefined) ?? [];
    logger.info("[SystemMap] CWE view", "system-map", { view: viewId, members: members.length });
    return { ok: true, view: result.view as { id: string; name: string }, members };
  } catch (error) {
    return fail(error);
  }
}

export type CweRelated = Extract<CweRelatedResponse, { status: "ready" }>;
export type LoadCweRelatedResult = { ok: true; related: CweRelated } | CatalogueError;

/** A CWE's test templates, mitigations, detection methods, platforms, CAPEC patterns and CVEs. */
export async function loadCweRelated(refId: string): Promise<LoadCweRelatedResult> {
  try {
    const result = await runCweCatalog({ op: "related", ref_id: refId });
    if (result.status !== "ready") return answeredError(result);
    const { status: _status, error: _error, ...rest } = result;
    void _status;
    void _error;
    return { ok: true, related: { status: "ready", ...rest } as unknown as CweRelated };
  } catch (error) {
    return fail(error);
  }
}

export type SearchCwesResult = { ok: true; results: CweEntry[] } | CatalogueError;

/** Any CWE — weakness, category or view — by id (`CWE-79`, `79`) or by name (up to 20). */
export async function searchCwes(query: string): Promise<SearchCwesResult> {
  const q = query.trim();
  if (!q) return { ok: true, results: [] };
  try {
    const result = await runCweCatalog({ op: "search", q });
    if (result.status !== "ready") return answeredError(result);
    return { ok: true, results: (result.results as CweEntry[] | undefined) ?? [] };
  } catch (error) {
    return fail(error);
  }
}

/** The routes' JSON response: 200 when ready; else the error status (503 carries `Retry-After`). */
export function catalogueResponse(outcome: { ok: true } | CatalogueError, body: unknown): NextResponse {
  if (outcome.ok) return NextResponse.json(body);
  const headers = outcome.retryAfter ? { "Retry-After": String(outcome.retryAfter) } : undefined;
  return NextResponse.json(body, { status: outcome.status, headers });
}

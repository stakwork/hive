/**
 * The CWE catalogue behind the Infosec page's CWE lists tab, read from the
 * public `cwe-catalog` workflow (`infosec-door.ts`) — the same catalogue for
 * every workspace. The workflow does the graph walking; this module sends the
 * op and maps the answer (or failure) to what the routes return, including
 * the HTTP status to use for an error.
 */

import { logger } from "@/lib/logger";
import type { CweEntry, CweListMember, CweRelatedResponse } from "@/types/system-map";
import { InfosecDoorError, runCweCatalog, type CweCatalogResult, type InfosecDoorErrorKind } from "./infosec-door";

/** HTTP status the routes use for each door error kind. */
export const INFOSEC_DOOR_HTTP_STATUS: Record<InfosecDoorErrorKind, number> = {
  busy: 503,
  timeout: 504,
  unavailable: 502,
  failed: 502,
  not_found: 404,
};

const NOT_FOUND = /not found|not in the|not a view/i;

export type CatalogueError = { ok: false; error: string; status: number };

function fail(error: unknown): CatalogueError {
  if (error instanceof InfosecDoorError) return { ok: false, error: error.message, status: INFOSEC_DOOR_HTTP_STATUS[error.kind] };
  return { ok: false, error: error instanceof Error ? error.message : String(error), status: 502 };
}

function failed(result: CweCatalogResult): CatalogueError {
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
    if (result.status !== "ready") return failed(result);
    const members = (result.members as CweListMember[] | undefined) ?? [];
    logger.info("[SystemMap] CWE view", "system-map", { view: viewId, members: members.length });
    return { ok: true, view: result.view as { id: string; name: string }, members };
  } catch (error) {
    return fail(error);
  }
}

export type CweRelated = Extract<CweRelatedResponse, { status: "ready" }>;

/**
 * A CWE's test templates, mitigations, detection methods, platforms, CAPEC
 * patterns and CVEs. Throws `InfosecDoorError` (`not_found` for an unknown CWE).
 */
export async function loadCweRelated(refId: string): Promise<CweRelated> {
  const result = await runCweCatalog({ op: "related", ref_id: refId });
  if (result.status !== "ready") {
    const error = typeof result.error === "string" && result.error ? result.error : "Infosec catalogue failed";
    throw new InfosecDoorError(error, NOT_FOUND.test(error) ? "not_found" : "failed");
  }
  const { status: _status, error: _error, ...rest } = result;
  void _status;
  void _error;
  return { status: "ready", ...rest } as unknown as CweRelated;
}

export type SearchCwesResult = { ok: true; results: CweEntry[] } | CatalogueError;

/** Any CWE — weakness, category or view — by id (`CWE-79`, `79`) or by name (up to 20). */
export async function searchCwes(query: string): Promise<SearchCwesResult> {
  const q = query.trim();
  if (!q) return { ok: true, results: [] };
  try {
    const result = await runCweCatalog({ op: "search", q });
    if (result.status !== "ready") return failed(result);
    return { ok: true, results: (result.results as CweEntry[] | undefined) ?? [] };
  } catch (error) {
    return fail(error);
  }
}

export { InfosecDoorError };

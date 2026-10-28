import { logger } from "@/lib/logger";
import { records, swarmCypherRunner } from "@/lib/strut-run-graph/hydrate";
import { labForRow } from "@/services/strut-runs";
import { resolveStrutTarget } from "@/services/strut-target";
import {
  SECURITY_AUDIT_CLASS_FALLBACK,
  fallbackSecurityAuditClasses,
  type SecurityAuditClassInfo,
} from "./security-audit";

/** The "Security Audit" Concept in the org strut's graph; its PARENT_OF children are the classes. */
const SECURITY_AUDIT_CONCEPT_REF = "33ac6244-a068-4e56-a385-cc7943465ae4";
/** A Concept's ref_id is a UUID; anything else read from the graph is not trusted as an id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const HUNT_MAX_CHARS = 400;

let cache: { at: number; classes: SecurityAuditClassInfo[] } | null = null;

/** Test hook. */
export function clearSecurityAuditClassesCache(): void {
  cache = null;
}

/** The "## What to hunt" section of a class's docs as plain text, trimmed to ~400 chars. */
export function huntExcerpt(docs: string): string {
  const section = docs.match(/^##\s+What to hunt\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] ?? "";
  const text = section
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > HUNT_MAX_CHARS ? `${text.slice(0, HUNT_MAX_CHARS).trimEnd()}…` : text;
}

async function readLiveClasses(workspaceId: string, userId: string): Promise<SecurityAuditClassInfo[] | null> {
  const resolved = await resolveStrutTarget({ purpose: "system_map", userId, workspaceId });
  if (!resolved.ok) return null;
  const lab = await labForRow({ swarmId: resolved.target.swarmId });
  if (!lab) return null;
  const run = swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey });
  const result = await run(
    `MATCH (:Data_Bank {ref_id: '${SECURITY_AUDIT_CONCEPT_REF}'})-[:PARENT_OF]->(c:Data_Bank) ` +
      `RETURN c.ref_id AS ref_id, c.name AS name, c.description AS description, c.docs AS docs`,
    100,
  );
  if ("unread" in result) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const classes: SecurityAuditClassInfo[] = [];
  // By column name: upstream orders the columns its own way, not as RETURNed.
  for (const row of records(result)) {
    const [ref_id, name, description, docs] = [row.ref_id, row.name, row.description, row.docs].map(str);
    if (!name) continue;
    const builtIn = (SECURITY_AUDIT_CLASS_FALLBACK as Record<string, string | undefined>)[name];
    classes.push({
      ref_id: UUID_RE.test(ref_id) ? ref_id : null,
      name,
      description: description || builtIn || "",
      hunt: huntExcerpt(docs),
      fallback: !description,
    });
  }
  return classes.length > 0 ? classes : null;
}

/**
 * The audit's attack classes with descriptions, read live from the Concepts
 * under "Security Audit" in the org strut's graph (cached a few minutes);
 * the built-in list when that can't be read.
 */
export async function getSecurityAuditClasses(workspaceId: string, userId: string): Promise<SecurityAuditClassInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.classes;
  try {
    const live = await readLiveClasses(workspaceId, userId);
    if (live) {
      cache = { at: Date.now(), classes: live };
      return live;
    }
  } catch (error) {
    logger.warn("Could not read the security audit classes", "SYSTEM_MAP", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return fallbackSecurityAuditClasses();
}

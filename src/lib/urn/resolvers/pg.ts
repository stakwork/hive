/**
 * `pg` realm resolver — wraps `loadNodeDetail` for URN-addressed PG entities.
 *
 * IDOR guarantee: the `orgId` used when calling `loadNodeDetail` is always
 * derived from the `{org}` segment of the URN itself (looked up via
 * `githubLogin`), never from caller-supplied input.
 */

import { db } from "@/lib/db";
import { loadNodeDetail, type NodeDetail } from "@/services/orgs/nodeDetail";
import { parseUrn } from "../parse";

export async function resolvePgNode(urn: string): Promise<NodeDetail | null> {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "pg") return null;

  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin: parsed.org },
    select: { id: true },
  });
  if (!org) return null;

  return loadNodeDetail(parsed.type, parsed.id, org.id);
}

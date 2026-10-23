import { db } from "@/lib/db";
import { sanitizePageContext, type PageContext } from "@/lib/jamie-page-context";

/**
 * A sanitised page context whose refs belong to the user's org: `ws:<id>`
 * must be a workspace of the org, `initiative:<id>` an initiative of it,
 * `feature:<id>` / `milestone:<id>` a feature / milestone under one. Refs
 * the hive DB does not own (graph ref_ids) pass only when `trustedRefs`
 * names them — the ids `parseInitiativeFocus` already checked against the
 * request's workspaces. The path is cut at the first step that fails, so a
 * forged ref never leaves a name behind. Fails closed: a DB error drops it.
 */
export async function verifyPageContextRefs(
  ctx: PageContext | undefined,
  orgId: string,
  trustedRefs: ReadonlySet<string> = new Set(),
): Promise<PageContext | undefined> {
  if (!ctx) return undefined;
  try {
    const ids = (prefix: string) =>
      ctx.path.flatMap((s) => (s.ref?.startsWith(prefix) ? [s.ref.slice(prefix.length)] : []));
    const [ws, inits, feats, miles] = await Promise.all([
      ids("ws:").length
        ? db.workspace.findMany({ where: { id: { in: ids("ws:") }, sourceControlOrgId: orgId, deleted: false }, select: { id: true } })
        : [],
      ids("initiative:").length
        ? db.initiative.findMany({ where: { id: { in: ids("initiative:") }, orgId }, select: { id: true } })
        : [],
      ids("feature:").length
        ? db.feature.findMany({
            where: { id: { in: ids("feature:") }, workspace: { sourceControlOrgId: orgId, deleted: false } },
            select: { id: true },
          })
        : [],
      ids("milestone:").length
        ? db.milestone.findMany({ where: { id: { in: ids("milestone:") }, initiative: { orgId } }, select: { id: true } })
        : [],
    ]);
    const ok = new Set<string>([
      ...ws.map((x) => `ws:${x.id}`),
      ...inits.map((x) => `initiative:${x.id}`),
      ...feats.map((x) => `feature:${x.id}`),
      ...miles.map((x) => `milestone:${x.id}`),
      ...trustedRefs,
    ]);
    const owned = (ref: string) => ok.has(ref);
    // A step with no ref is only the org root; anything else unverifiable cuts the path.
    const cut = ctx.path.findIndex((s, i) => (s.ref === undefined ? !(i === 0 && s.kind === "org") : !owned(s.ref)));
    const path = cut === -1 ? ctx.path : ctx.path.slice(0, cut);
    // Selections and the question are refs too: only the trusted ones stay.
    const selected = ctx.selected?.filter((s) => owned(s.ref));
    const question = ctx.question && owned(ctx.question.ref) ? ctx.question : undefined;
    return { ...ctx, path, selected: selected?.length ? selected : undefined, question };
  } catch {
    return undefined;
  }
}

/** Sanitise then verify: the one call the route makes. */
export async function readPageContext(raw: unknown, orgId: string, trustedRefs?: ReadonlySet<string>) {
  return verifyPageContextRefs(sanitizePageContext(raw), orgId, trustedRefs);
}

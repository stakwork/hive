/**
 * Tribe links (`docs/plans/jamie-in-tribes.md`): a Sphinx tribe linked by
 * its owner to one of their orgs, so `@jamie` there is a turn of that
 * org's orchestrator, run as the member who asked when the tribe names them
 * (a mention's `sender`), else as the person who linked it.
 *
 * Peel links and unlinks with the device credential
 * (`/api/strut-devices/tribes`); every change is told to Jamie as an entry
 * in its outbox (`TribeOutboxEntry`) — a join, a leave, or a notice — since
 * Hive never calls Jamie: Jamie polls (`/api/tribes/outbox`).
 */

import { db } from "@/lib/db";
import { SPHINX_PUBKEY_RE } from "@/lib/tribes/jamie";

/** A tribe server's host as a tribe link names it: a name and maybe a port, no scheme or path. */
const TRIBE_HOST_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const MAX_HOST_CHARS = 253;
const MAX_NAME_CHARS = 200;

/** How often a tribe is told its link no longer works: once a day at most. */
export const TRIBE_NOTICE_INTERVAL_MS = 24 * 3600 * 1000;

export interface TribeRef {
  pubkey: string;
  host: string;
}

/** The tribe a body names, or what is wrong with it. */
export function parseTribeRef(raw: unknown): TribeRef | string {
  if (!raw || typeof raw !== "object") return "tribe is required: { pubkey, host }";
  const t = raw as Record<string, unknown>;
  const pubkey = typeof t.pubkey === "string" ? t.pubkey.trim().toLowerCase() : "";
  if (!SPHINX_PUBKEY_RE.test(pubkey)) return "tribe.pubkey must be a tribe's pubkey (66 hex characters)";
  const host = typeof t.host === "string" ? t.host.trim() : "";
  if (!host || host.length > MAX_HOST_CHARS || !TRIBE_HOST_RE.test(host)) {
    return "tribe.host must be the tribe server's host (tribes.v2.sphinx.chat)";
  }
  return { pubkey, host };
}

/** A tribe's name as shown on one line, or null. */
export function tribeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return name || null;
}

/** The tribe's share link, what Jamie joins by (stakwork/sphinx `wasm/test/auto/links.ts`). */
export function tribeJoinLink(tribe: TribeRef): string {
  return `sphinx.chat://?action=tribeV2&pubkey=${tribe.pubkey}&host=${tribe.host}`;
}

export type LinkableWorkspace =
  | { ok: true; workspaceSlug: string; orgId: string }
  | { ok: false; status: number; error: string };

/**
 * The checks a link makes before it is stored, as `startCall` makes them:
 * the workspace, the person's access to it, and its org — the org's strut
 * runs the turns. Every turn checks the access again (`validateWorkspaceAccess`).
 */
export async function linkableWorkspace(userId: string, slug: string): Promise<LinkableWorkspace> {
  const workspace = await db.workspace.findFirst({
    where: { slug, deleted: false },
    select: {
      slug: true,
      ownerId: true,
      sourceControlOrgId: true,
      members: { where: { userId, leftAt: null }, select: { id: true } },
    },
  });
  if (!workspace) return { ok: false, status: 404, error: "Workspace not found" };
  if (workspace.ownerId !== userId && workspace.members.length === 0) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (!workspace.sourceControlOrgId) {
    return { ok: false, status: 400, error: "Workspace is not linked to a source-control org" };
  }
  return { ok: true, workspaceSlug: workspace.slug, orgId: workspace.sourceControlOrgId };
}

/** The link as the person's devices see it. */
export function tribeLinkView(link: {
  tribePubkey: string;
  tribeHost: string;
  name: string | null;
  workspaceSlug: string;
  createdAt: Date;
  org: { githubLogin: string };
}) {
  return {
    pubkey: link.tribePubkey,
    host: link.tribeHost,
    name: link.name,
    workspace: link.workspaceSlug,
    org: link.org.githubLogin,
    createdAt: link.createdAt.toISOString(),
  };
}

/** Tell Jamie to join the tribe. Already in it is done on its side. */
export async function queueTribeJoin(tribe: TribeRef): Promise<void> {
  await db.tribeOutboxEntry.create({ data: { tribePubkey: tribe.pubkey, kind: "join", link: tribeJoinLink(tribe) } });
}

/** Tell Jamie to leave the tribe. */
export async function queueTribeLeave(pubkey: string): Promise<void> {
  await db.tribeOutboxEntry.create({ data: { tribePubkey: pubkey, kind: "leave" } });
}

/**
 * One line for the tribe, threaded under `replyTo` — unless the tribe was
 * sent a notice in the last day: each one costs Jamie sats, and a tribe
 * that keeps mentioning it needs telling once.
 */
export async function queueTribeNotice(pubkey: string, text: string, replyTo?: string, now = new Date()): Promise<boolean> {
  const recent = await db.tribeOutboxEntry.findFirst({
    where: { tribePubkey: pubkey, kind: "notice", createdAt: { gt: new Date(now.getTime() - TRIBE_NOTICE_INTERVAL_MS) } },
    select: { id: true },
  });
  if (recent) return false;
  await db.tribeOutboxEntry.create({
    data: { tribePubkey: pubkey, kind: "notice", text, ...(replyTo ? { replyTo } : {}) },
  });
  return true;
}

/**
 * A line Jamie posts under one member's message, answering it (`kind:
 * "reply"`): not held to the notices' once a day, nor counted in it, since
 * the caller takes each message once.
 */
export function queueTribeReply(pubkey: string, text: string, replyTo: string) {
  return db.tribeOutboxEntry.create({ data: { tribePubkey: pubkey, kind: "reply", text, replyTo } });
}

/** A person as the tribe is told of them: their name in Hive, else their Sphinx alias; null with neither. */
export function tribePersonName(user: { name: string | null; sphinxAlias?: string | null } | null | undefined): string | null {
  return user?.name?.trim() || user?.sphinxAlias?.trim() || null;
}

/**
 * The reply a member the tribe does not name gets for a decision on a
 * proposal of a turn that ran as the person who linked it: the tribe's
 * owner decides.
 */
export const TRIBE_OWNER_DECIDES = "Only the tribe's owner can decide this one.";

/** The reply anyone else gets for a decision on a proposal: the person the turn ran as decides. */
export function tribeDecidedBy(name: string | null): string {
  return name ? `${name}'s to decide.` : "This one is the asker's to decide.";
}

/** The notice a tribe gets when the person who linked it can no longer use its workspace. */
export const TRIBE_ACCESS_LOST_NOTICE =
  "I can't answer here any more: the person who linked this tribe can no longer use its workspace in Hive. " +
  "The tribe's owner can link it again in Peel.";

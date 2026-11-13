/**
 * POST /api/orgs/[githubLogin]/canvas/trace
 *
 * Highlight-to-trace: a user selected a number, phrase or lines of code in
 * a Jamie reply (or a strut job-card reply embedded in one), and asked
 * where it came from. This resolves the chain (`services/trace`) and
 * stores the result as an inline `trace` artifact ref on the source
 * message, so reopening the chat still shows it.
 *
 * Body: `{ conversationId, messageId, selection, run? }`. `run`, when
 * given, is `{ workspace, run }` — the `StrutRun` a strut job-card's reply
 * came from (the same shape `run_graph` content carries), for a selection
 * made directly in that run's output rather than in Jamie's own text.
 *
 * IDOR, before any lab or model call:
 *   1. A session (middleware), and the caller belongs to `githubLogin`.
 *   2. The conversation is this org's, and the caller owns it or it is
 *      shared (`isShared`) — the same rule the conversations route reads
 *      it by. 404 (not 403) either way, so a private row of someone
 *      else's reads as missing.
 *   3. When `run` is given, the caller must be a MEMBER of that workspace
 *      (`resolveWorkspaceAccess`) before the run row — let alone its
 *      events — is read.
 *
 * A strut hand-off a Jamie tool output names (a `runId` in its output) is
 * followed the same way, inside `services/trace`, and is silently skipped
 * (logged, not surfaced) when the caller may not read that workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { fetchStrutRunEvents, fetchStrutRunOutput } from "@/services/strut-runs/lab";
import {
  buildStrutSteps,
  loadJamieSources,
  resolveTrace,
  traceArtifactId,
  type JamieMessageLike,
  type TraceSourceStep,
} from "@/services/trace";
import { traceLog } from "@/services/trace/log";
import { appendTraceArtifact } from "@/services/trace/store";
import { validateUserBelongsToOrg } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_SELECTION = 2000;
/** How many of a strut run's full outputs are fetched for one trace request. */
const MAX_FULL_OUTPUTS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface TraceBody {
  conversationId: string;
  messageId: string;
  selection: string;
  run?: { workspace: string; run: string };
}

function parseBody(raw: unknown): TraceBody | null {
  if (!isRecord(raw)) return null;
  const { conversationId, messageId, selection } = raw;
  if (typeof conversationId !== "string" || !conversationId) return null;
  if (typeof messageId !== "string" || !messageId) return null;
  if (typeof selection !== "string" || !selection.trim() || selection.length > MAX_SELECTION) return null;
  if (raw.run === undefined) return { conversationId, messageId, selection: selection.trim() };
  const run = raw.run;
  if (!isRecord(run) || typeof run.workspace !== "string" || typeof run.run !== "string" || !run.workspace || !run.run) {
    return null;
  }
  return { conversationId, messageId, selection: selection.trim(), run: { workspace: run.workspace, run: run.run } };
}

/** Full outputs for a bounded number of this run's events that carry an `outputRef`, keyed by that ref. */
async function fullOutputsFor(row: Parameters<typeof fetchStrutRunEvents>[0], events: unknown[]): Promise<Map<string, string>> {
  const refs = events
    .flatMap((event) => (isRecord(event) && typeof event.outputRef === "string" ? [event.outputRef] : []))
    .slice(0, MAX_FULL_OUTPUTS);
  const outputs = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      const text = await fetchStrutRunOutput(row, ref);
      if (text !== null) outputs.set(ref, text);
    }),
  );
  return outputs;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const body = parseBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: "conversationId, messageId and selection are required" }, { status: 400 });
  }

  const isMember = await validateUserBelongsToOrg(githubLogin, userId);
  if (!isMember) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const org = await db.sourceControlOrg.findUnique({ where: { githubLogin }, select: { id: true } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conversation = await db.sharedConversation.findFirst({
    where: { id: body.conversationId, sourceControlOrgId: org.id },
    select: { id: true, userId: true, isShared: true, messages: true },
  });
  if (!conversation || (conversation.userId !== userId && !conversation.isShared)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = Array.isArray(conversation.messages) ? (conversation.messages as unknown as JamieMessageLike[]) : [];
  if (!messages.some((m) => isRecord(m) && m.id === body.messageId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A direct run reference must be the caller's to read BEFORE anything of
  // the run — let alone its events — is fetched.
  let runRow: { id: string; workspaceId: string; swarmId: string; workflow: string; strutRunId: string | null } | null = null;
  if (body.run) {
    const member = requireMemberAccess(await resolveWorkspaceAccess(request, { slug: body.run.workspace }));
    if (member instanceof NextResponse) return NextResponse.json({ error: "Not found" }, { status: 404 });
    runRow = await db.strutRun.findFirst({
      where: { id: body.run.run, workspaceId: member.workspaceId },
      select: { id: true, workspaceId: true, swarmId: true, workflow: true, strutRunId: true },
    });
    if (!runRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let steps: TraceSourceStep[];
  let originOrder: number | undefined;
  const origin = body.run
    ? ({ kind: "strut" as const, conversationId: body.conversationId, messageId: body.messageId, workspace: body.run.workspace, run: body.run.run })
    : ({ kind: "jamie" as const, conversationId: body.conversationId, messageId: body.messageId });

  if (runRow) {
    const events = await fetchStrutRunEvents(runRow);
    if (!events) traceLog.info("no sources", { reason: "run events unavailable" });
    const outputs = events ? await fullOutputsFor(runRow, events) : new Map<string, string>();
    steps = buildStrutSteps(events ?? [], outputs);
  } else {
    steps = await loadJamieSources(messages, async (runId) => {
      const row = await db.strutRun.findFirst({
        where: { OR: [{ id: runId }, { strutRunId: runId }] },
        select: { id: true, workspaceId: true, swarmId: true, workflow: true, strutRunId: true },
      });
      if (!row) return null;
      const workspace = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } });
      if (!workspace) return null;
      const access = await resolveWorkspaceAccess(request, { slug: workspace.slug });
      if (access.kind !== "member") {
        traceLog.info("strut hand-off denied", { runId, workspace: workspace.slug });
        return null;
      }
      const events = await fetchStrutRunEvents(row);
      if (!events) return null;
      const outputs = await fullOutputsFor(row, events);
      return buildStrutSteps(events, outputs);
    });
    originOrder = steps.find((step) => step.key === body.messageId)?.order;
  }

  const content = await resolveTrace({ selection: body.selection, origin, steps, originOrder });

  const ref: ArtifactRef = {
    id: traceArtifactId(body.messageId, body.selection),
    kind: "trace",
    title: body.selection.length > 80 ? `${body.selection.slice(0, 80)}…` : body.selection,
    label: "Lineage",
    source: { type: "inline", content: content as unknown as Record<string, unknown> },
  };

  await appendTraceArtifact(body.conversationId, body.messageId, ref);

  return NextResponse.json({ artifact: ref });
}

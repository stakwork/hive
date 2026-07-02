import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-keys";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { resolveRepoKey, computeFingerprint } from "@/lib/utils/error-fingerprint";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/errors
 *
 * Public, ingest-key-authenticated endpoint for external apps to report
 * runtime errors into Hive. Mirrors the /api/webhook/agent-logs conventions.
 *
 * Auth: `Authorization: Bearer <key>` or `x-api-key` header — validated
 * against WorkspaceApiKey via validateApiKey(). No user session required.
 * The resolved workspace is authoritative for ALL subsequent lookups; the
 * request body MUST NOT be trusted for workspace or repo scoping (IDOR guard).
 *
 * Body (JSON):
 *   exceptionType  string   — required. e.g. "TypeError", "ValueError"
 *   message        string   — required. human-readable error message
 *   stackTrace?    string   — optional. raw stack trace text
 *   environment?   string   — optional. e.g. "production", "staging"
 *   release?       string   — optional. version/release tag
 *   repository?    string   — optional. URL or name; resolved to a Repository
 *   requestContext? object  — optional. HTTP request details, headers, etc.
 *   metadata?      object   — optional. arbitrary free-form fields
 *   fingerprint?   string   — optional. client-supplied grouping override
 *
 * Response 201:
 *   { success: true, data: { issueId, eventId, fingerprint, repositoryId, occurrenceCount, isNew } }
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization") ?? "";
    const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const apiKeyHeader = request.headers.get("x-api-key");
    const rawKey = bearerKey ?? apiKeyHeader;

    if (!rawKey) {
      console.warn("[error-ingest] auth failed: no key provided");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authResult = await validateApiKey(rawKey);
    if (!authResult) {
      console.warn("[error-ingest] auth failed: invalid/revoked/expired key");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The workspace from the key is the ONLY authoritative source — never trust body
    const { workspace } = authResult;
    console.info("[error-ingest] auth ok", { workspaceId: workspace.id, keyId: authResult.apiKey.id });

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const exceptionType = typeof body.exceptionType === "string" ? body.exceptionType.trim() : null;
    const message = typeof body.message === "string" ? body.message.trim() : null;

    if (!exceptionType) {
      return NextResponse.json({ error: "Missing required field: exceptionType" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Missing required field: message" }, { status: 400 });
    }

    const stackTrace = typeof body.stackTrace === "string" ? body.stackTrace : null;
    const environment = typeof body.environment === "string" ? body.environment.trim() : null;
    const release = typeof body.release === "string" ? body.release.trim() : null;
    const repository = typeof body.repository === "string" ? body.repository : null;
    const requestContext =
      body.requestContext && typeof body.requestContext === "object" && !Array.isArray(body.requestContext)
        ? (body.requestContext as Record<string, unknown>)
        : null;
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : null;
    const clientFingerprint = typeof body.fingerprint === "string" ? body.fingerprint : null;

    console.info("[error-ingest] payload shape", {
      exceptionType,
      hasStack: !!stackTrace,
      hasRepo: !!repository,
      hasClientFingerprint: !!clientFingerprint,
    });

    // ── Repo resolution (IDOR-safe: scoped to authenticated workspace only) ──
    // All DB lookups use the authenticated workspace.id — body values are never
    // trusted for workspace or repo scoping.
    const { repositoryId, repoKey } = await resolveRepoKey({
      workspaceId: workspace.id,
      repository,
    });
    console.info("[error-ingest] repo resolution", {
      repository,
      repositoryId,
      repoKey,
      matched: !!repositoryId,
    });

    // ── Fingerprint ──────────────────────────────────────────────────────────
    const fingerprint = computeFingerprint({ exceptionType, stackTrace, clientFingerprint });
    console.info("[error-ingest] fingerprint", { fingerprint, clientOverride: !!clientFingerprint });

    // ── Blob upload (raw payload) ─────────────────────────────────────────────
    const blobPath = `errors/${workspace.id}/${repoKey}/${fingerprint}`;
    const blobKey = `${blobPath}/${Date.now()}.json`;

    const blob = await put(blobKey, JSON.stringify(body), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.info("[error-ingest] blob uploaded", { blobKey, url: blob.url });

    // ── Upsert ErrorIssue ─────────────────────────────────────────────────────
    // Unique key: (workspaceId, repoKey, fingerprint).
    // On conflict: increment occurrenceCount, bump lastSeenAt, refresh
    //   environment/release to the latest occurrence's values.
    // We deliberately do NOT reset status on repeat occurrences — a
    //   RESOLVED or IGNORED issue should not automatically reopen when a new
    //   event arrives; re-opening is a deliberate triage action.
    const now = new Date();
    const existingIssue = await db.errorIssue.findUnique({
      where: {
        workspaceId_repoKey_fingerprint: { workspaceId: workspace.id, repoKey, fingerprint },
      },
      select: { id: true },
    });

    const isNew = !existingIssue;

    const issue = existingIssue
      ? await db.errorIssue.update({
          where: {
            workspaceId_repoKey_fingerprint: { workspaceId: workspace.id, repoKey, fingerprint },
          },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeenAt: now,
            // Refresh env/release to the values from the latest occurrence
            environment: environment ?? undefined,
            release: release ?? undefined,
          },
        })
      : await db.errorIssue.create({
          data: {
            workspaceId: workspace.id,
            repositoryId: repositoryId ?? undefined,
            repoKey,
            fingerprint,
            exceptionType,
            // Title is the first 255 chars of the message — representative of the issue
            title: message.slice(0, 255),
            occurrenceCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
            environment: environment ?? undefined,
            release: release ?? undefined,
            metadata: metadata as Prisma.InputJsonValue ?? undefined,
          },
        });

    console.info(
      isNew ? "[error-ingest] ErrorIssue created" : "[error-ingest] ErrorIssue updated (upsert)",
      { issueId: issue.id, fingerprint, repoKey, occurrenceCount: issue.occurrenceCount }
    );

    // ── Create ErrorEvent ────────────────────────────────────────────────────
    // Created after the issue upsert so issueId is available.
    const event = await db.errorEvent.create({
      data: {
        issueId: issue.id,
        workspaceId: workspace.id,
        repositoryId: repositoryId ?? undefined,
        repoKey,
        blobUrl: blob.url,
        exceptionType,
        message,
        environment: environment ?? undefined,
        release: release ?? undefined,
        requestContext: requestContext as Prisma.InputJsonValue ?? undefined,
        metadata: metadata as Prisma.InputJsonValue ?? undefined,
        fingerprint,
      },
    });

    // ── Pusher broadcast ──────────────────────────────────────────────────────
    try {
      await pusherServer.trigger(
        getWorkspaceChannelName(workspace.slug),
        PUSHER_EVENTS.ERROR_ISSUE_UPDATED,
        {
          id: issue.id,
          repositoryId: issue.repositoryId,
          fingerprint,
          isNew,
          occurrenceCount: issue.occurrenceCount,
          status: issue.status,
          lastSeenAt: issue.lastSeenAt,
        }
      );
      console.info("[error-ingest] Pusher broadcast ok", { issueId: issue.id, isNew });
    } catch (err) {
      console.error("[error-ingest] Pusher broadcast failed (non-fatal)", err);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          issueId: issue.id,
          eventId: event.id,
          fingerprint,
          repositoryId: issue.repositoryId,
          occurrenceCount: issue.occurrenceCount,
          isNew,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[error-ingest] unexpected error", error);
    return NextResponse.json({ error: "Failed to process error report" }, { status: 500 });
  }
}

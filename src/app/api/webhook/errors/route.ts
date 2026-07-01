import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { validateApiKey } from "@/lib/api-keys";
import { computeFingerprint } from "@/lib/utils/error-fingerprint";

export const fetchCache = "force-no-store";

/**
 * POST /api/webhook/errors
 *
 * Public, key-authenticated error-ingest endpoint. External applications
 * POST runtime errors; each occurrence is stored as an ErrorEvent and rolled
 * up — via a computed fingerprint — into a grouped ErrorIssue.
 *
 * Auth: Authorization: Bearer <workspace-api-key>  (fallback: x-api-key header)
 * The workspace is ALWAYS resolved from the validated key — never from the body.
 *
 * Body (JSON):
 *   exceptionType:     string   — Exception class / error type (required)
 *   message:           string   — Error message (required)
 *   stackTrace?:       string   — Raw stack trace text
 *   environment?:      string   — Runtime environment (e.g. "production", "staging")
 *   release?:          string   — App version / release identifier
 *   requestContext?:   object   — HTTP request details (URL, method, headers, …)
 *   metadata?:         object   — Arbitrary free-form metadata
 *   fingerprint?:      string   — Client-supplied fingerprint override
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth: resolve workspace from ingest key ───────────────────────────────
    // Read from Authorization: Bearer <key> first, fall back to x-api-key header
    // (parity with /api/graph/webhook/route.ts)
    const authHeader = request.headers.get("authorization") ?? "";
    const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const headerKey = request.headers.get("x-api-key");
    const rawKey = bearerKey ?? headerKey ?? null;

    if (!rawKey) {
      console.info("[error-ingest] auth failed: no key provided");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const keyResult = await validateApiKey(rawKey);
    if (!keyResult) {
      console.info("[error-ingest] auth failed: invalid/revoked/expired key");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // IDOR guard: workspace is derived SOLELY from the validated key from here on.
    const { workspace } = keyResult;
    console.info("[error-ingest] auth success", { workspaceId: workspace.id, workspaceSlug: workspace.slug });

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const exceptionType = typeof body.exceptionType === "string" ? body.exceptionType.trim() : null;
    const message = typeof body.message === "string" ? body.message.trim() : null;
    const stackTrace = typeof body.stackTrace === "string" ? body.stackTrace : undefined;
    const environment = typeof body.environment === "string" ? body.environment : undefined;
    const release = typeof body.release === "string" ? body.release : undefined;
    const requestContext =
      body.requestContext && typeof body.requestContext === "object" && !Array.isArray(body.requestContext)
        ? (body.requestContext as Record<string, unknown>)
        : undefined;
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : undefined;
    const clientFingerprint = typeof body.fingerprint === "string" ? body.fingerprint : undefined;

    // Required fields
    if (!exceptionType) {
      return NextResponse.json({ error: "Missing or invalid 'exceptionType' field" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Missing or invalid 'message' field" }, { status: 400 });
    }

    console.info("[error-ingest] payload shape", {
      workspaceId: workspace.id,
      exceptionType,
      hasStackTrace: !!stackTrace,
      hasClientFingerprint: !!clientFingerprint,
      environment,
      release,
    });

    // ── Compute fingerprint ───────────────────────────────────────────────────
    const fingerprint = computeFingerprint({ exceptionType, stackTrace, clientFingerprint });

    // ── Blob upload ───────────────────────────────────────────────────────────
    const eventId = randomUUID();
    const blobPath = `errors/${workspace.id}/${fingerprint}/${eventId}.json`;
    const blobPayload = {
      exceptionType,
      message,
      ...(stackTrace !== undefined && { stackTrace }),
      ...(environment !== undefined && { environment }),
      ...(release !== undefined && { release }),
      ...(requestContext !== undefined && { requestContext }),
      ...(metadata !== undefined && { metadata }),
      ...(clientFingerprint !== undefined && { fingerprint: clientFingerprint }),
    };

    const blob = await put(blobPath, JSON.stringify(blobPayload), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.info("[error-ingest] blob upload success", { blobPath, blobUrl: blob.url });

    // ── Create ErrorEvent ─────────────────────────────────────────────────────
    // We need an issueId from the upsert below. Run event create + issue upsert
    // in a transaction to keep counts consistent.
    const now = new Date();

    const { event, issue, isNew } = await db.$transaction(async (tx) => {
      // Upsert ErrorIssue
      //
      // Status policy: new occurrences of an already-resolved/ignored issue do
      // NOT automatically flip it back to UNRESOLVED. Teams may intentionally
      // silence noisy errors; re-opening on every occurrence would defeat that
      // workflow. The occurrence count and lastSeenAt are always refreshed so
      // teams can still observe the recurrence rate.
      const existingIssue = await tx.errorIssue.findUnique({
        where: { workspaceId_fingerprint: { workspaceId: workspace.id, fingerprint } },
        select: { id: true },
      });

      let upsertedIssue;
      let created: boolean;

      if (existingIssue) {
        upsertedIssue = await tx.errorIssue.update({
          where: { id: existingIssue.id },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeenAt: now,
            environment: environment ?? undefined,
            release: release ?? undefined,
          },
        });
        created = false;
        console.info("[error-ingest] issue upsert (existing)", {
          issueId: upsertedIssue.id,
          fingerprint,
          occurrenceCount: upsertedIssue.occurrenceCount,
        });
      } else {
        upsertedIssue = await tx.errorIssue.create({
          data: {
            workspaceId: workspace.id,
            fingerprint,
            exceptionType,
            title: message.slice(0, 500), // cap display title at 500 chars
            firstSeenAt: now,
            lastSeenAt: now,
            environment: environment ?? null,
            release: release ?? null,
            metadata: metadata as Prisma.InputJsonValue | undefined,
          },
        });
        created = true;
        console.info("[error-ingest] issue upsert (new)", {
          issueId: upsertedIssue.id,
          fingerprint,
        });
      }

      // Create ErrorEvent
      const createdEvent = await tx.errorEvent.create({
        data: {
          id: eventId,
          issueId: upsertedIssue.id,
          workspaceId: workspace.id,
          blobUrl: blob.url,
          exceptionType,
          message,
          fingerprint,
          environment: environment ?? null,
          release: release ?? null,
          requestContext: requestContext as Prisma.InputJsonValue | undefined,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });

      return { event: createdEvent, issue: upsertedIssue, isNew: created };
    });

    // ── Pusher broadcast ──────────────────────────────────────────────────────
    try {
      await pusherServer.trigger(
        getWorkspaceChannelName(workspace.slug),
        PUSHER_EVENTS.ERROR_ISSUE_UPDATED,
        {
          id: issue.id,
          fingerprint,
          isNew,
          occurrenceCount: issue.occurrenceCount,
          status: issue.status,
          lastSeenAt: issue.lastSeenAt,
        }
      );
      console.info("[error-ingest] pusher broadcast success", {
        issueId: issue.id,
        isNew,
        occurrenceCount: issue.occurrenceCount,
      });
    } catch (err) {
      console.error("[error-ingest] pusher broadcast failed (non-fatal)", err);
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return NextResponse.json(
      {
        success: true,
        data: {
          issueId: issue.id,
          eventId: event.id,
          fingerprint,
          occurrenceCount: issue.occurrenceCount,
          isNew,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[error-ingest] unexpected error", error);
    return NextResponse.json({ error: "Failed to process error event" }, { status: 500 });
  }
}

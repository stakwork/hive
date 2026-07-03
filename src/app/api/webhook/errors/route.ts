import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-keys";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { resolveRepoKey, computeFingerprint } from "@/lib/utils/error-fingerprint";
import { sanitizeFrames } from "@/lib/utils/error-frames";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addNode, addEdge, searchLatestByTypes, getReferencedNodeCentrality } from "@/services/swarm/api/nodes";
import { computeImpactScore } from "@/services/error-impact";

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
 *   commitSha?     string   — optional. commit SHA the error occurred on (pins stack frames to exact source)
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
    const frames = sanitizeFrames(body.frames);
    // Overwrite body.frames with sanitized array before blob persist — malformed entries never stored
    body.frames = frames;
    const environment = typeof body.environment === "string" ? body.environment.trim() : null;
    const release = typeof body.release === "string" ? body.release.trim() : null;
    const commitShaRaw = typeof body.commitSha === "string" ? body.commitSha.trim() : null;
    const commitSha = commitShaRaw || null;
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
      commitSha,
      framesCount: frames.length,
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
    const fingerprint = computeFingerprint({ exceptionType, stackTrace, clientFingerprint, frames });
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
    // Status on repeat occurrences:
    //   RESOLVED → UNRESOLVED: a new occurrence is a regression and reopens the issue.
    //   IGNORED  → IGNORED:    a deliberately dismissed issue stays dismissed on new events.
    //   UNRESOLVED → UNRESOLVED: already open, no change needed.
    const now = new Date();
    const existingIssue = await db.errorIssue.findUnique({
      where: {
        workspaceId_repoKey_fingerprint: { workspaceId: workspace.id, repoKey, fingerprint },
      },
      select: { id: true, status: true },
    });

    const isNew = !existingIssue;

    // Regression reopen: a new occurrence on a RESOLVED issue reopens it to UNRESOLVED.
    // IGNORED issues are a deliberate no-reopen dismissal — they stay IGNORED.
    // UNRESOLVED issues are already open — no status change needed.
    const isRegression = existingIssue?.status === "RESOLVED";
    if (isRegression) {
      console.info("[error-ingest] regression reopen", {
        fingerprint,
        repoKey,
        workspaceId: workspace.id,
        issueId: existingIssue.id,
        previousStatus: "RESOLVED",
        newStatus: "UNRESOLVED",
      });
    }

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
            // Reopen RESOLVED issues on new occurrence (regression).
            // IGNORED remains dismissed; UNRESOLVED stays open.
            ...(isRegression ? { status: "UNRESOLVED" } : {}),
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
        commitSha: commitSha ?? undefined,
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

    // ── Best-effort KG projection ─────────────────────────────────────────────
    // Mirrors the pattern used by /api/webhook/agent-logs: graph writes happen
    // after DB/Pusher work completes and are isolated in their own try/catch so
    // any graph failure NEVER fails the ingest response.
    // Only the grouped ErrorIssue is projected — individual ErrorEvent rows are
    // deliberately excluded from the graph.
    try {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspace.id);
      if (!jarvisConfig) {
        console.info("[error-ingest] KG projection skipped: no swarm config", { workspaceId: workspace.id });
      } else {
        // (1) Upsert ErrorIssue node — reprocess:true so repeat occurrences
        //     update the existing node in place instead of being rejected.
        const issueNodeResult = await addNode(
          jarvisConfig,
          {
            node_type: "ErrorIssue",
            node_data: {
              fingerprint,
              exceptionType,
              title: issue.title,
              status: issue.status,
              occurrenceCount: issue.occurrenceCount,
              workspace_id: workspace.id,
              repository_id: issue.repositoryId ?? null,
              repo_key: issue.repoKey,
              first_seen_at: issue.firstSeenAt.toISOString(),
              last_seen_at: issue.lastSeenAt.toISOString(),
            },
          },
          { reprocess: true },
        );

        console.info("[error-ingest] ErrorIssue KG node upsert", {
          success: issueNodeResult.success,
          ref_id: issueNodeResult.ref_id,
          isNew,
        });

        // (2) Persist the returned ref_id onto the ErrorIssue row so it is
        //     stable across repeat occurrences.
        if (issueNodeResult.ref_id) {
          await db.errorIssue.update({
            where: { id: issue.id },
            data: { kgRefId: issueNodeResult.ref_id },
          });
        }

        // (3) Skip file/function edge resolution when the repo could not be
        //     resolved — there is no reliable scope to search within.
        if (!issue.repositoryId) {
          console.info("[error-ingest] KG file/function edges skipped: unresolved repositoryId", {
            issueId: issue.id,
            repoKey: issue.repoKey,
          });
        } else if (issueNodeResult.ref_id && stackTrace) {
          // (4) Parse file paths and function names from the top stack frames.
          const stackFrames = parseStackFrames(stackTrace);

          if (stackFrames.length > 0) {
            // Fetch File and Function nodes scoped to this repo via the graph
            // search endpoint.  We request a generous limit per type — workspace
            // graph sets are typically small, but we want to avoid missing a
            // frame because of a tight cap.
            const searchResult = await searchLatestByTypes(
              jarvisConfig,
              { File: 1000, Function: 1000 },
              { withProperties: true },
            );

            if (!searchResult.ok) {
              console.warn("[error-ingest] KG code-node search failed (skipping edges)", {
                error: searchResult.error,
              });
            } else {
              // Filter nodes to only those belonging to this issue's own repo
              // by matching the repository_id property on the node.  Never draw
              // edges to nodes from a different repo in the same workspace.
              const repoNodes = searchResult.nodes.filter((n) => {
                const props = n.properties ?? {};
                return (
                  props.repository_id === issue.repositoryId ||
                  props.repo_id === issue.repositoryId
                );
              });

              let edgesDrawn = 0;
              for (const frame of stackFrames) {
                // Try to match a File node by path/name, then a Function node
                // by function name within the same file.
                const fileNode = repoNodes.find(
                  (n) =>
                    n.node_type === "File" &&
                    matchesFilePath(n.properties?.file_path as string | undefined, frame.filePath),
                );
                const funcNode =
                  frame.functionName
                    ? repoNodes.find(
                        (n) =>
                          n.node_type === "Function" &&
                          (n.properties?.name as string | undefined) === frame.functionName &&
                          (!frame.filePath ||
                            matchesFilePath(
                              n.properties?.file_path as string | undefined,
                              frame.filePath,
                            )),
                      )
                    : undefined;

                for (const targetNode of [fileNode, funcNode]) {
                  if (!targetNode?.ref_id) continue;
                  const edgeResult = await addEdge(jarvisConfig, {
                    edge: { edge_type: "REFERENCES" },
                    source: { ref_id: issueNodeResult.ref_id },
                    target: { ref_id: targetNode.ref_id },
                  });
                  if (edgeResult.success) {
                    edgesDrawn++;
                  } else {
                    console.warn("[error-ingest] REFERENCES edge failed (skipped)", {
                      targetRefId: targetNode.ref_id,
                      nodeType: targetNode.node_type,
                      error: edgeResult.error,
                    });
                  }
                }
              }

              console.info("[error-ingest] KG edges drawn", {
                issueId: issue.id,
                framesScanned: stackFrames.length,
                edgesDrawn,
                repoNodesAvailable: repoNodes.length,
              });
            }
          }
        }

        // ── Opportunistic impact scoring ──────────────────────────────────
        // After edges are drawn, immediately compute the impact score for
        // brand-new issues (or re-score on regression reopen). Best-effort:
        // any failure here is logged and silently swallowed.
        if (issueNodeResult.ref_id) {
          try {
            const centralityResult = await getReferencedNodeCentrality(
              jarvisConfig,
              issueNodeResult.ref_id,
            );
            if (centralityResult.ok) {
              const scored = computeImpactScore(centralityResult.nodes);
              await db.errorIssue.update({
                where: { id: issue.id },
                data: {
                  impactScore: scored?.score ?? null,
                  impactScoredAt: new Date(),
                  impactMeta: scored?.meta
                    ? (scored.meta as unknown as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                },
              });
              console.info("[error-impact] opportunistic score persisted", {
                issueId: issue.id,
                score: scored?.score ?? null,
                nodeCount: scored?.meta.nodeCount ?? 0,
              });
            } else {
              console.warn("[error-impact] centrality read failed (non-fatal)", {
                issueId: issue.id,
                error: centralityResult.error,
              });
            }
          } catch (impactErr) {
            console.warn("[error-impact] opportunistic scoring failed (non-fatal)", impactErr);
          }
        }
      }
    } catch (err) {
      console.error("[error-ingest] KG projection failed (non-fatal)", err);
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

// ── Stack-frame parsing helpers ───────────────────────────────────────────────

interface StackFrame {
  filePath: string | null;
  functionName: string | null;
}

const TOP_FRAME_COUNT = 5;

/**
 * Extract the top N file paths and function names from a raw stack trace.
 * Handles the common V8/Node format: "  at FnName (path/to/file.ts:10:5)"
 * and the Firefox/Safari format:  "FnName@path/to/file.ts:10:5"
 */
function parseStackFrames(stackTrace: string): StackFrame[] {
  const lines = stackTrace
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TOP_FRAME_COUNT);

  return lines
    .map((line): StackFrame => {
      // V8: "at FunctionName (file.ts:10:5)" or "at file.ts:10:5"
      const v8Match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::\d+:\d+)?\)?\s*$/);
      if (v8Match) {
        const rawFn = v8Match[1] ?? null;
        const rawPath = v8Match[2] ?? null;
        return {
          filePath: rawPath ? extractFileName(rawPath) : null,
          functionName: rawFn && rawFn !== "<anonymous>" ? cleanFunctionName(rawFn) : null,
        };
      }

      // Firefox/Safari: "FnName@http://...file.js:10:5" or "FnName@file.js:10:5"
      const ffMatch = line.match(/^(.+?)@(.+?)(?::\d+:\d+)?$/);
      if (ffMatch) {
        return {
          filePath: extractFileName(ffMatch[2]),
          functionName: ffMatch[1] && ffMatch[1] !== "<anonymous>" ? ffMatch[1] : null,
        };
      }

      return { filePath: null, functionName: null };
    })
    .filter((f) => f.filePath !== null || f.functionName !== null);
}

/** Keep only the basename to match graph node file_path properties. */
function extractFileName(raw: string): string | null {
  if (!raw) return null;
  // Strip line:col if present
  const stripped = raw.replace(/:\d+:\d+$/, "").replace(/\)$/, "");
  // Return the last path segment
  const parts = stripped.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || null;
}

/** Trim common wrapper noise from function names (e.g. "Object.<anonymous>"). */
function cleanFunctionName(raw: string): string {
  return raw.replace(/^Object\.<anonymous>$/, "<anonymous>").trim();
}

/**
 * Return true when the node's file_path ends with or equals `framePath`.
 * This lets a graph node whose path is "src/foo/bar.ts" match a frame that
 * recorded only "bar.ts".
 */
function matchesFilePath(nodePath: string | undefined, framePath: string | null): boolean {
  if (!nodePath || !framePath) return false;
  const norm = nodePath.replace(/\\/g, "/");
  const frame = framePath.replace(/\\/g, "/");
  return norm === frame || norm.endsWith("/" + frame) || norm.endsWith(frame);
}

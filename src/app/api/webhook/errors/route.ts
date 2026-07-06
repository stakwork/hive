import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-keys";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { resolveRepoKey, computeFingerprint } from "@/lib/utils/error-fingerprint";
import { sanitizeFrames } from "@/lib/utils/error-frames";
import { selectFrameCandidates, matchFileNode, matchesFilePath } from "@/lib/utils/error-stack-frames";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addNode, addEdge, searchNodesByAttributes, getReferencedNodeCentrality } from "@/services/swarm/api/nodes";
import { detectOnset } from "@/services/error-issues/spike-detection";
import { correlateErrorIssue } from "@/services/error-issues/correlate";
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
        } else if (issueNodeResult.ref_id) {
          // (4) Resolve frame candidates from structured frames (primary) or
          //     raw stackTrace (fallback for older JS clients).
          const { candidates, source: candidateSource } = selectFrameCandidates(frames, stackTrace);

          console.info("[error-ingest] KG debug", {
            issueId: issue.id,
            framesLength: frames.length,
            stackTracePresent: !!stackTrace,
            candidatesCount: candidates.length,
            source: candidateSource,
            firstCandidate: candidates[0] ?? null,
          });

          if (candidates.length > 0) {
            console.info("[error-ingest] KG debug", { issueId: issue.id, aboutToSearch: true, repoKey: issue.repoKey });

            // Guard: skip the search if repoKey is missing or malformed.
            const ownerRepo = issue.repoKey ?? "";
            if (!ownerRepo || ownerRepo.length < 3 || !ownerRepo.includes("/")) {
              console.warn("[error-ingest] KG edges: invalid repoKey, skipping search", { repoKey: ownerRepo });
            } else {
              // Build the set of unique full file paths to query.
              // Each path is: `${repoKey}/${normalizedFramePath}` where the
              // frame path has any leading `/`, `./`, or absolute-prefix stripped.
              //
              // NOTE (known limitation): frames resolved via the stackTrace
              // fallback path in selectFrameCandidates reduce to a bare basename
              // and will not exact-match a repo-qualified `owner/repo/path` node.
              // This is accepted — jarvis hard-rejects `contains` (the only
              // alternative), and structured in-app frames carry full repo-relative
              // paths and will match correctly.
              const PER_FILE_TIMEOUT_MS = 8_000;
              const uniqueFilePaths = new Set<string>();
              for (const frame of candidates) {
                if (!frame.filePath) continue;
                // Normalize: strip leading `/`, `./`, or absolute-path prefix
                const normPath = frame.filePath.replace(/^(?:\.\/|\/+|(?:[A-Za-z]:)?[/\\]+)/, "");
                if (!normPath) continue;
                uniqueFilePaths.add(`${ownerRepo}/${normPath}`);
              }

              console.info("[error-ingest] KG debug", {
                issueId: issue.id,
                uniqueFilePaths: Array.from(uniqueFilePaths),
                candidatesCount: candidates.length,
              });

              // Run one exact-match attributes search per unique file path in
              // parallel. `=` comparator is exempt from jarvis's searchable-
              // attribute allowlist (unlike `contains`/`~=`), so these never
              // get rejected with HTTP 400.
              const fileQueryResults = await Promise.allSettled(
                Array.from(uniqueFilePaths).map((fullPath) =>
                  searchNodesByAttributes(jarvisConfig, {
                    nodeTypes: ["File", "Function"],
                    filters: [{ attribute: "file", value: fullPath, comparator: "=" }],
                    includeProperties: true,
                    limit: 100,
                    timeoutMs: PER_FILE_TIMEOUT_MS,
                  }).then((result) => ({ fullPath, result })),
                ),
              );

              // Pool all successful per-file results; log + skip failures.
              const pooledNodes: Array<{ ref_id?: string; node_type: string; properties?: Record<string, unknown> }> = [];
              let totalNodesFetched = 0;

              for (const settled of fileQueryResults) {
                if (settled.status === "rejected") {
                  // We can't get fullPath from a rejection at this level —
                  // the per-file promise wraps the result so rejections carry
                  // the error. Log what we can.
                  console.warn("[error-ingest] KG code-node search failed (skipping edges)", {
                    error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
                  });
                  continue;
                }
                const { fullPath, result } = settled.value;
                if (!result.ok) {
                  console.warn("[error-ingest] KG code-node search failed (skipping edges)", {
                    error: result.error,
                    filePath: fullPath,
                  });
                  continue;
                }
                totalNodesFetched += result.nodes.length;
                for (const node of result.nodes) {
                  pooledNodes.push(node);
                }
              }

              console.info("[error-ingest] KG debug", {
                issueId: issue.id,
                ownerRepo,
                totalNodesFetched,
                pooledNodesCount: pooledNodes.length,
                sampleNodeFiles: pooledNodes.slice(0, 5).map((n) => n.properties?.file ?? n.properties?.file_path ?? null),
              });

              let edgesDrawn = 0;
              const seenRefIds = new Set<string>();
              let frameIndex = 0;

              for (const frame of candidates) {
                // Try to match a File node by path, then a Function node by
                // name AND same-file path (same-file guard prevents shared
                // method names like `perform` from linking the wrong worker).
                const fileNode = frame.filePath
                  ? matchFileNode(pooledNodes, frame.filePath)
                  : undefined;

                // Debug: ambiguous file node case — matchFileNode returns
                // undefined when >1 exact File match exists for this path.
                if (frame.filePath && !fileNode) {
                  const exactMatches = pooledNodes.filter(
                    (n) => n.node_type === "File" &&
                      ((n.properties?.file ?? n.properties?.file_path) as string | undefined)?.endsWith(frame.filePath!),
                  );
                  if (exactMatches.length > 1) {
                    console.info("[error-ingest] KG debug ambiguous file node", {
                      issueId: issue.id,
                      framePath: frame.filePath,
                      matchCount: exactMatches.length,
                    });
                  }
                }

                const funcNode =
                  frame.functionName && frame.filePath
                    ? pooledNodes.find(
                        (n) =>
                          n.node_type === "Function" &&
                          (n.properties?.name as string | undefined) === frame.functionName &&
                          matchesFilePath(
                            (n.properties?.file ?? n.properties?.file_path) as string | undefined,
                            frame.filePath,
                          ),
                      )
                    : undefined;

                if (frameIndex < 5) {
                  console.info("[error-ingest] KG debug", {
                    issueId: issue.id,
                    framePath: frame.filePath,
                    frameFunc: frame.functionName,
                    matchedFile: fileNode?.ref_id ?? null,
                    matchedFunc: funcNode?.ref_id ?? null,
                  });
                }
                frameIndex++;

                for (const targetNode of [fileNode, funcNode]) {
                  if (!targetNode?.ref_id) continue;
                  if (seenRefIds.has(targetNode.ref_id)) continue;
                  seenRefIds.add(targetNode.ref_id);

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
                source: candidateSource,
                candidatesScanned: candidates.length,
                edgesDrawn,
                repoKey: ownerRepo,
                repoNodesAvailable: pooledNodes.length,
              });
            } // end ownerRepo guard
          }
        }

        // ── Opportunistic impact scoring ────────────────────────────────────
        // Best-effort: compute and persist impactScore right after edges are
        // drawn so brand-new issues get a score immediately without waiting for
        // the hourly cron. Logged under [error-impact] prefix, never throws.
        if (issueNodeResult.ref_id) {
          try {
            const centralityResult = await getReferencedNodeCentrality(
              jarvisConfig,
              issueNodeResult.ref_id,
              { timeoutMs: 5_000 },
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
                    : Prisma.JsonNull,
                },
              });
              console.info("[error-impact] opportunistic score persisted", {
                issueId: issue.id,
                score: scored?.score ?? null,
                nodeCount: centralityResult.nodes.length,
              });
            } else {
              console.warn("[error-impact] centrality fetch failed (non-fatal)", {
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

    // ── Best-effort regression correlation ────────────────────────────────────
    // Runs AFTER the KG projection block (which may have updated kgRefId on the
    // issue row). Wrapped in its own try/catch — must NEVER fail or delay the
    // ingest response. Mirrors the non-blocking pattern used for KG projection.
    try {
      const onsetResult = await detectOnset(issue.id, isNew, isRegression);
      if (onsetResult.isOnset) {
        console.info("[error-correlate] onset detected via ingest, queuing correlation", {
          issueId: issue.id,
          reason: onsetResult.reason,
        });

        // Re-fetch the issue to pick up kgRefId set by the KG projection above
        const freshIssue = await db.errorIssue.findUnique({
          where: { id: issue.id },
          select: { kgRefId: true, firstSeenAt: true },
        });

        const jarvisConfig = await getJarvisConfigForWorkspace(workspace.id);
        if (jarvisConfig && freshIssue?.kgRefId) {
          // Fire-and-forget — do not await; correlation must never delay the response
          correlateErrorIssue(
            issue.id,
            freshIssue.kgRefId,
            freshIssue.firstSeenAt,
            commitSha,
            jarvisConfig,
            onsetResult.reason ?? "unknown",
          ).catch((err) => {
            console.error("[error-correlate] fire-and-forget failed (non-fatal)", err);
          });
        } else {
          console.info("[error-correlate] skipped: no jarvis config or kgRefId", {
            issueId: issue.id,
            hasJarvis: !!jarvisConfig,
            kgRefId: freshIssue?.kgRefId ?? null,
          });
        }
      }
    } catch (err) {
      console.error("[error-correlate] onset detection failed (non-fatal)", err);
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


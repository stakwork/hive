import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { resolveOpenHealthStrut, fetchOwnedRun, OPENHEALTH_WORKFLOWS } from "@/lib/openhealth-benchmarks/strut-client";
import { stageFromPath } from "@/lib/openhealth-benchmarks/run-summary";
import { strutFetch } from "@/lib/strut/fetch";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";
export const maxDuration = 800;

const LOG_TAG = "openhealth-benchmarks";
const KEEPALIVE_INTERVAL_MS = 15_000;

type RouteParams = { params: Promise<{ slug: string; runId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TERMINAL_STATUSES = new Set(["success", "error", "cancelled"]);

/**
 * Parse one upstream SSE frame block (`event: ...\ndata: ...`) into
 * `{ path, status }` — best-effort; a frame this route cannot parse is
 * simply skipped rather than forwarded, since only a narrow projected shape
 * is ever allowed out.
 */
function parseUpstreamFrame(block: string): { path?: string; status?: string } | null {
  const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return null;
  try {
    const parsed = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
    return {
      path: typeof parsed.path === "string" ? parsed.path : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]/stream
 *
 * Server-side SSE transformer over the strut run's own event stream.
 * `fetchOwnedRun` first — an unknown/foreign run is a 404, never an
 * indefinite tail. Emits ONLY `{ runId, stage, status }` frames (the
 * terminal frame carries `{ status }`); the client refetches the run
 * summary on that event rather than trusting anything richer sent here.
 *
 * Deliberately NOT modeled on `swarm/stakgraph/agent-stream`: that route
 * synthesizes its own events and sets a wildcard CORS header — neither is
 * appropriate for a same-origin authenticated proxy of a real upstream
 * stream.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug, runId } = await params;
  const resolved = await resolveOpenHealthStrut(request, slug, { write: false });
  if (!resolved.ok) return resolved.response;
  const { target, userId } = resolved;

  const owned = await fetchOwnedRun(target, runId);
  if (!owned.ok) return owned.response;

  const workflow = OPENHEALTH_WORKFLOWS.run;

  let upstream: Response;
  try {
    upstream = await strutFetch(
      target,
      `/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/stream`,
      { method: "GET", timeoutMs: null, signal: request.signal },
    );
  } catch {
    return NextResponse.json({ error: "Strut unavailable" }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Strut unavailable" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close();
        }
      }, KEEPALIVE_INTERVAL_MS);

      const send = (data: { runId: string; stage?: string; status?: string }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const frame = parseUpstreamFrame(block);
            if (!frame) continue;
            const stage = frame.path ? stageFromPath(frame.path) : null;
            if (frame.status && TERMINAL_STATUSES.has(frame.status)) {
              send({ runId, status: frame.status });
              close();
              return;
            }
            if (stage) {
              send({ runId, stage });
            }
          }
        }
      } catch (err) {
        logger.warn("[openhealth/benchmarks/runs/stream] upstream read failed", LOG_TAG, {
          userId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        close();
      }
    },
    cancel() {
      try {
        upstream.body?.cancel();
      } catch {
        // best-effort
      }
    },
  });

  // Headers built fresh — never copy anything from `upstream`. No CORS
  // header: this is a same-origin authenticated route, not a public proxy.
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Referenced so `isRecord` import stays meaningful if future frames need it.
void isRecord;

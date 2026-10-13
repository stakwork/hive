import { NextRequest, NextResponse } from "next/server";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { db } from "@/lib/db";
import { loadAllStoredEnvValues } from "@/lib/pods/env-values";
import { staklinkFetch } from "@/lib/pods/staklink";

export const runtime = "nodejs";

const PROCESS_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DEFAULT_LINES = 200;
const MAX_LINES = 1000;
const MAX_BYTES = 200 * 1024;
const MIN_REDACT_LENGTH = 6;
const REDACTED = "[redacted]";

function redact(text: string, secrets: string[]): string {
  // Longest first so a secret containing another is fully masked
  const sorted = Array.from(new Set(secrets))
    .filter((s) => s.length >= MIN_REDACT_LENGTH)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of sorted) out = out.split(secret).join(REDACTED);
  return out;
}

/** Last `maxBytes` bytes of `text` (UTF-8 safe). */
function tailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, truncated: false };
  // toString replaces a split leading multibyte char with U+FFFD; drop it
  return { text: buf.subarray(buf.length - maxBytes).toString("utf8").replace(/^\uFFFD+/, ""), truncated: true };
}

/** Read-only: pod logs from staklink, with the pod password and stored env values redacted. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; podId: string }> },
) {
  try {
    const { slug, podId } = await params;
    if (!slug || !podId) {
      return NextResponse.json({ error: "Workspace slug and podId are required" }, { status: 400 });
    }

    const caller = await resolvePodCaller(request, { slug });
    if (caller instanceof NextResponse) {
      return caller.status === 403
        ? NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 })
        : caller;
    }

    const search = request.nextUrl.searchParams;
    const processParam = search.get("process");
    if (processParam !== null && !PROCESS_NAME_RE.test(processParam)) {
      return NextResponse.json({ error: "Invalid process name" }, { status: 400 });
    }
    const rawLines = parseInt(search.get("lines") ?? "", 10);
    const lines = Number.isNaN(rawLines) ? DEFAULT_LINES : Math.min(MAX_LINES, Math.max(1, rawLines));

    const pod = await db.pod.findFirst({
      where: { podId, deletedAt: null, swarm: { workspaceId: caller.workspaceId } },
      select: { podId: true, password: true, status: true, swarm: { select: { id: true, environmentVariables: true } } },
    });
    if (!pod) {
      return NextResponse.json({ error: "Pod not found in this workspace" }, { status: 404 });
    }
    if (pod.status !== "RUNNING") {
      return NextResponse.json({ error: "pod_not_running", status: pod.status }, { status: 409 });
    }

    const path = processParam
      ? `/logs/${encodeURIComponent(processParam)}?lines=${lines}`
      : `/logs?lines=${lines}`;

    let raw: string;
    try {
      const response = await staklinkFetch(pod, path, { timeoutMs: 10000 });
      if (!response.ok) {
        return NextResponse.json({ error: "pod_unreachable", status: response.status }, { status: 502 });
      }
      raw = await response.text();
    } catch {
      return NextResponse.json({ error: "pod_unreachable" }, { status: 502 });
    }

    const secrets = [
      ...(pod.password ? [pod.password] : []),
      ...(await loadAllStoredEnvValues(pod.swarm.id, pod.swarm.environmentVariables)),
    ];
    // Redact before truncating so a secret cut by the boundary can't leak partially
    const { text, truncated } = tailBytes(redact(raw, secrets), MAX_BYTES);

    return NextResponse.json({
      success: true,
      data: { podId: pod.podId, process: processParam, lines, logs: text, truncated },
    });
  } catch (error) {
    console.error("[pool/logs] unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

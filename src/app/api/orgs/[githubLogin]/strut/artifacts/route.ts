/**
 * GET /api/orgs/[githubLogin]/strut/artifacts?swarmId=<Swarm.id>&key=<strut link>
 *
 * The reader for a `graph` artifact ref on a Jamie-chat message
 * (`_state/canvasChatArtifacts.ts`; written by `services/strut-runs/job-turn.ts`):
 * the bytes a strut job turn produced — `plan.md` in the job's directory, a
 * screenshot in a run's artifacts — served from the swarm to the browser
 * through Hive's own origin, behind Hive's session. The one route tom's
 * artifact PR left open (CANVAS_CHAT.md, "a writer and a reader").
 *
 *  1. Session auth (protected middleware default), then the org: the
 *     caller must belong to `githubLogin` (`resolveAuthorizedOrgId`) —
 *     404 otherwise, so org existence is not leaked.
 *  2. `key` must be one of strut's two link shapes — `/jobs/<job>/files/…`
 *     or `/artifacts/<runId>/…` — with no `..` (`parseStrutArtifactKey`);
 *     400 otherwise. Nothing else on the swarm is reachable through here.
 *  3. The swarm must belong to a workspace in THAT org the caller can
 *     read (`validateWorkspaceAccess`), and the key must name something
 *     Hive launched there — a `StrutRun` row of this swarm with that
 *     `jobId`, or that `strutRunId` — before the swarm key is decrypted.
 *     403 / 404 otherwise.
 *  4. `GET {lab}<key>` with the swarm's `x-api-token` (decrypted here,
 *     never sent to the browser), streamed back with strut's
 *     `content-type`, `content-security-policy` (`sandbox`: a page an
 *     agent wrote is a static page here too) and `x-content-type-options`
 *     kept, and `cache-control: private, no-store`.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { parseStrutArtifactKey } from "@/lib/strut-jobs";
import { strutLabBaseUrl } from "@/services/bifrost/strut-delegation";
import { validateWorkspaceAccess } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_TIMEOUT_MS = 30_000;
/** The headers strut sets that the browser must see as strut set them. */
const KEPT_HEADERS = ["content-type", "content-security-policy", "x-content-type-options", "content-length"] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const userId = userOrResponse.id;
  const { githubLogin } = await params;

  const swarmId = request.nextUrl.searchParams.get("swarmId") ?? "";
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const parsed = parseStrutArtifactKey(key);
  if (!swarmId || swarmId.length > 200 || !parsed) {
    return NextResponse.json({ error: "swarmId and a strut artifact key are required" }, { status: 400 });
  }

  const orgId = await resolveAuthorizedOrgId(githubLogin, userId, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const swarm = await db.swarm.findUnique({
    where: { id: swarmId },
    select: {
      swarmUrl: true,
      swarmApiKey: true,
      workspace: { select: { id: true, slug: true, sourceControlOrgId: true, deleted: true } },
    },
  });
  if (!swarm || swarm.workspace.deleted || swarm.workspace.sourceControlOrgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const access = await validateWorkspaceAccess(swarm.workspace.slug, userId);
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Only what Hive launched on that swarm: the job, or the run, is one of ours.
  const launched = await db.strutRun.findFirst({
    where: { swarmId, ...("job" in parsed ? { jobId: parsed.job } : { strutRunId: parsed.runId }) },
    select: { id: true },
  });
  if (!launched) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    return NextResponse.json({ error: "The swarm has no strut" }, { status: 404 });
  }
  let apiKey: string;
  try {
    apiKey = EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey);
  } catch {
    return NextResponse.json({ error: "Swarm credentials unavailable" }, { status: 502 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${strutLabBaseUrl(swarm.swarmUrl)}${key}`, {
      headers: { "x-api-token": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("[strut-artifacts] swarm unreachable", { swarmId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Could not reach the swarm" }, { status: 502 });
  }
  if (upstream.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!upstream.ok) {
    console.warn("[strut-artifacts] swarm refused", { swarmId, status: upstream.status });
    return NextResponse.json({ error: `The swarm answered ${upstream.status}` }, { status: 502 });
  }

  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  for (const name of KEPT_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: 200, headers });
}

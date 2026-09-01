import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { readHostStorage, type HostStorageReadResult } from "@/services/swarm/host-storage-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/swarms/[instanceId]/storage — live host storage read.
 *
 * Super-admin gated BEFORE any database read, credential decryption, or
 * outbound swarm call: the service layer performs credential decryption and a
 * third-party login, so it must never be reachable by an unauthorized caller.
 *
 * The route owns no swarm resolution, credential handling, or parsing —
 * everything is delegated to `readHostStorage(instanceId)`, which resolves the
 * swarm server-side from the DB. No connection parameter (swarmUrl or
 * otherwise) is ever accepted from the request body or query string; the
 * sibling `/cmd` route's caller-supplied-swarmUrl shape is an SSRF /
 * credential-exfiltration risk this route must not inherit.
 *
 * Outcome → HTTP mapping:
 * - fresh / cached               → 200 with the reading
 * - no_swarm_record              → 200 (a normal, renderable state — the
 *                                  admin swarms list is EC2-derived and
 *                                  tolerates unlinked instances)
 * - unreachable / failed         → 200 with the outcome + reason code, so the
 *                                  card can render "unreachable now" or an
 *                                  explanation instead of a blank error
 * - ambiguous                    → 409 (never return an arbitrary row)
 * - malformed instanceId         → 400 (service classifies
 *                                  INVALID_INSTANCE_ID before any DB query)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  // Auth gate FIRST — before touching params, DB, cache or swarm.
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { instanceId } = await params;

  // Body/query are deliberately never read: there is no caller-supplied input
  // on this route at all. (A GET with a JSON body is ignored by design.)

  let result: HostStorageReadResult;
  try {
    result = await readHostStorage(instanceId);
  } catch {
    // readHostStorage never throws by contract; this guards against
    // infrastructure faults (e.g. DB outage). No internals are echoed back.
    return NextResponse.json(
      { outcome: "failed", reasonCode: "UNREACHABLE", cached: false },
      { status: 500 },
    );
  }

  // BigInt safety at the edge: v1 readings contain only JSON-native values
  // (the parser's Zod schema produces `number`s), so NextResponse.json cannot
  // hit its BigInt serialization failure. If a BigInt ever crosses this
  // boundary it must be converted to `number | null` here first (see the
  // Screenshot.timestamp precedent in src/app/api/screenshots/route.ts).

  if (result.outcome === "failed" && result.reasonCode === "INVALID_INSTANCE_ID") {
    return NextResponse.json(result, { status: 400 });
  }
  if (result.outcome === "ambiguous") {
    return NextResponse.json(result, { status: 409 });
  }

  // fresh | cached | no_swarm_record | unreachable | failed → 200 with the
  // outcome discriminator so the card can render each state explicitly.
  return NextResponse.json(result);
}

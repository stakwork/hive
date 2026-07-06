/**
 * Auth + swarm resolution helpers for /api/gateway/evals/** routes.
 *
 * The API key is the ONLY scope. Workspace id is NEVER read from the
 * request path or body — it comes exclusively from the validated key.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getJarvisUrl } from "@/lib/utils/swarm";

export interface GatewayEvalConfig {
  workspaceId: string;
  workspaceSlug: string;
  /** User id of the key creator — used as Bifrost member identity */
  userId: string;
  keyId: string;
  jarvisUrl: string;
  swarmApiKey: string;
  swarmUrl: string;
  swarmSecretAlias: string | null;
  swarmName: string;
}

/**
 * Authenticate the request via `Authorization: Bearer <key>` (fallback `x-api-key`),
 * resolve the workspace from the key, and resolve the workspace's swarm config.
 *
 * Returns either a `GatewayEvalConfig` or a `NextResponse` with the appropriate
 * error status (401 / 400 / 502).
 */
export async function resolveGatewayAuth(
  request: NextRequest,
): Promise<GatewayEvalConfig | NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const apiKeyHeader = request.headers.get("x-api-key");
  const rawKey = bearerKey ?? apiKeyHeader;

  if (!rawKey) {
    console.warn("[Gateway Evals] auth failed: no key provided");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authResult = await validateApiKey(rawKey);
  if (!authResult) {
    console.warn("[Gateway Evals] auth failed: invalid/revoked/expired key");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspace, apiKey } = authResult;
  console.info("[Gateway Evals] auth ok", { workspaceId: workspace.id, keyId: apiKey.id });

  // ── Swarm resolution (key-driven, no user-access gate) ───────────────────
  const swarm = await db.swarm.findUnique({
    where: { workspaceId: workspace.id },
    select: {
      name: true,
      status: true,
      swarmUrl: true,
      swarmApiKey: true,
      swarmSecretAlias: true,
    },
  });

  if (!swarm) {
    console.warn("[Gateway Evals] swarm not configured", { workspaceId: workspace.id });
    return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
  }

  if (swarm.status !== "ACTIVE") {
    console.warn("[Gateway Evals] swarm not active", { workspaceId: workspace.id, status: swarm.status });
    return NextResponse.json({ error: "Swarm not active" }, { status: 400 });
  }

  if (!swarm.name || swarm.name.trim() === "") {
    console.warn("[Gateway Evals] swarm name missing", { workspaceId: workspace.id });
    return NextResponse.json({ error: "Swarm name not found" }, { status: 400 });
  }

  if (!swarm.swarmApiKey) {
    console.warn("[Gateway Evals] swarm API key missing", { workspaceId: workspace.id });
    return NextResponse.json({ error: "Swarm API key not configured" }, { status: 400 });
  }

  if (!swarm.swarmUrl) {
    console.warn("[Gateway Evals] swarm URL missing", { workspaceId: workspace.id });
    return NextResponse.json({ error: "Swarm not configured" }, { status: 400 });
  }

  const encryptionService = EncryptionService.getInstance();
  const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
  const jarvisUrl = getJarvisUrl(swarm.name);

  console.info("[Gateway Evals] swarm resolved", {
    workspaceId: workspace.id,
    swarmName: swarm.name,
    jarvisUrl,
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    userId: apiKey.createdById,
    keyId: apiKey.id,
    jarvisUrl,
    swarmApiKey: decryptedApiKey,
    swarmUrl: swarm.swarmUrl,
    swarmSecretAlias: swarm.swarmSecretAlias ?? null,
    swarmName: swarm.name,
  };
}

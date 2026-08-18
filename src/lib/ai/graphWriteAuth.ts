import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { RoleHierarchy } from "@/lib/auth/roles";
import { WorkspaceRole } from "@prisma/client";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { config } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * The resolved credentials and identifiers needed to perform Jarvis v2 writes
 * on behalf of a verified workspace member.
 */
export interface GraphJarvisAccess {
  workspaceId: string;
  workspaceSlug: string;
  config: {
    /** Jarvis base URL — the `:8444` host, not the stored `/api` URL or `:3355`. */
    jarvisUrl: string;
    apiKey: string;
  };
}

/**
 * Collapsed error string returned for every failure mode. All variants
 * map to this single value so callers cannot probe for workspace existence
 * or membership by distinguishing error messages.
 */
export const GRAPH_JARVIS_ACCESS_DENIED =
  "Workspace not found or access denied.";

type WorkspaceLocator = { slug: string } | { workspaceId: string };

/**
 * Single authorization + credential authority for all graph-write operations.
 *
 * Performs, in order:
 * 1. Workspace lookup scoped to `orgId` (prevents cross-org access).
 * 2. Membership check: owner OR active `workspaceMember` (`leftAt: null`).
 *    This is the IDOR-critical step and runs before any swarm/network call.
 * 3. Role gate: `RoleHierarchy[role] >= RoleHierarchy.DEVELOPER`.
 * 4. Swarm fetch + Jarvis URL derivation via `getJarvisUrl(swarm.name)`.
 * 5. API key decryption.
 *
 * Every failure mode returns the same generic error string to prevent
 * workspace-existence probing.
 *
 * In mock mode (`config.USE_MOCKS`), the jarvisUrl is overridden to
 * `${config.MOCK_BASE}/api/mock/jarvis` so approval handlers can reach
 * the local mock routes without network access.
 *
 * @returns `{ ok: true, access }` on success, `{ ok: false, error }` on any failure.
 */
export async function resolveGraphJarvis(
  orgId: string,
  userId: string,
  locator: WorkspaceLocator,
): Promise<
  | { ok: true; access: GraphJarvisAccess }
  | { ok: false; error: string }
> {
  try {
    // ── 1. Workspace lookup scoped to this org ────────────────────────────
    const whereClause =
      "slug" in locator
        ? { slug: locator.slug, sourceControlOrgId: orgId, deleted: false }
        : { id: locator.workspaceId, sourceControlOrgId: orgId, deleted: false };

    const workspace = await db.workspace.findFirst({
      where: whereClause,
      select: {
        id: true,
        slug: true,
        ownerId: true,
      },
    });

    if (!workspace) {
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    // ── 2. Membership check (IDOR-critical — before any network call) ─────
    const isOwner = workspace.ownerId === userId;
    let memberRole: WorkspaceRole | null = null;

    if (!isOwner) {
      const member = await db.workspaceMember.findFirst({
        where: {
          workspaceId: workspace.id,
          userId,
          leftAt: null,
        },
        select: { role: true },
      });

      if (!member) {
        return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
      }
      memberRole = member.role;
    }

    // ── 3. Role gate: DEVELOPER+ ──────────────────────────────────────────
    const effectiveRole = isOwner ? WorkspaceRole.OWNER : memberRole!;
    if (RoleHierarchy[effectiveRole] < RoleHierarchy[WorkspaceRole.DEVELOPER]) {
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    // ── 4. Swarm fetch ────────────────────────────────────────────────────
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        name: true,
        status: true,
        swarmApiKey: true,
      },
    });

    if (!swarm || swarm.status !== "ACTIVE") {
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    if (!swarm.name || swarm.name.trim() === "") {
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    if (!swarm.swarmApiKey) {
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    // ── 5. API key decryption ─────────────────────────────────────────────
    let apiKey: string;
    try {
      const encryptionService = EncryptionService.getInstance();
      apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    } catch (e) {
      logger.error(
        "[resolveGraphJarvis] Failed to decrypt swarmApiKey",
        "graphWriteAuth",
        { workspaceId: workspace.id, error: String(e) },
      );
      return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
    }

    // ── 6. Jarvis URL derivation ──────────────────────────────────────────
    // In mock mode, redirect to local mock routes instead of the real
    // `https://{name}.sphinx.chat:8444` endpoint (mirrors stakgraph-url.ts).
    const jarvisUrl = config.USE_MOCKS
      ? `${config.MOCK_BASE}/api/mock/jarvis`
      : getJarvisUrl(swarm.name);

    return {
      ok: true,
      access: {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        config: { jarvisUrl, apiKey },
      },
    };
  } catch (e) {
    logger.error(
      "[resolveGraphJarvis] Unexpected error",
      "graphWriteAuth",
      { orgId, userId, error: String(e) },
    );
    return { ok: false, error: GRAPH_JARVIS_ACCESS_DENIED };
  }
}

/**
 * Org-level access gates for canvas-agent capabilities.
 *
 * A capability's `orgGate` (see `CapabilityDefinition` in
 * `./capabilities.ts`) decides whether that capability is composed for the
 * acting source-control org. Gates live here — not in the capability
 * registry — so the registry stays a pure, I/O-free composition table while
 * the gates own the DB lookups + config they need.
 *
 * Today only `prompts` is gated. The shared prompt library is globally
 * scoped (the `Prompt` model has no org FK), so without this gate its
 * read/propose tools would be handed to every org's canvas agent. The gate
 * resolves the acting `SourceControlOrg`'s GitHub login and checks it
 * against the `PROMPTS_CAPABILITY_ORG_LOGINS` allow-list (default: the
 * Stakwork org only). When per-user agents/prompts land, relax the
 * allow-list (or add a per-user gate) here.
 */

import { db } from "@/lib/db";
import { isPromptsCapabilityEnabledForOrgLogin } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * Whether the `prompts` capability is available to the given source-control
 * org (the `orgId` threaded through `runCanvasAgent`, i.e. a
 * `SourceControlOrg.id`). Resolves the org's `githubLogin` and defers the
 * policy decision to `isPromptsCapabilityEnabledForOrgLogin`.
 *
 * Fails closed: a missing orgId, an unknown org, or a lookup error all
 * return `false`, so the capability is never composed outside the
 * allow-listed orgs.
 */
export async function isPromptsCapabilityEnabledForOrg(
  orgId: string | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    return isPromptsCapabilityEnabledForOrgLogin(org?.githubLogin);
  } catch (err) {
    logger.error(
      "[capabilityGates] prompts org gate lookup failed — denying",
      "capabilityGates",
      { orgId, error: err instanceof Error ? err.message : String(err) },
    );
    return false;
  }
}

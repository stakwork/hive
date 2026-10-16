import { resolveOrgDefaultSwarmWorkspace } from "@/lib/helpers/org-workspace";
import { transformSwarmUrlToAdvisor } from "@/lib/utils/swarm";
import { validateWorkspaceAccess } from "@/services/workspace";

export type ResolveAdvisorUrlResult =
  | { ok: true; url: string; workspaceSlug: string }
  | { ok: false; reason: "not_configured" | "no_access" };

/**
 * The org's Advisor URL, gated to Owners/Admins of the org's default
 * workspace (no fallback to other workspaces). A UX gate only — the advisor's
 * own API token is the real boundary.
 */
export async function resolveAdvisorUrl(
  githubLogin: string,
  userId: string,
): Promise<ResolveAdvisorUrlResult> {
  const workspace = await resolveOrgDefaultSwarmWorkspace(githubLogin);
  if (!workspace?.swarm) return { ok: false, reason: "not_configured" };

  const access = await validateWorkspaceAccess(workspace.slug, userId);
  if (!access.canAdmin) return { ok: false, reason: "no_access" };

  const url = transformSwarmUrlToAdvisor(workspace.swarm.swarmUrl);
  if (!url) return { ok: false, reason: "not_configured" };

  return { ok: true, url, workspaceSlug: workspace.slug };
}

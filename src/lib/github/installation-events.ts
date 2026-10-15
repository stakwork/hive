import { db } from "@/lib/db";
import { getWorkspaceChannelName, pusherServer, PUSHER_EVENTS } from "@/lib/pusher";

/** `installation` actions that change what the app can reach in a repo. */
const INSTALLATION_ACTIONS = new Set(["created", "deleted", "new_permissions_accepted", "suspend", "unsuspend"]);

interface InstallationEventPayload {
  action?: string;
  installation?: { id?: number };
  repositories_added?: Array<{ full_name?: string }>;
  repositories_removed?: Array<{ full_name?: string }>;
}

export interface GithubInstallationUpdate {
  event: string;
  action: string;
  repositoriesAdded: string[];
  repositoriesRemoved: string[];
}

export function isInstallationChange(event: string | null, payload: InstallationEventPayload): boolean {
  if (event === "installation_repositories") return true;
  return event === "installation" && INSTALLATION_ACTIONS.has(payload.action ?? "");
}

const names = (repos: InstallationEventPayload["repositories_added"]) =>
  (repos ?? []).map((r) => r.full_name).filter((n): n is string => !!n);

/**
 * Tell every workspace linked to the installation that it changed, so an
 * open setup screen re-runs its repository access check. Returns how many
 * workspaces were notified.
 */
export async function notifyInstallationChange(event: string, payload: InstallationEventPayload): Promise<number> {
  const installationId = payload.installation?.id;
  if (!installationId) return 0;

  const org = await db.sourceControlOrg.findUnique({
    where: { githubInstallationId: installationId },
    select: { githubLogin: true, workspaces: { where: { deleted: false }, select: { slug: true } } },
  });
  if (!org || org.workspaces.length === 0) {
    console.log("[GithubAppWebhook] No workspaces for installation", { installationId, event, action: payload.action });
    return 0;
  }

  const update: GithubInstallationUpdate = {
    event,
    action: payload.action ?? "",
    repositoriesAdded: names(payload.repositories_added),
    repositoriesRemoved: names(payload.repositories_removed),
  };
  console.log("[GithubAppWebhook] Installation changed", { org: org.githubLogin, installationId, ...update });

  const results = await Promise.allSettled(
    org.workspaces.map((w) =>
      pusherServer.trigger(getWorkspaceChannelName(w.slug), PUSHER_EVENTS.GITHUB_INSTALLATION_UPDATED, update),
    ),
  );
  for (const r of results) {
    if (r.status === "rejected") console.error("[GithubAppWebhook] Pusher trigger failed (non-fatal):", r.reason);
  }
  return org.workspaces.length;
}

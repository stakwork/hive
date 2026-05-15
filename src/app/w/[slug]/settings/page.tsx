import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/page-header";
import { isBifrostEnabledForWorkspace } from "@/config/env";
import { authOptions } from "@/lib/auth/nextauth";
import { resolveBifrost } from "@/services/bifrost";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { notFound } from "next/navigation";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  const { slug } = await params;

  if (!session?.user) {
    notFound();
  }

  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    notFound();
  }

  const workspace = await getWorkspaceBySlug(slug, userId);
  if (!workspace) {
    notFound();
  }

  if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
    notFound();
  }

  // DEV: dump Bifrost admin credentials to server console so developers
  // can log into the LLM dashboard while the proper UI is being built.
  // Gated behind the same workspace-scoped rollout flag the reconciler
  // uses (`isBifrostEnabledForWorkspace` — see `lib/ai/askTools.ts`)
  // AND behind workspace OWNER/ADMIN (the notFound() above), so the
  // log only fires in deployments that have opted in to Bifrost for
  // this workspace AND only for users entitled to see the password.
  //
  // Triggers the same lazy bootstrap path the future UI will use, so
  // visiting /w/<slug>/settings on a fresh swarm is enough to provision
  // and cache the admin password on the Swarm row.
  //
  // Remove once the dashboard card lands in SettingsTabs.
  if (isBifrostEnabledForWorkspace(workspace.slug)) {
    try {
      const creds = await resolveBifrost(workspace.id);
      console.log(
        `[bifrost-creds] workspace=${workspace.slug} ` +
          `dashboard=${creds.baseUrl} ` +
          `user=${creds.adminUser} ` +
          `password=${creds.adminPassword}`,
      );
    } catch (err) {
      console.warn(
        `[bifrost-creds] workspace=${workspace.slug} unavailable: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" />
      <SettingsTabs
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspaceSlug={workspace.slug}
        isOwner={workspace.userRole === "OWNER"}
        isPublicViewable={workspace.isPublicViewable ?? false}
      />
    </div>
  );
}

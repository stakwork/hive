import { BifrostCredsDevLog } from "@/components/settings/BifrostCredsDevLog";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/page-header";
import { isBifrostEnabledForWorkspace } from "@/config/env";
import { authOptions } from "@/lib/auth/nextauth";
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

  // DEV: when the rollout flag is on for this workspace, mount a
  // client-side helper that fetches the admin creds and dumps them to
  // the browser DevTools console. Gated server-side here so the
  // component is omitted from the React tree entirely for workspaces
  // that haven't opted in (no client-side flag leak).
  //
  // The `/api/workspaces/[slug]/bifrost/credentials` route the helper
  // hits enforces workspace OWNER/ADMIN server-side, so even if a
  // viewer somehow rendered this component the route would 403.
  //
  // Remove once the proper "Open dashboard / copy password" card
  // lands in SettingsTabs.
  const showBifrostDevLog = isBifrostEnabledForWorkspace(workspace.slug);

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" />
      {showBifrostDevLog && <BifrostCredsDevLog slug={workspace.slug} />}
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

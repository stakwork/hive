import { DeleteWorkspace } from "@/components/DeleteWorkspace";
import { VMConfigSection } from "@/components/pool-status";
import { RerunIngest } from "@/components/RerunIngest";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";
import { Neo4jConfigSettings } from "@/components/settings/Neo4jConfigSettings";
import { NodeTypeOrderSettings } from "@/components/settings/NodeTypeOrderSettings";
import { SphinxIntegrationSettings } from "@/components/settings/SphinxIntegrationSettings";
import { VercelIntegrationSettings } from "@/components/settings/VercelIntegrationSettings";
import { PageHeader } from "@/components/ui/page-header";
import { WorkspaceMembers } from "@/components/workspace/WorkspaceMembers";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
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

  // Get workspace information
  const workspace = await getWorkspaceBySlug(slug, userId);
  if (!workspace) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" description="Manage workspace configuration, members, and settings." />

      <div className="max-w-2xl">
        <div className="space-y-6">
          <WorkspaceSettings />

          <VMConfigSection />

          <WorkspaceMembers canAdmin={workspace.userRole === "OWNER" || workspace.userRole === "ADMIN"} />

          <RerunIngest workspaceId={workspace.id} workspaceName={workspace.name} />

          <NodeTypeOrderSettings />

          <ApiKeysSettings />

          <VercelIntegrationSettings />

          <SphinxIntegrationSettings />

          <Neo4jConfigSettings />

          {workspace.userRole === "OWNER" && (
            <DeleteWorkspace workspaceSlug={workspace.slug} workspaceName={workspace.name} />
          )}
        </div>
      </div>
    </div>
  );
}

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { DeleteWorkspace } from "@/components/DeleteWorkspace";
import { WorkspaceMembers } from "@/components/workspace/WorkspaceMembers";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { getWorkspaceBySlug } from "@/services/workspace";
import { notFound } from "next/navigation";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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
      <div>
        <h1 className="text-3xl font-bold text-foreground">Workspace Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage workspace configuration, members, and settings.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <WorkspaceSettings />

        <WorkspaceMembers canAdmin={workspace.userRole === "OWNER" || workspace.userRole === "ADMIN"} />

        <DeleteWorkspace
          workspaceSlug={workspace.slug}
          workspaceName={workspace.name}
        />
      </div>
    </div>
  );
}

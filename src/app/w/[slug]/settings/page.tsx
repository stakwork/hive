import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { PageHeader } from "@/components/ui/page-header";
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

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" />
      <SettingsTabs
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspaceSlug={workspace.slug}
        isOwner={workspace.userRole === "OWNER"}
      />
    </div>
  );
}

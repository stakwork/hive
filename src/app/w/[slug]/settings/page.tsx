import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DisconnectAccount } from "@/components/DisconnectAccount";
import { ThemeSettings } from "@/components/ThemeSettings";
import { DeleteWorkspace } from "@/components/DeleteWorkspace";
import { WorkspaceMembers } from "@/components/workspace/WorkspaceMembers";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { getWorkspaceBySlug } from "@/services/workspace";
import { notFound } from "next/navigation";
import { Github } from "lucide-react";

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

  const user = {
    name: session?.user?.name,
    email: session?.user?.email,
    image: session?.user?.image,
    github: (
      session?.user as {
        github?: {
          username?: string;
          publicRepos?: number;
          followers?: number;
        };
      }
    )?.github,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account settings and connected services.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <WorkspaceSettings />

        <WorkspaceMembers canAdmin={workspace.userRole === "OWNER" || workspace.userRole === "ADMIN"} />

        <ThemeSettings />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" />
              Connected Accounts
            </CardTitle>
            <CardDescription>
              Manage your connected third-party accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DisconnectAccount user={user} />
          </CardContent>
        </Card>

        <DeleteWorkspace
          workspaceSlug={workspace.slug}
          workspaceName={workspace.name}
        />
      </div>
    </div>
  );
}

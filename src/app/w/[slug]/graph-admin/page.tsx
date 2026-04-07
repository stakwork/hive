import { GraphAdminClient } from "./client";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { notFound } from "next/navigation";

export default async function GraphAdminPage({ params }: { params: Promise<{ slug: string }> }) {
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

  if (workspace.workspaceKind !== "graph_mindset") {
    notFound();
  }

  if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
    notFound();
  }

  return (
    <GraphAdminClient
      swarmUrl={workspace.swarmUrl}
      workspaceSlug={slug}
      workspaceName={workspace.name}
    />
  );
}

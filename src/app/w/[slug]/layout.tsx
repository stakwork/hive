import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import { getWorkspaceBySlug, getPublicWorkspaceBySlug } from "@/services/workspace";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const session = await getServerSession(authOptions);

  try {
    if (session?.user?.id) {
      // Metadata only — opt in to the public-viewer fallback so that
      // signed-in non-members get the workspace name in the tab title
      // when browsing a public workspace they don't belong to.
      const workspace = await getWorkspaceBySlug(slug, session.user.id, {
        allowPublicViewer: true,
      });
      if (workspace) {
        return { title: workspace.name };
      }
    } else {
      const workspace = await getPublicWorkspaceBySlug(slug);
      if (workspace) {
        return { title: workspace.name };
      }
    }
  } catch (error) {
    console.error("Error fetching workspace for metadata:", error);
  }

  return { title: "Hive" };
}

export default async function DashboardRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { slug } = await params;

  if (!session) {
    // No session — check if workspace is publicly viewable
    const publicWorkspace = await getPublicWorkspaceBySlug(slug);
    if (!publicWorkspace) {
      redirect("/");
    }

    // Unauthenticated viewer on a public workspace
    return (
      <DashboardLayout user={null} isPublicWorkspace={true}>
        {children}
      </DashboardLayout>
    );
  }

  const user = {
    name: session.user?.name,
    email: session.user?.email,
    image: session.user?.image,
    github: (
      session.user as {
        github?: {
          username?: string;
          publicRepos?: number;
          followers?: number;
        };
      }
    )?.github,
  };

  return <DashboardLayout user={user}>{children}</DashboardLayout>;
}

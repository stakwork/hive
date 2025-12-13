import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";
import { getWorkspaceBySlug } from "@/services/workspace";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return {
      title: "Hive",
    };
  }

  try {
    const workspace = await getWorkspaceBySlug(slug, session.user.id);
    
    if (workspace) {
      return {
        title: workspace.name,
      };
    }
  } catch (error) {
    console.error("Error fetching workspace for metadata:", error);
  }

  return {
    title: "Hive",
  };
}

export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/");
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

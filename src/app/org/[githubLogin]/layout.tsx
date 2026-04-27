import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { OrgShell } from "./_components/OrgShell";

interface OrgLayoutProps {
  children: React.ReactNode;
  params: Promise<{ githubLogin: string }>;
}

/**
 * Server layout for the org page. Owns auth + org lookup once and
 * passes identity props down to the client shell, so each route
 * segment beneath (`/`, `/initiatives`, `/workspaces`, etc.) skips
 * the duplicate session/db work.
 */
export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/auth/signin");
  }

  const { githubLogin } = await params;

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
    select: { id: true, name: true, githubLogin: true, avatarUrl: true },
  });

  if (!org) {
    notFound();
  }

  return (
    <OrgShell
      githubLogin={githubLogin}
      orgId={org.id}
      orgName={org.name}
      avatarUrl={org.avatarUrl}
    >
      {children}
    </OrgShell>
  );
}

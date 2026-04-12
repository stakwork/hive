import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ConnectionsPage } from "./ConnectionsPage";

interface ConnectionsPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function OrgConnectionsPage({ params }: ConnectionsPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const { githubLogin } = await params;

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
    select: { id: true, name: true, githubLogin: true },
  });

  if (!org) {
    notFound();
  }

  return (
    <ConnectionsPage
      githubLogin={githubLogin}
      orgId={org.id}
      orgName={org.name}
    />
  );
}

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { OrgPageContent } from "./OrgPageContent";

interface OrgPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function OrgPage({ params }: OrgPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const { githubLogin } = await params;

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
  });

  if (!org) {
    notFound();
  }

  return (
    <OrgPageContent
      githubLogin={githubLogin}
      orgName={org.name}
      avatarUrl={org.avatarUrl}
    />
  );
}

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { OrgCanvasView } from "./_components/OrgCanvasView";

interface OrgPageProps {
  params: Promise<{ githubLogin: string }>;
}

/**
 * Default org route — renders the canvas view directly. Auth and the
 * org lookup happen in the parent `layout.tsx`; we still need the org
 * id here because `OrgCanvasView` threads it into the chat overlay.
 */
export default async function OrgPage({ params }: OrgPageProps) {
  const { githubLogin } = await params;

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
    select: { id: true, name: true },
  });

  if (!org) {
    notFound();
  }

  return (
    <Suspense>
      <OrgCanvasView
        githubLogin={githubLogin}
        orgId={org.id}
        orgName={org.name}
      />
    </Suspense>
  );
}

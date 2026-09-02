/**
 * Org-member share page for a stored HTML artifact.
 *
 * `/org/[githubLogin]/h/[slug]`
 *
 * The org layout already enforces session (`redirect("/auth/signin")`) and
 * membership (`notFound()`), so this page only adds the row-level check:
 * the `HtmlPage` must belong to *this* org. A slug from another org 404s
 * rather than 403s, so the page never confirms that it exists elsewhere.
 *
 * The body itself is never rendered here — `HtmlArtifactFrame` fetches it
 * from the authenticated proxy into a locked sandbox.
 */
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { HtmlArtifactFrame } from "@/components/html-artifact/HtmlArtifactFrame";

interface HtmlSharePageProps {
  params: Promise<{ githubLogin: string; slug: string }>;
}

export default async function HtmlSharePage({ params }: HtmlSharePageProps) {
  const { githubLogin, slug } = await params;

  const org = await db.sourceControlOrg.findFirst({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) {
    notFound();
  }

  // Scoped by (orgId, slug) — never a bare slug lookup.
  const page = await db.htmlPage.findUnique({
    where: { orgId_slug: { orgId: org.id, slug } },
    select: { title: true, uploadedAt: true },
  });
  if (!page) {
    // Pointer metadata only; never an HTML body.
    console.warn("[html-pages] share page denied", {
      reason: "page-not-found-for-org",
      githubLogin,
      slug,
    });
    notFound();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1 border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">{page.title}</h1>
        <p className="text-xs text-muted-foreground">
          Shared with your organization · updated{" "}
          {page.uploadedAt.toLocaleDateString()}
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <HtmlArtifactFrame
          source={{ githubLogin, slug }}
          title={page.title}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

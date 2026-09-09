/**
 * Org-member share page for a stored HTML artifact.
 *
 * `/org/[githubLogin]/h/[slug]`
 *
 * The org layout already enforces session (`redirect("/auth/signin")`) and
 * membership (`notFound()`) via `validateUserBelongsToOrg`. This page adds
 * its own explicit row-level check on top rather than trusting the layout
 * alone: it re-resolves membership through `resolveAuthorizedOrgId` — the
 * same helper the HTML body proxy and `canvas/node/[liveId]` now use — so
 * every HTML route agrees on one authorization convention, and then scopes
 * the `HtmlPage` lookup to that resolved `orgId` + `slug`. A slug from
 * another org 404s rather than 403s, so the page never confirms that it
 * exists elsewhere. Org-not-found, non-member, and page-not-found-in-org
 * are all deliberately indistinguishable — all three `notFound()`.
 *
 * The body itself is never rendered here — `HtmlArtifactFrame` fetches it
 * from the authenticated proxy into a locked sandbox.
 */
import { getServerSession } from "next-auth/next";
import { notFound } from "next/navigation";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { HtmlArtifactFrame } from "@/components/html-artifact/HtmlArtifactFrame";

interface HtmlSharePageProps {
  params: Promise<{ githubLogin: string; slug: string }>;
}

export default async function HtmlSharePage({ params }: HtmlSharePageProps) {
  const { githubLogin, slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    // The org layout should already have redirected an unauthenticated
    // visitor to sign-in; this is a defensive fallback so the page never
    // renders content without its own session check.
    notFound();
  }

  const orgId = await resolveAuthorizedOrgId(githubLogin, session.user.id, /* requireAdmin */ false);
  if (!orgId) {
    // Covers both "org doesn't exist" and "user isn't a member" — never
    // distinguish the two.
    console.warn("[html-pages] share page denied", {
      reason: "not-authorized",
      githubLogin,
      slug,
    });
    notFound();
  }

  // Scoped by (orgId, slug) — never a bare slug lookup. `shareRef` is
  // intentionally excluded: it's a bearer secret for a not-yet-shipped
  // public link and must never reach this (or any) response shape.
  const page = await db.htmlPage.findUnique({
    where: { orgId_slug: { orgId, slug } },
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

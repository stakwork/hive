import { getServerSession } from "next-auth/next";
import { notFound } from "next/navigation";

import { authOptions } from "@/lib/auth/nextauth";
import { StrutView } from "@/components/strut/StrutView";
import { getWorkspaceBySlug } from "@/services/workspace";

interface StrutPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * `/w/[slug]/strut` — embeds THIS workspace's own swarm's strut lab (never
 * the org default). Follows the `graph-admin/page.tsx` pattern: session +
 * `getWorkspaceBySlug` WITHOUT `allowPublicViewer` is the only gate here,
 * since middleware treats `/w/**` as public.
 *
 * The actual mint (and its own Owner/Admin re-check) happens server-side
 * in `POST /api/workspaces/[slug]/strut/embed-url`, called by `StrutView`.
 * This page's role check is a UX guard so a below-admin member sees a
 * friendly message instead of a raw fetch failure.
 */
export default async function StrutPage({ params }: StrutPageProps) {
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

  if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-md text-center px-4">
          <div className="font-medium text-foreground mb-2">Access restricted</div>
          <div>You need Owner or Admin access to open Strut.</div>
        </div>
      </div>
    );
  }

  if (!workspace.swarmId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-md text-center px-4">
          <div className="font-medium text-foreground mb-2">No swarm configured</div>
          <div>This workspace has no swarm.</div>
        </div>
      </div>
    );
  }

  if (workspace.swarmStatus !== "ACTIVE") {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-md text-center px-4">
          <div className="font-medium text-foreground mb-2">Swarm not active</div>
          <div>This workspace&apos;s swarm isn&apos;t active yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full flex-1">
      <StrutView
        embedUrlEndpoint={`/api/workspaces/${encodeURIComponent(slug)}/strut/embed-url`}
      />
    </div>
  );
}

/**
 * Task-scoped HTML artifact body proxy.
 *
 * GET /api/tasks/[taskId]/artifacts/[artifactId]/html
 *
 * Serves the bytes behind an `ArtifactType.HTML` pointer to members of the
 * artifact's workspace. Deliberately separate from the MEDIA-only
 * `.../artifacts/[artifactId]/url` route: that one 302s to a presigned,
 * publicly-fetchable S3 URL, which is exactly what an untrusted HTML page
 * must never get.
 *
 * Like the org proxy, the body is returned as an opaque download so it can
 * only be rendered through `HtmlArtifactFrame`'s sandboxed blob URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { ArtifactType } from "@prisma/client";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getHtmlPageBytes } from "@/services/html-pages";
import { htmlBodyProxyHeaders } from "@/lib/utils/html-body-proxy";

export const fetchCache = "force-no-store";

function denied(reason: string, taskId: string, artifactId: string) {
  console.warn("[html-pages] task body proxy denied", { reason, taskId, artifactId });
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; artifactId: string }> },
) {
  const { taskId, artifactId } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    denied("unauthenticated", taskId, artifactId);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const artifact = await db.artifact.findUnique({
    where: { id: artifactId },
    select: {
      type: true,
      content: true,
      message: {
        select: {
          task: {
            select: {
              id: true,
              workspaceId: true,
              workspace: { select: { sourceControlOrgId: true } },
            },
          },
        },
      },
    },
  });

  const task = artifact?.message?.task;
  if (!artifact || artifact.type !== ArtifactType.HTML || !task || task.id !== taskId) {
    denied("artifact-missing-or-wrong-type", taskId, artifactId);
    return notFound();
  }

  const access = await validateWorkspaceAccessById(task.workspaceId, session.user.id);
  if (!access.hasAccess || !access.canRead) {
    denied("no-workspace-access", taskId, artifactId);
    return notFound();
  }

  // A workspace with no linked org can't own an HTML page.
  const orgId = task.workspace?.sourceControlOrgId;
  if (!orgId) {
    denied("workspace-has-no-org", taskId, artifactId);
    return notFound();
  }

  // The slug comes from the stored pointer; the s3Key is resolved from the
  // HtmlPage row, never from the artifact content.
  const slug = (artifact.content as { slug?: unknown } | null)?.slug;
  if (typeof slug !== "string" || !slug) {
    denied("pointer-missing-slug", taskId, artifactId);
    return notFound();
  }

  const result = await getHtmlPageBytes(orgId, slug);
  if (!result) {
    denied("page-or-object-missing", taskId, artifactId);
    return notFound();
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: htmlBodyProxyHeaders(),
  });
}

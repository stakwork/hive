/**
 * Ingest guard for `ArtifactType.HTML` on `POST /api/chat/response`.
 *
 * Jamie's `save_html` tool is the only writer of HTML pages. Ingest is a
 * *pointer* surface: it may attach an already-saved page to a task/feature
 * so plan mode can render it. It must never become a second writer that
 * can smuggle in raw markup or a cross-tenant S3 reference.
 *
 * Three gates, all fail-closed:
 *   1. Content is a pointer (no string body, no `html`/`body` keys).
 *   2. The `s3Key` parses as `orgs/{id}/…` where `{id}` is exactly the
 *      `sourceControlOrgId` of the task/feature's workspace.
 *   3. An `HtmlPage` row exists for `(orgId, slug)` whose `s3Key` matches.
 *      Without this the only read path 404s and the panel dangles.
 */
import { db } from "@/lib/db";
import { ArtifactType, type HtmlContent } from "@/lib/chat";
import { extractS3KeyInfo } from "@/lib/utils/s3-key-info";
import { validateHtmlPointerContent } from "@/lib/utils/html-artifact-pointer";

interface ArtifactLike {
  type: ArtifactType;
  content?: Record<string, unknown>;
}

export type HtmlIngestResult =
  | { ok: true; pointers: Map<number, HtmlContent> }
  | { ok: false; status: number; error: string };

/**
 * Resolve the `SourceControlOrg` id owning a task or feature, via its
 * workspace. Returns null when there is no workspace or the workspace has
 * no linked org — both of which must fail closed.
 */
async function resolveOrgId(scope: {
  taskId?: string;
  featureId?: string;
}): Promise<string | null> {
  if (scope.taskId) {
    const task = await db.task.findFirst({
      where: { id: scope.taskId, deleted: false },
      select: { workspace: { select: { sourceControlOrgId: true } } },
    });
    return task?.workspace?.sourceControlOrgId ?? null;
  }
  if (scope.featureId) {
    const feature = await db.feature.findUnique({
      where: { id: scope.featureId },
      select: { workspace: { select: { sourceControlOrgId: true } } },
    });
    return feature?.workspace?.sourceControlOrgId ?? null;
  }
  return null;
}

function deny(reason: string, orgId: string | null, slug?: string) {
  // Never log HTML bodies — pointer metadata only.
  console.warn("[chat/response] HTML artifact ingest denied", {
    reason,
    orgId,
    slug,
  });
}

export async function validateHtmlArtifactsForIngest(
  artifacts: ArtifactLike[],
  scope: { taskId?: string; featureId?: string },
): Promise<HtmlIngestResult> {
  if (!scope.taskId && !scope.featureId) {
    deny("no-task-or-feature", null);
    return {
      ok: false,
      status: 400,
      error: "taskId or featureId is required for HTML artifacts",
    };
  }

  const orgId = await resolveOrgId(scope);
  if (!orgId) {
    deny("workspace-has-no-org", null);
    return { ok: false, status: 404, error: "HTML artifact not found" };
  }

  const pointers = new Map<number, HtmlContent>();

  for (const [index, artifact] of artifacts.entries()) {
    if (artifact?.type !== ArtifactType.HTML) continue;

    const validated = validateHtmlPointerContent(artifact.content);
    if (!validated.ok) {
      deny(validated.error, orgId);
      return { ok: false, status: 400, error: validated.error };
    }
    const pointer = validated.pointer;

    // The key must belong to *this* org — compare against the cuid
    // `sourceControlOrgId`, never a githubLogin.
    const keyInfo = extractS3KeyInfo(pointer.s3Key);
    if (!keyInfo || keyInfo.type !== "org" || keyInfo.id !== orgId) {
      deny("s3key-foreign-org", orgId, pointer.slug);
      return { ok: false, status: 404, error: "HTML artifact not found" };
    }

    // The page must already exist, and the pointer must agree with it.
    const page = await db.htmlPage.findUnique({
      where: { orgId_slug: { orgId, slug: pointer.slug } },
      select: { s3Key: true, title: true, size: true, uploadedAt: true },
    });
    if (!page || page.s3Key !== pointer.s3Key) {
      deny(page ? "s3key-mismatch" : "no-html-page-row", orgId, pointer.slug);
      return { ok: false, status: 404, error: "HTML artifact not found" };
    }

    // Trust the stored row over the caller for display metadata.
    pointers.set(index, {
      ...pointer,
      title: page.title,
      size: page.size,
      uploadedAt: page.uploadedAt.toISOString(),
    });
  }

  return { ok: true, pointers };
}

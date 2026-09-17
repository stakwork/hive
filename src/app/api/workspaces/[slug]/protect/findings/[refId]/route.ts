import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { redactSecretEvidence, updateFindingVerification } from "@/lib/protect/findings";
import { PROTECT_FINDING_VERIFICATIONS } from "@/types/protect";

const patchSchema = z
  .object({
    verification: z.enum(PROTECT_FINDING_VERIFICATIONS),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; refId: string }> },
) {
  try {
    const { slug, refId } = await params;
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireProtectMemberAccess(access);
    if (member instanceof NextResponse) return member;

    if (!canAccessServerFeature(FEATURE_FLAGS.CODEBASE_RECOMMENDATION, member.role)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "verification must be confirmed or reported" },
        { status: 400 },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(member.workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Workspace swarm is not configured" }, { status: 400 });
    }

    const updated = await updateFindingVerification(
      jarvisConfig,
      refId,
      parsed.data.verification,
    );
    if (!updated.success || !updated.finding) {
      const notFound = updated.error === "Finding not found";
      return NextResponse.json(
        { error: updated.error || "Failed to update verification" },
        { status: notFound ? 404 : 502 },
      );
    }

    console.log(`[Protect] verification update ref_id=${refId}`);

    return NextResponse.json({
      success: true,
      finding: redactSecretEvidence(updated.finding),
    });
  } catch (error) {
    console.error("[Protect] findings PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

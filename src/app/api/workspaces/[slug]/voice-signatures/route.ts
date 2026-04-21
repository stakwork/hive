import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { getS3Service } from "@/services/s3";

export const runtime = "nodejs";

interface Speaker {
  audio_filepath: string;
  duration: null;
  label: string;
  name: string;
}

interface NeMoEnrollmentManifest {
  speakers: Speaker[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Step 1: Look up workspace by slug
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            voiceSignatureKey: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 }
      );
    }

    // Step 2: Authenticate and authorize. x-api-token callers are trusted
    // service-to-service clients that bypass membership. Session-
    // authenticated callers must be members of this specific workspace —
    // voice signatures are biometric data and must not leak cross-tenant.
    // `requireAuthOrApiToken` alone is not sufficient: it accepts any
    // signed-in user regardless of workspace membership.
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;

    if (apiTokenAuth) {
      const authResult = await requireAuthOrApiToken(request, workspace.id);
      if (authResult instanceof NextResponse) {
        return authResult;
      }
    } else {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: workspace.id,
      });
      const member = requireMemberAccess(access);
      if (member instanceof NextResponse) return member;
    }

    // Step 3: Query active members with voice signatures
    const members = await db.workspaceMember.findMany({
      where: {
        workspaceId: workspace.id,
        leftAt: null,
        user: {
          voiceSignatureKey: { not: null },
        },
      },
      select: {
        user: {
          select: {
            id: true,
            name: true,
            voiceSignatureKey: true,
          },
        },
      },
    });

    // Step 4: Collect all users with voice signatures (members + owner)
    const usersWithSignatures = new Map<string, { id: string; name: string; voiceSignatureKey: string }>();

    // Add members
    for (const member of members) {
      if (member.user.voiceSignatureKey) {
        usersWithSignatures.set(member.user.id, {
          id: member.user.id,
          name: member.user.name || "Unknown",
          voiceSignatureKey: member.user.voiceSignatureKey,
        });
      }
    }

    // Add owner if they have a voice signature and aren't already included
    if (workspace.owner.voiceSignatureKey && !usersWithSignatures.has(workspace.owner.id)) {
      usersWithSignatures.set(workspace.owner.id, {
        id: workspace.owner.id,
        name: workspace.owner.name || "Unknown",
        voiceSignatureKey: workspace.owner.voiceSignatureKey,
      });
    }

    // Step 5: Generate presigned URLs for each voice signature
    const s3Service = getS3Service();
    const speakers: Speaker[] = [];

    for (const user of usersWithSignatures.values()) {
      const presignedUrl = await s3Service.generatePresignedDownloadUrl(
        user.voiceSignatureKey,
        3600 // 1 hour expiration
      );

      speakers.push({
        audio_filepath: presignedUrl,
        duration: null,
        label: user.id,
        name: user.name,
      });
    }

    // Step 6: Return NeMo-compatible enrollment manifest
    const manifest: NeMoEnrollmentManifest = {
      speakers,
    };

    return NextResponse.json(manifest, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    console.error("Error fetching voice signatures:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

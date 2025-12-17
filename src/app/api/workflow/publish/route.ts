import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";

export const fetchCache = "force-no-store";

interface PublishWorkflowRequest {
  workflowId: number;
  workflowRefId?: string;
  artifactId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const body = (await request.json()) as PublishWorkflowRequest;
    const { workflowId, workflowRefId, artifactId } = body;

    if (!workflowId) {
      return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
    }

    // Verify user has access to stakwork workspace
    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json({ error: "Access denied - not a member of stakwork workspace" }, { status: 403 });
    }

    // Call Stakwork API to publish the workflow
    const publishUrl = `${config.STAKWORK_BASE_URL}/workflows/${workflowId}/publish`;

    console.log("publishUrl", publishUrl);
    console.log("config.STAKWORK_API_KEY", config.STAKWORK_API_KEY);

    const response = await fetch(publishUrl, {
      method: "POST",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to publish workflow ${workflowId}:`, errorText);
      return NextResponse.json(
        { error: "Failed to publish workflow", details: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: result.error?.message || "Failed to publish workflow" }, { status: 400 });
    }

    // Update the artifact to mark it as published
    if (artifactId) {
      try {
        const artifact = await db.artifact.findUnique({
          where: { id: artifactId },
        });

        if (artifact) {
          const currentContent = (artifact.content as Record<string, unknown>) || {};
          await db.artifact.update({
            where: { id: artifactId },
            data: {
              content: {
                ...currentContent,
                published: true,
                publishedAt: new Date().toISOString(),
                workflowVersionId: result.data?.workflow_version_id,
              },
            },
          });
        }
      } catch (updateError) {
        console.error("Error updating artifact:", updateError);
        // Don't fail the request if artifact update fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          workflowId,
          workflowRefId,
          published: true,
          workflowVersionId: result.data?.workflow_version_id,
          message: "Workflow published successfully",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error publishing workflow:", error);
    return NextResponse.json({ error: "Failed to publish workflow" }, { status: 500 });
  }
}

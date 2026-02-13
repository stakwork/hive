import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get workspace and verify admin access
    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Only admins and owners can view webhook settings
    if (workspace.userRole !== "ADMIN" && workspace.userRole !== "OWNER") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Generate webhook URL
    const baseUrl = getBaseUrl();
    const webhookUrl = `${baseUrl}/api/github/webhook/${workspace.id}`;

    // Check if webhook has been used recently (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentDeployments = await db.deployment.count({
      where: {
        task: {
          workspaceId: workspace.id,
        },
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
    });

    // Get the most recent deployment to determine last webhook received
    const lastDeployment = await db.deployment.findFirst({
      where: {
        task: {
          workspaceId: workspace.id,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    });

    return NextResponse.json({
      webhookUrl,
      isConfigured: recentDeployments > 0,
      lastWebhookReceived: lastDeployment?.createdAt?.toISOString() || null,
      recentDeploymentsCount: recentDeployments,
    });
  } catch (error) {
    console.error("Error fetching webhook status:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhook status" },
      { status: 500 }
    );
  }
}

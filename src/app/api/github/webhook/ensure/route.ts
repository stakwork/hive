import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { WebhookService } from "@/services/github/WebhookService";
import { getServiceConfig } from "@/config/services";
import { getGithubWebhookCallbackUrl } from "@/lib/url";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const workspaceId: string | undefined = body?.workspaceId;
    const repositoryUrlInput: string | undefined = body?.repositoryUrl;
    const repositoryId: string | undefined = body?.repositoryId;

    if (!workspaceId || (!repositoryUrlInput && !repositoryId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Missing required fields: workspaceId and repositoryUrl or repositoryId",
        },
        { status: 400 },
      );
    }

    let repositoryUrl = repositoryUrlInput || "";
    if (!repositoryUrl && repositoryId) {
      const repo = await db.repository.findUnique({
        where: { id: repositoryId },
        select: { repositoryUrl: true, workspaceId: true },
      });
      if (!repo || repo.workspaceId !== workspaceId) {
        return NextResponse.json(
          { success: false, message: "Repository not found for workspace" },
          { status: 404 },
        );
      }
      repositoryUrl = repo.repositoryUrl;
    }

    if (!repositoryUrl) {
      return NextResponse.json(
        { success: false, message: "Repository URL not found" },
        { status: 400 },
      );
    }

    const callbackUrl = getGithubWebhookCallbackUrl(request);
    const webhookService = new WebhookService(getServiceConfig("github"));
    const result = await webhookService.ensureRepoWebhook({
      userId: session.user.id as string,
      workspaceId,
      repositoryUrl,
      callbackUrl,
    });

    return NextResponse.json(
      { success: true, data: { webhookId: result.id } },
      { status: 200 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, message: "Failed to ensure webhook" },
      { status: 500 },
    );
  }
}

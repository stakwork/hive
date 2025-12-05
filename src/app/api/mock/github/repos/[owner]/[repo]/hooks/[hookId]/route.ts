import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub Get Repository Webhook Endpoint
 * 
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}/hooks/{hook_id}
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string; hookId: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/webhooks/repos",
        },
        { status: 401 }
      );
    }

    const { owner, repo, hookId } = await params;
    const webhookId = parseInt(hookId, 10);
    
    const webhook = mockGitHubState.getWebhook(owner, repo, webhookId);
    
    if (!webhook) {
      return NextResponse.json(
        {
          message: "Not Found",
          documentation_url: "https://docs.github.com/rest/webhooks/repos",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(webhook);
  } catch (error) {
    console.error("Mock GitHub get webhook error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}

/**
 * Mock GitHub Delete Repository Webhook Endpoint
 * 
 * Simulates: DELETE https://api.github.com/repos/{owner}/{repo}/hooks/{hook_id}
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string; hookId: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        {
          message: "Requires authentication",
          documentation_url: "https://docs.github.com/rest/webhooks/repos",
        },
        { status: 401 }
      );
    }

    const { owner, repo, hookId } = await params;
    const webhookId = parseInt(hookId, 10);
    
    const deleted = mockGitHubState.deleteWebhook(owner, repo, webhookId);
    
    if (!deleted) {
      return NextResponse.json(
        {
          message: "Not Found",
          documentation_url: "https://docs.github.com/rest/webhooks/repos",
        },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Mock GitHub delete webhook error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}

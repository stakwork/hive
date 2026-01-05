import { NextRequest, NextResponse } from "next/server";
import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Mock GitHub List Repository Webhooks Endpoint
 *
 * Simulates: GET https://api.github.com/repos/{owner}/{repo}/hooks
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ owner: string; repo: string }> }) {
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

    const { owner, repo } = await params;

    // Ensure repository exists
    let repository = mockGitHubState.getRepository(owner, repo);
    if (!repository) {
      repository = mockGitHubState.createRepository(owner, repo);
    }

    const webhooks = mockGitHubState.getWebhooks(owner, repo);
    return NextResponse.json(webhooks);
  } catch (error) {
    console.error("Mock GitHub list webhooks error:", error);
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
 * Mock GitHub Create Repository Webhook Endpoint
 *
 * Simulates: POST https://api.github.com/repos/{owner}/{repo}/hooks
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ owner: string; repo: string }> }) {
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

    const { owner, repo } = await params;
    const body = await request.json();

    const { config, events = ["push"] } = body;

    if (!config || !config.url) {
      return NextResponse.json(
        {
          message: "Validation Failed",
          errors: [{ message: "config.url is required" }],
          documentation_url: "https://docs.github.com/rest/webhooks/repos",
        },
        { status: 422 }
      );
    }

    // Ensure repository exists
    let repository = mockGitHubState.getRepository(owner, repo);
    if (!repository) {
      repository = mockGitHubState.createRepository(owner, repo);
    }

    const webhook = mockGitHubState.createWebhook(owner, repo, config, events);

    return NextResponse.json(webhook, { status: 201 });
  } catch (error) {
    console.error("Mock GitHub create webhook error:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        documentation_url: "https://docs.github.com/rest",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ slug: string; workflowId: string; runId: string }>;
};

/** LLM provider API URL patterns */
const LLM_API_PATTERNS: Array<{ pattern: string; provider: string }> = [
  { pattern: "api.openai.com", provider: "openai" },
  { pattern: "api.anthropic.com", provider: "anthropic" },
  { pattern: "api.cohere.ai", provider: "cohere" },
  { pattern: "generativelanguage.googleapis.com", provider: "google" },
  { pattern: "api.mistral.ai", provider: "mistral" },
  { pattern: "api.together.xyz", provider: "together" },
];

function inferProvider(url: string): string | null {
  for (const { pattern, provider } of LLM_API_PATTERNS) {
    if (url.includes(pattern)) return provider;
  }
  return null;
}

function isLlmStep(transition: Record<string, unknown>): boolean {
  const url =
    (transition?.step as Record<string, unknown> | undefined)?.attributes &&
    ((transition.step as Record<string, unknown>).attributes as Record<string, unknown>)?.url;
  const urlFallback = (transition?.attributes as Record<string, unknown> | undefined)?.url;
  const requestUrl = (url ?? urlFallback ?? "") as string;
  return LLM_API_PATTERNS.some(({ pattern }) => requestUrl.includes(pattern));
}

function extractStepFromTransition(transition: Record<string, unknown>) {
  const stepAttrs = (
    (transition?.step as Record<string, unknown> | undefined)?.attributes as
      | Record<string, unknown>
      | undefined
  );
  const topAttrs = transition?.attributes as Record<string, unknown> | undefined;

  const requestUrl =
    ((stepAttrs?.url ?? topAttrs?.url) as string | undefined) ?? "";
  const requestParams =
    (stepAttrs?.request_params ?? topAttrs?.request_params) as
      | Record<string, unknown>
      | undefined;
  const output = (transition?.output as Record<string, unknown> | undefined)?.output as
    | Record<string, unknown>
    | undefined;
  const response = output?.response as Record<string, unknown> | undefined;

  const rawPreview =
    (
      (response?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
        | Record<string, unknown>
        | undefined
    )?.content ??
    ((response?.content as Array<Record<string, unknown>> | undefined)?.[0]?.text as
      | string
      | undefined) ??
    null;

  const preview =
    typeof rawPreview === "string" ? rawPreview.slice(0, 120) : null;

  return {
    stepId: (transition.unique_id ?? transition.id) as string,
    name: (transition.display_name ?? transition.name) as string,
    model: (requestParams?.model as string | undefined) ?? null,
    provider: inferProvider(requestUrl),
    endpoint_url: requestUrl || null,
    preview,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { slug, workflowId, runId } = await params;

    let userId = (session?.user as { id?: string })?.id ?? null;

    if (!userId) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET! });
      if (token?.id && typeof token.id === "string") {
        userId = token.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // IDOR guard — same pattern as the runs route
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      include: {
        members: {
          where: { userId, leftAt: null },
          select: { role: true },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json(
        { success: false, error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Validate workflowId and runId are integers
    const workflowIdNum = parseInt(workflowId, 10);
    if (isNaN(workflowIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid workflow ID" }, { status: 400 });
    }

    const runIdNum = parseInt(runId, 10);
    if (isNaN(runIdNum)) {
      return NextResponse.json({ success: false, error: "Invalid run ID" }, { status: 400 });
    }

    // Dev mode: delegate to mock endpoint
    if (isDevelopmentMode()) {
      const origin = request.nextUrl.origin;
      try {
        const mockRes = await fetch(
          `${origin}/api/mock/stakwork/workflows/${workflowIdNum}/runs/${runIdNum}/request-steps`,
        );
        if (mockRes.ok) {
          return NextResponse.json(await mockRes.json());
        }
      } catch {
        // fall through to empty response
      }
      return NextResponse.json({ success: true, data: { steps: [] } }, { status: 200 });
    }

    // Prod: fetch project JSON from Stakwork
    const projectRes = await fetch(
      `${config.STAKWORK_BASE_URL}/projects/${runIdNum}.json`,
      {
        headers: {
          Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        },
      },
    );

    if (!projectRes.ok) {
      const bodyText = await projectRes.text().catch(() => "(unreadable)");
      console.error("[RequestSteps] upstream error fetching project JSON", {
        status: projectRes.status,
        workflowId: workflowIdNum,
        runId: runIdNum,
        body: bodyText,
      });
      return NextResponse.json({ success: true, data: { steps: [] } }, { status: 200 });
    }

    const projectData = await projectRes.json();
    const transitions: Array<Record<string, unknown>> = projectData?.transitions ?? [];

    const steps = transitions
      .filter(isLlmStep)
      .map(extractStepFromTransition);

    return NextResponse.json({ success: true, data: { steps } });
  } catch (error) {
    console.error("[RequestSteps] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch request steps" },
      { status: 500 },
    );
  }
}

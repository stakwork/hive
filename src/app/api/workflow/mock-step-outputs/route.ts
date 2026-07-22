import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { STAK_TOOLKIT_SLUGS } from "@/lib/eval-capture-slugs";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

async function checkAccess(devMode: boolean): Promise<
  { authorized: true } | { authorized: false; response: NextResponse }
> {
  if (devMode) return { authorized: true };

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Invalid user session" }, { status: 401 }),
    };
  }

  const workspace = await db.workspace.findFirst({
    where: {
      slug: { in: STAK_TOOLKIT_SLUGS as string[] },
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });

  if (!workspace) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Access denied - not a member of an authorized workspace" },
        { status: 403 }
      ),
    };
  }

  return { authorized: true };
}

export async function GET(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();
    const access = await checkAccess(devMode);
    if (!access.authorized) return access.response;

    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get("workflow_id");

    if (!workflowId) {
      return NextResponse.json(
        { error: "workflow_id query parameter is required" },
        { status: 400 }
      );
    }

    if (devMode) {
      const { GET: mockGET } = await import(
        "@/app/api/mock/stakwork/mock-step-outputs/route"
      );
      return mockGET(request);
    }

    const workflowVersionId = searchParams.get("workflow_version_id");
    let url = `${config.STAKWORK_BASE_URL}/mock_step_outputs?workflow_id=${encodeURIComponent(workflowId)}`;
    if (workflowVersionId) {
      url += `&workflow_version_id=${encodeURIComponent(workflowVersionId)}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      console.error("Failed to fetch mock step outputs from Stakwork:", errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || "Failed to fetch mock step outputs" },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to fetch mock step outputs from Stakwork" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error fetching mock step outputs:", error);
    return NextResponse.json({ error: "Failed to fetch mock step outputs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();
    const access = await checkAccess(devMode);
    if (!access.authorized) return access.response;

    const body = await request.json();

    const { workflow_id, step_id, workflow_version_id, output } = body;

    if (!workflow_id) {
      return NextResponse.json({ error: "workflow_id is required" }, { status: 400 });
    }
    if (!step_id) {
      return NextResponse.json({ error: "step_id is required" }, { status: 400 });
    }
    if (!("output" in body)) {
      return NextResponse.json({ error: "output is required" }, { status: 400 });
    }

    if (devMode) {
      const { POST: mockPOST } = await import(
        "@/app/api/mock/stakwork/mock-step-outputs/route"
      );
      // Re-create the request with the already-parsed body so the mock can read it
      const mockReq = new NextRequest(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mock_step_output: { workflow_id, step_id, workflow_version_id: workflow_version_id ?? null, output } }),
      });
      return mockPOST(mockReq);
    }

    const stakworkBody = {
      mock_step_output: {
        workflow_id,
        step_id,
        workflow_version_id: workflow_version_id ?? null,
        output,
      },
    };

    const response = await fetch(`${config.STAKWORK_BASE_URL}/mock_step_outputs`, {
      method: "POST",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stakworkBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      console.error("Failed to create mock step output:", errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || "Failed to create mock step output" },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to create mock step output from Stakwork" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error creating mock step output:", error);
    return NextResponse.json({ error: "Failed to create mock step output" }, { status: 500 });
  }
}

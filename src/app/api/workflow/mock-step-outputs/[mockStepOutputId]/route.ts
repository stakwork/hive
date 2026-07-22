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
  { authorized: true; userId?: string } | { authorized: false; response: NextResponse }
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

  return { authorized: true, userId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const devMode = isDevelopmentMode();
    const access = await checkAccess(devMode);
    if (!access.authorized) return access.response;

    const { mockStepOutputId } = await params;

    if (!mockStepOutputId) {
      return NextResponse.json({ error: "Mock step output ID is required" }, { status: 400 });
    }

    if (devMode) {
      const { GET: mockGET } = await import(
        "@/app/api/mock/stakwork/mock-step-outputs/[mockStepOutputId]/route"
      );
      return mockGET(request, { params: Promise.resolve({ mockStepOutputId }) });
    }

    const url = `${config.STAKWORK_BASE_URL}/mock_step_outputs/${mockStepOutputId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      console.error(`Failed to fetch mock step output ${mockStepOutputId}:`, errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || "Failed to fetch mock step output" },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to fetch mock step output from Stakwork" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error fetching mock step output:", error);
    return NextResponse.json({ error: "Failed to fetch mock step output" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const devMode = isDevelopmentMode();
    const access = await checkAccess(devMode);
    if (!access.authorized) return access.response;

    const { mockStepOutputId } = await params;

    if (!mockStepOutputId) {
      return NextResponse.json({ error: "Mock step output ID is required" }, { status: 400 });
    }

    const body = await request.json();

    if (!("output" in body)) {
      return NextResponse.json({ error: "output is required" }, { status: 400 });
    }

    if (devMode) {
      const { PUT: mockPUT } = await import(
        "@/app/api/mock/stakwork/mock-step-outputs/[mockStepOutputId]/route"
      );
      // Re-create the request with the already-parsed body so the mock can read it
      const mockReq = new NextRequest(request.url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return mockPUT(mockReq, { params: Promise.resolve({ mockStepOutputId }) });
    }

    const url = `${config.STAKWORK_BASE_URL}/mock_step_outputs/${mockStepOutputId}`;

    const stakworkBody = {
      mock_step_output: {
        workflow_id: body.workflow_id,
        step_id: body.step_id,
        workflow_version_id: body.workflow_version_id ?? null,
        output: body.output,
      },
    };

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stakworkBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      console.error(`Failed to update mock step output ${mockStepOutputId}:`, errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || "Failed to update mock step output" },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to update mock step output" }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error updating mock step output:", error);
    return NextResponse.json({ error: "Failed to update mock step output" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ mockStepOutputId: string }> }
) {
  try {
    const devMode = isDevelopmentMode();
    const access = await checkAccess(devMode);
    if (!access.authorized) return access.response;

    const { mockStepOutputId } = await params;

    if (!mockStepOutputId) {
      return NextResponse.json({ error: "Mock step output ID is required" }, { status: 400 });
    }

    if (devMode) {
      const { DELETE: mockDELETE } = await import(
        "@/app/api/mock/stakwork/mock-step-outputs/[mockStepOutputId]/route"
      );
      return mockDELETE(request, { params: Promise.resolve({ mockStepOutputId }) });
    }

    const url = `${config.STAKWORK_BASE_URL}/mock_step_outputs/${mockStepOutputId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      console.error(`Failed to delete mock step output ${mockStepOutputId}:`, errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || "Failed to delete mock step output" },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to delete mock step output from Stakwork" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error deleting mock step output:", error);
    return NextResponse.json({ error: "Failed to delete mock step output" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json(
        { error: "Access denied - not a member of stakwork workspace" },
        { status: 403 }
      );
    }

    const { scriptId } = await params;

    if (!scriptId) {
      return NextResponse.json({ error: "Script ID is required" }, { status: 400 });
    }

    if (devMode) {
      const { GET: mockGET } = await import("@/app/api/mock/stakwork/scripts/[scriptId]/route");
      return mockGET(_request, { params: Promise.resolve({ scriptId }) });
    }

    const scriptUrl = `${config.STAKWORK_BASE_URL}/scripts/${scriptId}`;

    const response = await fetch(scriptUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch script ${scriptId} from Stakwork:`, errorText);
      return NextResponse.json(
        { error: "Failed to fetch script", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch script from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error fetching script:", error);
    return NextResponse.json({ error: "Failed to fetch script" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json(
        { error: "Access denied - not a member of stakwork workspace" },
        { status: 403 }
      );
    }

    const { scriptId } = await params;

    if (!scriptId) {
      return NextResponse.json({ error: "Script ID is required" }, { status: 400 });
    }

    const body = await request.json();

    if (!body.value) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    if (devMode) {
      const { PUT: mockPUT } = await import("@/app/api/mock/stakwork/scripts/[scriptId]/route");
      return mockPUT(request, { params: Promise.resolve({ scriptId }) });
    }

    const scriptUrl = `${config.STAKWORK_BASE_URL}/scripts/${scriptId}`;

    const response = await fetch(scriptUrl, {
      method: "PUT",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: body.value,
        description: body.description || "",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to update script ${scriptId}:`, errorText);
      return NextResponse.json(
        { error: "Failed to update script", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to update script" }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Error updating script:", error);
    return NextResponse.json({ error: "Failed to update script" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const stakworkWorkspace = await db.workspace.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json(
        { error: "Access denied - not a member of stakwork workspace" },
        { status: 403 }
      );
    }

    const { scriptId } = await params;

    if (!scriptId) {
      return NextResponse.json({ error: "Script ID is required" }, { status: 400 });
    }

    const scriptUrl = `${config.STAKWORK_BASE_URL}/scripts/${scriptId}`;

    const response = await fetch(scriptUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to delete script ${scriptId}:`, errorText);
      return NextResponse.json(
        { error: "Failed to delete script", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.success) {
      return NextResponse.json({ error: "Failed to delete script from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting script:", error);
    return NextResponse.json({ error: "Failed to delete script" }, { status: 500 });
  }
}

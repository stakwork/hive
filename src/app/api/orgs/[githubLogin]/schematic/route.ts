import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: org?.schematic ?? null });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/schematic] Error:", error);
    return NextResponse.json({ error: "Failed to fetch schematic" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> }
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  let schematic: string;
  try {
    const body = await request.json();
    if (typeof body.schematic !== "string") {
      return NextResponse.json({ error: "schematic must be a string" }, { status: 400 });
    }
    schematic = body.schematic;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const org = await db.sourceControlOrg.update({
      where: { githubLogin },
      data: { schematic },
      select: { schematic: true },
    });

    return NextResponse.json({ schematic: org.schematic });
  } catch (error) {
    console.error("[PUT /api/orgs/[githubLogin]/schematic] Error:", error);
    return NextResponse.json({ error: "Failed to update schematic" }, { status: 500 });
  }
}

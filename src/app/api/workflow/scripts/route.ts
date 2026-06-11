import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const devMode = isDevelopmentMode();

    if (!devMode) {
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

      if (!stakworkWorkspace) {
        return NextResponse.json(
          { error: "Access denied - not a member of stakwork workspace" },
          { status: 403 }
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const search = searchParams.get("search");

    if (devMode) {
      const { GET: mockGET } = await import("@/app/api/mock/stakwork/scripts/route");
      return mockGET(request);
    }

    let scriptsUrl = `${config.STAKWORK_BASE_URL}/scripts?page=${page}`;
    if (search) {
      scriptsUrl += `&search=${encodeURIComponent(search)}`;
    }

    const response = await fetch(scriptsUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch scripts from Stakwork:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch scripts", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      return NextResponse.json({ error: "Failed to fetch scripts from Stakwork" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        scripts: result.data.scripts,
        total: result.data.total,
        size: result.data.size,
        page,
      },
    });
  } catch (error) {
    console.error("Error fetching scripts:", error);
    return NextResponse.json({ error: "Failed to fetch scripts" }, { status: 500 });
  }
}

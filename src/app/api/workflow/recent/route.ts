import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const MOCK_WORKFLOWS = [
  { id: 1001, name: "Mock Workflow A", updated_at: "2024-03-18T14:32:10.000Z", last_modified_by: "alice@stakwork.com" },
  { id: 1002, name: "Mock Workflow B", updated_at: "2024-03-15T11:00:00.000Z", last_modified_by: null },
  { id: 1003, name: "Mock Workflow C", updated_at: "2024-03-12T09:15:00.000Z", last_modified_by: "bob@stakwork.com" },
  { id: 1004, name: "Mock Workflow D", updated_at: null, last_modified_by: "carol@stakwork.com" },
  { id: 1005, name: "Mock Workflow E", updated_at: "2024-03-10T08:00:00.000Z", last_modified_by: null },
];

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    // Verify user has access to stakwork workspace
    const stakworkWorkspace = await db.workspaces.findFirst({
      where: {
        slug: "stakwork",
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    const devMode = isDevelopmentMode();

    if (!stakworkWorkspace && !devMode) {
      return NextResponse.json(
        { error: "Access denied - not a member of stakwork workspace" },
        { status: 403 },
      );
    }

    // In dev mode, return static mock workflows
    if (devMode) {
      return NextResponse.json({
        success: true,
        data: { workflows: MOCK_WORKFLOWS },
      });
    }

    // Proxy to Stakwork API
    const recentUrl = `${config.STAKWORK_BASE_URL}/workflows/recently_modified`;

    const response = await fetch(recentUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch recent workflows from Stakwork:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch recent workflows", details: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      data: {
        workflows:
          result.data?.map(
            ({
              id,
              name,
              updated_at,
              last_modified_by,
            }: {
              id: number;
              name: string;
              updated_at: string | null;
              last_modified_by: string | null;
            }) => ({ id, name, updated_at, last_modified_by }),
          ) ?? [],
      },
    });
  } catch (error) {
    console.error("Error fetching recent workflows:", error);
    return NextResponse.json({ error: "Failed to fetch recent workflows" }, { status: 500 });
  }
}

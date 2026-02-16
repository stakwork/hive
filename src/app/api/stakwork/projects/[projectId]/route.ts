import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/config/env";

/**
 * GET /api/stakwork/projects/[projectId]
 *
 * Validates a Stakwork project ID and returns project information.
 * Used for project validation in the Project Debugger mode.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    // Fetch project info from Stakwork API
    const stakworkUrl = `${config.STAKWORK_BASE_URL}/projects/${projectId}`;

    const response = await fetch(stakworkUrl, {
      method: "GET",
      headers: {
        Authorization: `Token token=${config.STAKWORK_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
      }
      console.error(`Failed to fetch project from Stakwork: ${response.statusText}`);
      return NextResponse.json({ error: `Failed to fetch project: ${response.statusText}` }, { status: 500 });
    }

    const result = await response.json();

    if (!result.success || !result.data?.project) {
      return NextResponse.json({ success: false, error: "Invalid project data" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        project: result.data.project,
        current_transition_completion: result.data.current_transition_completion,
      },
    });
  } catch (error) {
    console.error("Error validating project:", error);
    return NextResponse.json({ error: "Failed to validate project" }, { status: 500 });
  }
}

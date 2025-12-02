import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, workflow_id, workflow_params } = body;

    if (!name || !workflow_id) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: name, workflow_id",
        },
        { status: 400 }
      );
    }

    const result = mockStakworkState.createProject({
      name,
      workflow_id,
      workflow_params,
    });

    const webhookUrl =
      workflow_params?.set_var?.attributes?.vars?.webhook_url;

    mockStakworkState.progressWorkflow(result.project_id, webhookUrl);

    return NextResponse.json({
      success: true,
      data: {
        project_id: result.project_id,
      },
    });
  } catch (error) {
    console.error("Mock Stakwork create project error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { stakworkService } from "@/lib/service-factory";

export async function POST(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { workflow_id } = body;

    if (!workflow_id || typeof workflow_id !== "number") {
      return NextResponse.json(
        { error: "Invalid workflow_id. Must be a number." },
        { status: 400 }
      );
    }

    // Validate workflow exists in Stakwork by attempting to create a minimal project
    // This is validation only - we do NOT save to database
    try {
      await stakworkService().createProject({
        workflow_id,
        title: "Validation Check",
        description: "Temporary validation check",
        budget: 1,
        skills: ["validation"],
        name: "validation-check",
        workflow_params: {
          set_var: {
            attributes: {
              vars: {},
            },
          },
        },
      });

      // If successful, workflow exists
      return NextResponse.json(
        { success: true, workflow_id },
        { status: 200 }
      );
    } catch (error: any) {
      // If Stakwork returns 404 or workflow not found error, workflow doesn't exist
      if (error?.response?.status === 404 || error?.message?.includes("not found")) {
        return NextResponse.json(
          { error: `Workflow ID ${workflow_id} not found in Stakwork` },
          { status: 404 }
        );
      }

      // Other Stakwork errors
      console.error("Stakwork validation error:", error);
      throw error;
    }
  } catch (error) {
    console.error("Workflow validation error:", error);
    return NextResponse.json(
      { error: "Internal server error during workflow validation" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, webhookUrl } = body;

    if (!description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 }
      );
    }

    console.log(`[Mock Stakwork] Plan request: ${description.substring(0, 100)}...`);

    const planRequest = mockStakworkState.createPlanRequest(
      description,
      webhookUrl
    );

    return NextResponse.json({
      success: true,
      requestId: planRequest.id,
      status: planRequest.status,
      progress: planRequest.progress,
      message: "Planning analysis started",
    });
  } catch (error) {
    console.error("[Mock Stakwork] Plan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("requestId");

    if (!requestId) {
      return NextResponse.json(
        { error: "requestId is required" },
        { status: 400 }
      );
    }

    const planRequest = mockStakworkState.getPlanRequest(requestId);

    if (!planRequest) {
      return NextResponse.json(
        { error: "Plan request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      requestId: planRequest.id,
      status: planRequest.status,
      progress: planRequest.progress,
      result: planRequest.result,
      createdAt: planRequest.created_at,
      completedAt: planRequest.completed_at,
    });
  } catch (error) {
    console.error("[Mock Stakwork] Plan status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const researchData = mockStakworkState.getResearchData(id);

    if (!researchData) {
      return NextResponse.json(
        { error: "Research data not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      requestId: researchData.id,
      topic: researchData.topic,
      status: researchData.status,
      progress: researchData.progress,
      result: researchData.result,
      createdAt: researchData.created_at,
      completedAt: researchData.completed_at,
    });
  } catch (error) {
    console.error("[Mock Stakwork] Research data error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, webhookUrl } = body;

    if (!topic) {
      return NextResponse.json(
        { error: "topic is required" },
        { status: 400 }
      );
    }

    console.log(`[Mock Stakwork] Research request: ${topic}`);

    const researchRequest = mockStakworkState.createResearchRequest(
      topic,
      webhookUrl
    );

    return NextResponse.json({
      success: true,
      requestId: researchRequest.id,
      status: researchRequest.status,
      progress: researchRequest.progress,
      message: "Deep research started",
    });
  } catch (error) {
    console.error("[Mock Stakwork] Research error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

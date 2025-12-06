import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, webhookUrl } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    console.log(`[Mock Stakwork] Generate request: ${prompt.substring(0, 100)}...`);

    const generateRequest = mockStakworkState.createGenerateRequest(
      prompt,
      webhookUrl
    );

    return NextResponse.json({
      success: true,
      requestId: generateRequest.id,
      status: generateRequest.status,
      progress: generateRequest.progress,
      message: "Code generation started",
    });
  } catch (error) {
    console.error("[Mock Stakwork] Generate error:", error);
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

    const generateRequest = mockStakworkState.getGenerateRequest(requestId);

    if (!generateRequest) {
      return NextResponse.json(
        { error: "Generate request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      requestId: generateRequest.id,
      status: generateRequest.status,
      progress: generateRequest.progress,
      result: generateRequest.result,
      createdAt: generateRequest.created_at,
      completedAt: generateRequest.completed_at,
    });
  } catch (error) {
    console.error("[Mock Stakwork] Generate status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

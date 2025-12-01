import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret, source } = body;

    if (!secret?.name || !secret?.value) {
      return NextResponse.json(
        { error: "Secret name and value required" },
        { status: 400 }
      );
    }

    const result = mockStakworkState.createSecret(secret.name, secret.value);

    return NextResponse.json({
      success: result.success,
      message: `Secret '${secret.name}' created successfully`,
      secret: {
        name: secret.name,
        source: source || "hive",
      },
    });
  } catch (error) {
    console.error("Mock Stakwork create secret error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
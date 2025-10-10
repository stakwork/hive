import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { reorderPhases } from "@/services/roadmap";
import type { ReorderPhasesRequest, PhaseListResponse } from "@/types/phase";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { featureId } = await params;
    const body: ReorderPhasesRequest = await request.json();

    const phases = await reorderPhases(featureId, userId, body.phases);

    return NextResponse.json<PhaseListResponse>(
      {
        success: true,
        data: phases,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error reordering phases:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder phases";
    const status = message.includes("not found") || message.includes("denied") ? 403 :
                   message.includes("array") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

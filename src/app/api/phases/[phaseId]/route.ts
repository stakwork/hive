import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { updatePhase, deletePhase } from "@/services/roadmap";
import type { UpdatePhaseRequest, PhaseResponse } from "@/types/phase";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ phaseId: string }> }
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

    const { phaseId } = await params;
    const body: UpdatePhaseRequest = await request.json();

    const phase = await updatePhase(phaseId, userId, body);

    return NextResponse.json<PhaseResponse>(
      {
        success: true,
        data: phase,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating phase:", error);
    const message = error instanceof Error ? error.message : "Failed to update phase";
    const status = message.includes("not found") || message.includes("denied") ? 403 :
                   message.includes("cannot be empty") || message.includes("must be") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ phaseId: string }> }
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

    const { phaseId } = await params;

    await deletePhase(phaseId, userId);

    return NextResponse.json(
      {
        success: true,
        message: "Phase deleted successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting phase:", error);
    const message = error instanceof Error ? error.message : "Failed to delete phase";
    const status = message.includes("not found") || message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

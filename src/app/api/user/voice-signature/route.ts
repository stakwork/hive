import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const voiceSignature = await db.voiceSignature.findUnique({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        sampleCount: true,
        lastUpdatedAt: true,
        createdAt: true,
      },
    });

    if (!voiceSignature) {
      return NextResponse.json({
        exists: false,
        sampleCount: 0,
        lastUpdatedAt: null,
      });
    }

    return NextResponse.json({
      exists: true,
      sampleCount: voiceSignature.sampleCount,
      lastUpdatedAt: voiceSignature.lastUpdatedAt,
      createdAt: voiceSignature.createdAt,
    });
  } catch (error) {
    console.error("Error fetching voice signature:", error);
    return NextResponse.json(
      { error: "Failed to fetch voice signature" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    await db.voiceSignature.delete({
      where: {
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Voice signature deleted successfully",
    });
  } catch (error) {
    // Handle case where voice signature doesn't exist
    if ((error as any).code === "P2025") {
      return NextResponse.json(
        { error: "Voice signature not found" },
        { status: 404 }
      );
    }

    console.error("Error deleting voice signature:", error);
    return NextResponse.json(
      { error: "Failed to delete voice signature" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { poolManagerService } from "@/lib/service-factory";
import { type ApiError } from "@/types";

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch (_error) {
      // Handle empty body or malformed JSON
      body = {};
    }
    
    const { name } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 },
      );
    }

    const pool = await poolManagerService().deletePool({ name });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (error) {
    console.error("Error deleting Pool Manager pool:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json(
      { error: "Failed to delete pool" },
      { status: 500 },
    );
  }
}

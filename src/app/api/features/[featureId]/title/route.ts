import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { featureId } = await params;

    if (!featureId) {
      return NextResponse.json(
        { error: "Feature ID is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Title is required and must be a string" },
        { status: 400 },
      );
    }

    const currentFeature = await db.feature.findUnique({
      where: { id: featureId },
      select: { id: true, title: true, workspaceId: true },
    });

    if (!currentFeature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 },
      );
    }

    const trimmedTitle = title.trim();

    if (currentFeature.title === trimmedTitle) {
      return NextResponse.json(
        {
          success: true,
          data: currentFeature,
          message: "Title unchanged",
        },
        { status: 200 },
      );
    }

    const updatedFeature = await db.feature.update({
      where: { id: featureId },
      data: { title: trimmedTitle },
      select: { id: true, title: true, workspaceId: true },
    });

    return NextResponse.json(
      { success: true, data: updatedFeature },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating feature title:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update feature title" },
      { status: 500 },
    );
  }
}

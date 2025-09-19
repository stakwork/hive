import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateRepositorySchema = z.object({
  testingFrameworkSetup: z.boolean().optional(),
  playwrightSetup: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization");

    if (!process.env.API_KEY) {
      return NextResponse.json(
        { error: "API_KEY not configured on server" },
        { status: 500 }
      );
    }

    if (!apiKey || apiKey !== process.env.API_KEY) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid or missing API key" },
        { status: 401 }
      );
    }

    const { id } = await params;

    const repository = await db.repository.findUnique({
      where: { id },
    });

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validatedData = updateRepositorySchema.parse(body);

    const updatedRepository = await db.repository.update({
      where: { id },
      data: validatedData,
    });

    return NextResponse.json(updatedRepository);
  } catch (error) {
    console.error("Error updating repository:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update repository" },
      { status: 500 }
    );
  }
}
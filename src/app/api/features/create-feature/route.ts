import { NextRequest, NextResponse } from "next/server";
import { type ModelMessage } from "ai";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { createFeature } from "@/services/roadmap";
import { extractFeatureFromTranscript } from "@/lib/ai/extract-feature";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspaceSlug, transcript } = body as {
      workspaceSlug: string;
      transcript: string | ModelMessage[];
    };

    if (!workspaceSlug || !transcript) {
      return NextResponse.json(
        { error: "Missing required fields: workspaceSlug, transcript" },
        { status: 400 }
      );
    }

    // Validate transcript is either a non-empty string or non-empty array
    const isValidString = typeof transcript === "string" && transcript.trim().length > 0;
    const isValidArray = Array.isArray(transcript) && transcript.length > 0;

    if (!isValidString && !isValidArray) {
      return NextResponse.json(
        { error: "Transcript must be a non-empty string or ModelMessage array" },
        { status: 400 }
      );
    }

    // Get workspace ID from slug
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    console.log("🎤 Creating feature from voice transcript:", {
      workspaceSlug,
      transcriptLength: typeof transcript === "string"
        ? transcript.length
        : `${transcript.length} messages`,
      isMessageArray: Array.isArray(transcript),
      userId: userOrResponse.id,
    });

    // Extract feature specifications from transcript using AI
    const extractedFeature = await extractFeatureFromTranscript(
      transcript,
      workspaceSlug
    );

    // Create feature with extracted data
    const feature = await createFeature(userOrResponse.id, {
      workspaceId: workspace.id,
      title: extractedFeature.title,
      brief: extractedFeature.brief,
      requirements: extractedFeature.requirements,
      // Set default status to PLANNED for voice-created features
      status: "PLANNED",
    });

    console.log("✅ Feature created from voice:", {
      featureId: feature.id,
      title: feature.title,
    });

    return NextResponse.json(
      {
        success: true,
        featureId: feature.id,
        title: feature.title,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("❌ Error creating feature from voice:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create feature from voice";
    const status = message.includes("denied")
      ? 403
      : message.includes("not found") || message.includes("required")
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

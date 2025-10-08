import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chunk, wordCount, workspaceSlug } = body;

    console.log("=== Transcript Chunk Received ===");
    console.log(`Workspace: ${workspaceSlug}`);
    console.log(`Word Count: ${wordCount}`);
    console.log(`Chunk: ${chunk}`);
    console.log("================================\n");

    return NextResponse.json({
      success: true,
      received: wordCount,
    });
  } catch (error) {
    console.error("Error processing transcript chunk:", error);
    return NextResponse.json({ error: "Failed to process chunk" }, { status: 500 });
  }
}

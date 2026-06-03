import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  // Consume params to satisfy Next.js dynamic route requirements
  await params;
  // No state tracking — just acknowledge the publish
  return NextResponse.json({ success: true });
}

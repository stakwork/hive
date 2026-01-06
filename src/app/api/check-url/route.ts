import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    // Only continue polling on 502 Bad Gateway, otherwise show iframe
    const isReady = response.status !== 502;

    return NextResponse.json({
      isReady,
      status: response.status,
    });
  } catch (error) {
    // Server is down or not responding
    return NextResponse.json({
      isReady: false,
      error: error instanceof Error ? error.message : "Failed to fetch",
    });
  }
}

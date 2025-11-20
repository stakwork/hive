import { NextResponse } from "next/server";
import { validateExternalUrl } from "@/lib/utils/url-validator";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  // SSRF Protection: Validate the URL before fetching
  const validation = validateExternalUrl(url);
  if (!validation.valid) {
    return NextResponse.json(
      { 
        error: validation.error,
        isReady: false 
      }, 
      { status: 400 }
    );
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    // Accept 2xx and 3xx as success, reject 4xx and 5xx
    const isReady = response.status < 400;

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

import { NextResponse } from "next/server";
import { config } from "@/config/env";

/**
 * Mock Anthropic Models API Endpoint
 *
 * Simulates: GET https://api.anthropic.com/v1/models
 */
export async function GET() {
  if (!config.USE_MOCKS) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: [
      {
        id: "claude-3-haiku-20240307",
        type: "model",
        display_name: "Claude 3 Haiku",
      },
      {
        id: "claude-3-5-sonnet-20241022",
        type: "model",
        display_name: "Claude 3.5 Sonnet",
      },
      {
        id: "claude-3-opus-20240229",
        type: "model",
        display_name: "Claude 3 Opus",
      },
    ],
  });
}

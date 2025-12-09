import { NextRequest, NextResponse } from "next/server";
import { mockGeminiState } from "@/lib/mock/gemini-state";
import { config } from "@/config/env";

const { USE_MOCKS } = config;

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  // Gate: Only accessible when USE_MOCKS=true
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoint not available in production mode" },
      { status: 404 }
    );
  }

  try {
    const { model } = await params;
    const apiKey = request.headers.get("x-goog-api-key");

    // Validate mock API key
    if (!apiKey || !apiKey.startsWith("mock-gemini-key-")) {
      return NextResponse.json(
        {
          error: {
            code: 401,
            message: "API key not valid. Please pass a valid API key.",
            status: "UNAUTHENTICATED",
          },
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { contents } = body;

    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: 400,
            message: "Invalid request: contents array is required",
            status: "INVALID_ARGUMENT",
          },
        },
        { status: 400 }
      );
    }

    // Extract prompt from contents
    const prompt = contents[0]?.parts?.[0]?.text || "";

    if (!prompt) {
      return NextResponse.json(
        {
          error: {
            code: 400,
            message: "Invalid request: prompt text is required",
            status: "INVALID_ARGUMENT",
          },
        },
        { status: 400 }
      );
    }

    // Generate mock diagram
    const base64Image = mockGeminiState.generateDiagram(prompt, model);

    // Return response matching Gemini API format
    return NextResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Image,
                },
              },
            ],
          },
          finishReason: "STOP",
          index: 0,
          safetyRatings: [
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              probability: "NEGLIGIBLE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              probability: "NEGLIGIBLE",
            },
            {
              category: "HARM_CATEGORY_HARASSMENT",
              probability: "NEGLIGIBLE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              probability: "NEGLIGIBLE",
            },
          ],
        },
      ],
      promptFeedback: {
        safetyRatings: [
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            probability: "NEGLIGIBLE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "NEGLIGIBLE",
          },
          {
            category: "HARM_CATEGORY_HARASSMENT",
            probability: "NEGLIGIBLE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            probability: "NEGLIGIBLE",
          },
        ],
      },
      usageMetadata: {
        promptTokenCount: Math.ceil(prompt.length / 4),
        candidatesTokenCount: 256,
        totalTokenCount: Math.ceil(prompt.length / 4) + 256,
      },
    });
  } catch (error) {
    console.error("Mock Gemini error:", error);
    return NextResponse.json(
      {
        error: {
          code: 500,
          message:
            error instanceof Error ? error.message : "Internal server error",
          status: "INTERNAL",
        },
      },
      { status: 500 }
    );
  }
}

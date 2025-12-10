import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { mockGeminiState } from "@/lib/mock/gemini-state";

/**
 * Mock Gemini GenerateContent API Endpoint
 * 
 * Simulates: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * 
 * Returns a simple mock diagram image in Gemini's response format.
 * Always succeeds with valid PNG data for testing happy-path scenarios.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  // Only allow in mock mode
  if (!config.USE_MOCKS) {
    return NextResponse.json(
      { error: "Mock endpoints only available when USE_MOCKS=true" },
      { status: 403 }
    );
  }

  const { modelId } = await params;
  
  // Validate API key (Gemini uses x-goog-api-key header)
  const apiKey = request.headers.get("x-goog-api-key");
  if (!apiKey?.startsWith("mock-gemini-key-")) {
    return NextResponse.json(
      { 
        error: {
          code: 401,
          message: "API key not valid. Please pass a valid API key.",
          status: "UNAUTHENTICATED"
        }
      },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { contents } = body;
    
    // Validate request structure
    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      return NextResponse.json(
        { 
          error: {
            code: 400,
            message: "Invalid request: contents array required",
            status: "INVALID_ARGUMENT"
          }
        },
        { status: 400 }
      );
    }

    // Extract the prompt text from user message
    const userMessage = contents.find((c: any) => c.role === "user");
    const promptText = userMessage?.parts?.[0]?.text || "Generate diagram";
    
    // Create mock generation request
    const generation = mockGeminiState.createRequest(promptText, modelId);
    
    // Return Gemini API response format with base64 image
    const imageBase64 = generation.imageBuffer.toString('base64');
    
    return NextResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: imageBase64,
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
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
      usageMetadata: {
        promptTokenCount: Math.floor(promptText.length / 4),
        candidatesTokenCount: 100,
        totalTokenCount: Math.floor(promptText.length / 4) + 100,
      },
    });
  } catch (error) {
    console.error("Mock Gemini error:", error);
    return NextResponse.json(
      { 
        error: {
          code: 500,
          message: "Internal server error",
          status: "INTERNAL"
        }
      },
      { status: 500 }
    );
  }
}
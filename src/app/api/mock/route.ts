import axios from "axios";
import { generateResponseBasedOnMessage } from "./responses";
import { NextRequest, NextResponse } from "next/server";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId, userId, artifacts } = await req.json();

    console.log("📨 Mock received message:", {
      message,
      taskId,
      userId,
      timestamp: new Date().toISOString(),
    });

    try {
      // Use the request host for internal API calls
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      console.log("🔗 Mock base URL:", baseUrl);

      // Generate mock response
      const mockResponse = generateResponseBasedOnMessage(message, baseUrl, artifacts);

      console.log("🤖 Mock generated response:", {
        originalMessage: message,
        response: mockResponse.message,
        taskId,
        timestamp: new Date().toISOString(),
      });

      const responsePayload = {
        taskId: taskId,
        message: mockResponse.message,
        contextTags: mockResponse.contextTags,
        sourceWebsocketID: mockResponse.sourceWebsocketID,
        artifacts: mockResponse.artifacts?.map((artifact) => ({
          type: artifact.type,
          content: artifact.content,
        })),
      };

      console.log("🚀 Mock sending response to API:", {
        taskId,
        messagePreview: mockResponse.message.substring(0, 50) + "...",
        timestamp: new Date().toISOString(),
      });

      await axios.post(`${baseUrl}/api/chat/response`, responsePayload);

      console.log("✅ Mock response sent successfully:", {
        taskId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Mock error sending response:", {
        error,
        taskId,
        timestamp: new Date().toISOString(),
      });
    }

    // Immediately respond to the original request
    return NextResponse.json({
      success: true,
      message: "Message received, response will be generated shortly",
    });
  } catch (error) {
    console.error("❌ Mock error processing message:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}

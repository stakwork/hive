import axios from "axios";
import { generateResponseBasedOnMessage } from "./responses";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId } = await req.json();

    try {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      const mockResponse = generateResponseBasedOnMessage(message, baseUrl);

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

      await axios.post(`${baseUrl}/api/chat/response`, responsePayload);
    } catch (error) {
      console.error("❌ Mock error sending response:", error);
    }

    return NextResponse.json({
      success: true,
      message: "Message received, response will be generated shortly",
    });
  } catch (error) {
    console.error(" Mock error processing message:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}

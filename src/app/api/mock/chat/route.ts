import axios from "axios";
import { generateResponseBasedOnMessage } from "./responses";
import { NextRequest, NextResponse } from "next/server";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId, artifacts, history } = await req.json();

    // Log history statistics
    if (history && Array.isArray(history)) {
      const totalArtifacts = history.reduce((sum: number, msg: Record<string, unknown>) => {
        const artifacts = msg.artifacts as Array<unknown> | undefined;
        return sum + (artifacts?.length || 0);
      }, 0);
      console.log(`📜 Chat history: ${history.length} messages, ${totalArtifacts} total artifacts`);
    } else {
      console.log('📜 Chat history: 0 messages');
    }

    try {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      const mockResponse = generateResponseBasedOnMessage(message, baseUrl, artifacts);

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

      await axios.post(`${baseUrl}/api/chat/response`, responsePayload, {
        headers: {
          "x-api-token": process.env.API_TOKEN || "",
        },
      });
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

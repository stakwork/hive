import { NextRequest, NextResponse } from "next/server";
import { processMockChat, type MockChatRequest } from "@/services/chat-mock";
import axios from "axios";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId, userId, artifacts = [], history = [] } = await req.json();

    // Validate required fields
    if (!taskId || !message || !userId) {
      return NextResponse.json(
        { error: "Missing required fields: taskId, message, or userId" },
        { status: 400 },
      );
    }

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

    // Use shared mock chat service
    const mockRequest: MockChatRequest = {
      taskId,
      message,
      userId,
      artifacts: artifacts.map((a: { type: string; content?: unknown }) => ({
        type: a.type,
        title: "",
        content: JSON.stringify(a.content || {}),
      })),
      history,
    };

    const result = await processMockChat(mockRequest);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Mock chat processing failed" },
        { status: 500 },
      );
    }

    // Send response to chat endpoint
    try {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      const responsePayload = {
        taskId: taskId,
        message: result.data?.content || "",
        contextTags: [],
        sourceWebsocketID: null,
        artifacts: result.data?.artifacts?.map((artifact) => ({
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
    console.error("Mock error processing message:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}

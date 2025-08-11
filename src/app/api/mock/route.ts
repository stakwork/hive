import axios from "axios";
import { generateResponseBasedOnMessage } from "./responses";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { emitWorkflowStatus } from "@/lib/emitWorkflowStatus";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  try {
    const { message, taskId } = await req.json();

    try {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${host}`;

      const mockResponse = generateResponseBasedOnMessage(message, baseUrl);

      if (!mockResponse) {
        try {
          await axios.post(`${baseUrl}/api/chat/response`, {
            taskId,
            message: "⚠️ Response failed. Please try again.",
            contextTags: [],
            sourceWebsocketID: null,
            artifacts: [],
          });
        } catch (broadcastErr) {
          console.error(
            "Failed to broadcast mock failure message:",
            broadcastErr,
          );
        }

        try {
          const updated = await db.task.update({
            where: { id: taskId },
            data: {
              workflowStatus: WorkflowStatus.FAILED,
              workflowCompletedAt: new Date(),
            },
          });
          await emitWorkflowStatus({
            taskId,
            workflowStatus: WorkflowStatus.FAILED,
            workflowStartedAt: updated.workflowStartedAt,
            workflowCompletedAt: updated.workflowCompletedAt,
          });
        } catch (statusErr) {
          console.error("Failed to set FAILED status for mock:", statusErr);
        }
        return NextResponse.json(
          {
            success: false,
            error: "Mock generation failed",
          },
          { status: 500 },
        );
      }

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

      try {
        const updated = await db.task.update({
          where: { id: taskId },
          data: {
            workflowStatus: WorkflowStatus.COMPLETED,
            workflowCompletedAt: new Date(),
          },
        });
        await emitWorkflowStatus({
          taskId,
          workflowStatus: WorkflowStatus.COMPLETED,
          workflowStartedAt: updated.workflowStartedAt,
          workflowCompletedAt: updated.workflowCompletedAt,
        });
      } catch (statusErr) {
        console.error("Failed to set COMPLETED status for mock:", statusErr);
      }
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

import { NextRequest } from "next/server";
import { mockServicesManager } from "../MockServicesStatusManager";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakgraph Agent Stream (Server-Sent Events)
 * GET /api/swarm/stakgraph/agent-stream - Stream agent processing updates
 * Note: No authentication required for mock endpoints
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const requestId = searchParams.get("request_id");
  const swarmId = searchParams.get("swarm_id");

  console.log("[Mock Agent Stream] Starting SSE stream:", {
    requestId,
    swarmId: swarmId?.substring(0, 10) + "..."
  });

  // Create SSE response
  const encoder = new TextEncoder();
  let intervalId: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const initialData = JSON.stringify({
        type: "connected",
        request_id: requestId,
        swarm_id: swarmId,
        timestamp: new Date().toISOString(),
        message: "Agent processing stream connected"
      });
      controller.enqueue(encoder.encode(`data: ${initialData}\n\n`));

      // Use the status manager to track progress
      const checkProgress = () => {
        const status = requestId ? mockServicesManager.getStatus(requestId) : null;

        if (!status) {
          // If no status found, close the stream
          clearInterval(intervalId);
          controller.close();
          console.log("[Mock Agent Stream] No status found, closing stream:", requestId);
          return;
        }

        if (status.status === "PROCESSING") {
          // Send progress message
          const progressData = JSON.stringify({
            type: "progress",
            request_id: requestId,
            swarm_id: swarmId,
            step: status.processing_step,
            total_steps: status.total_steps,
            current_task: status.current_task,
            progress_percentage: status.progress_percentage,
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));
        } else if (status.status === "COMPLETED") {
          // Send completion event
          const completedData = JSON.stringify({
            type: "completed",
            request_id: requestId,
            swarm_id: swarmId,
            timestamp: new Date().toISOString(),
            message: "Agent processing completed successfully",
            result: {
              services_configured: status.services?.length || 3,
              environment_variables_set: Object.keys(status.environment_variables || {}).length,
              status: "ready"
            }
          });
          controller.enqueue(encoder.encode(`event: completed\ndata: ${completedData}\n\n`));

          // Close stream
          setTimeout(() => {
            clearInterval(intervalId);
            controller.close();
            console.log("[Mock Agent Stream] Stream completed:", requestId);
          }, 100);
        } else if (status.status === "FAILED") {
          // Send error event
          const errorData = JSON.stringify({
            type: "error",
            request_id: requestId,
            swarm_id: swarmId,
            timestamp: new Date().toISOString(),
            message: status.current_task || "Agent processing failed"
          });
          controller.enqueue(encoder.encode(`event: error\ndata: ${errorData}\n\n`));

          // Close stream
          setTimeout(() => {
            clearInterval(intervalId);
            controller.close();
            console.log("[Mock Agent Stream] Stream failed:", requestId);
          }, 100);
        }
      };

      intervalId = setInterval(checkProgress, 1000); // Check status every 1 second
    },

    cancel() {
      console.log("[Mock Agent Stream] Stream cancelled:", requestId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control"
    }
  });
}
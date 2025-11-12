import { NextRequest } from "next/server";

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

      let stepCount = 0;
      const totalSteps = 5;
      const steps = [
        "Initializing agent environment",
        "Analyzing repository structure",
        "Processing code dependencies",
        "Setting up services configuration",
        "Finalizing environment setup"
      ];

      intervalId = setInterval(() => {
        stepCount++;

        if (stepCount <= totalSteps) {
          // Send progress message
          const progressData = JSON.stringify({
            type: "progress",
            request_id: requestId,
            swarm_id: swarmId,
            step: stepCount,
            total_steps: totalSteps,
            current_task: steps[stepCount - 1],
            progress_percentage: Math.round((stepCount / totalSteps) * 100),
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(encoder.encode(`data: ${progressData}\n\n`));

          if (stepCount === totalSteps) {
            // Send completion event after final step
            setTimeout(() => {
              const completedData = JSON.stringify({
                type: "completed",
                request_id: requestId,
                swarm_id: swarmId,
                timestamp: new Date().toISOString(),
                message: "Agent processing completed successfully",
                result: {
                  services_configured: 3,
                  environment_variables_set: 8,
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
            }, 1000);
          }
        }
      }, 2000); // Send update every 2 seconds
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
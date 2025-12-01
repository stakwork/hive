/**
 * Playwright Recording Webhook Endpoint
 *
 * Test with curl:
 *
 * curl -X POST http://localhost:3000/api/tasks/YOUR_TASK_ID/recording \
 *   -H "x-api-key: YOUR_API_KEY" \
 *   -F "video=@/path/to/recording.webm" \
 *   -F "timestamps=@/path/to/timestamps.json"
 *
 * Example with actual files:
 *
 * curl -X POST http://localhost:3000/api/tasks/clx123abc/recording \
 *   -H "x-api-key: test-secret-key-123" \
 *   -F "video=@./test-recording.webm" \
 *   -F "timestamps=@./test-timestamps.json"
 *
 * To get the API key for a task:
 * 1. Set task.agentPassword in database (encrypted)
 * 2. Or generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
 *
 * Success Response (201):
 * {
 *   "success": true,
 *   "data": {
 *     "videoUrl": "https://s3.../presigned-url",
 *     "s3Key": "recordings/workspace/swarm/task/...",
 *     "messageId": "msg_xyz",
 *     "artifactIds": ["art_1", "art_2"]
 *   }
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { EncryptionService } from "@/lib/encryption";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { validateVideoSize, getMaxVideoSizeMB } from "@/lib/video-validation";
import { timingSafeEqual } from "@/lib/encryption";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  console.log("Recording webhook received");
  try {
    // Step 1: Request Validation
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    // Extract API key from header
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch task with relations
    const task = await db.task.findUnique({
      where: { id: taskId, deleted: false },
      select: {
        id: true,
        agentPassword: true,
        workspaceId: true,
        workspace: {
          select: { slug: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!task.agentPassword) {
      console.error(`Task ${taskId} has no agentPassword set`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Decrypt and validate API key
    let decryptedPassword: string;
    try {
      // Parse the JSON string to get the encrypted object
      const encryptedData = JSON.parse(task.agentPassword);
      decryptedPassword = encryptionService.decryptField("agentPassword", encryptedData);
    } catch (error) {
      console.error("Failed to decrypt agentPassword:", error);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Timing-safe comparison
    if (!timingSafeEqual(apiKey, decryptedPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Step 2: Parse Multipart Form Data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error("Failed to parse multipart form data:", error);
      return NextResponse.json({
        error: "Invalid multipart data",
        details: "Failed to parse multipart/form-data. Ensure Content-Type header includes boundary parameter.",
      }, { status: 400 });
    }

    const videoFile = formData.get("video") as File | null;
    const timestampsFile = formData.get("timestamps") as File | null;

    if (!videoFile || !timestampsFile) {
      return NextResponse.json({ error: "Missing required files" }, { status: 400 });
    }

    // Step 3: Validate Video File
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    const videoSize = videoBuffer.length;

    // Validate file size
    const maxVideoSizeMB = getMaxVideoSizeMB();
    if (!validateVideoSize(videoSize, maxVideoSizeMB)) {
      return NextResponse.json({ error: `File too large. Maximum size: ${maxVideoSizeMB}MB` }, { status: 413 });
    }

    // Validate video format (WebM magic numbers)
    const s3Service = getS3Service();
    if (!s3Service.validateVideoBuffer(videoBuffer, "video/webm")) {
      return NextResponse.json({ error: "Invalid video format" }, { status: 400 });
    }

    // Step 4: Parse Timestamps JSON
    const timestampsBuffer = Buffer.from(await timestampsFile.arrayBuffer());
    let timestampsJson: unknown;
    try {
      const timestampsText = timestampsBuffer.toString("utf-8");
      timestampsJson = JSON.parse(timestampsText);
    } catch (error) {
      console.error("Failed to parse timestamps JSON:", error);
      return NextResponse.json({ error: "Invalid timestamps JSON" }, { status: 400 });
    }

    // Step 5: Get Swarm for S3 Path
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: task.workspaceId },
      select: { id: true },
    });

    if (!swarm) {
      console.error(`No swarm found for workspace ${task.workspaceId}`);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    // Generate S3 key
    const s3Key = s3Service.generateVideoS3Path(task.workspaceId, swarm.id, taskId);

    // Step 6: Upload Video to S3
    try {
      await s3Service.putObject(s3Key, videoBuffer, "video/webm");
    } catch (error) {
      console.error("Failed to upload video to S3:", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Step 7: Create ChatMessage + 2 Artifacts
    // Note: We only store s3Key, not presigned URL, because:
    // - Presigned URLs expire when Vercel's OIDC credentials expire (~1 hour)
    // - Fresh URLs are generated on-demand via /api/artifacts/[id]/url endpoint
    let chatMessage;
    try {
      chatMessage = await db.chatMessage.create({
        data: {
          taskId,
          message: "Playwright recording uploaded",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          artifacts: {
            create: [
              {
                type: ArtifactType.MEDIA,
                content: {
                  s3Key: s3Key,
                  mediaType: "video",
                  filename: videoFile.name || "recording.webm",
                  size: videoSize,
                  contentType: "video/webm",
                  duration: null,
                  uploadedAt: new Date().toISOString(),
                },
                icon: "video",
              },
              {
                type: ArtifactType.LONGFORM,
                content: {
                  title: "Test Timestamps",
                  text: JSON.stringify(timestampsJson, null, 2),
                },
                icon: "timestamp",
              },
            ],
          },
        },
        include: {
          artifacts: true,
        },
      });
    } catch (error) {
      console.error("Failed to create chat message:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    // Step 8: Invalidate API Key (One-time Use)
    try {
      await db.task.update({
        where: { id: taskId },
        data: { agentPassword: null },
      });
    } catch (error) {
      console.error("Failed to invalidate API key:", error);
      // Don't fail the request, video is already uploaded
    }

    // Step 9: Return Success Response
    return NextResponse.json(
      {
        success: true,
        data: {
          s3Key: s3Key,
          messageId: chatMessage.id,
          artifactIds: chatMessage.artifacts.map((a) => a.id),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Unexpected error in recording webhook:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

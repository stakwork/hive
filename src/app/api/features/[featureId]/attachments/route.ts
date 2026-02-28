import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  const { featureId } = await params;

  const featureLookup = await db.feature.findUnique({
    where: { id: featureId },
    select: { workspaceId: true },
  });
  if (!featureLookup) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  const userOrResponse = await requireAuthOrApiToken(request, featureLookup.workspaceId);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const tasks = await db.task.findMany({
    where: { featureId, deleted: false },
    select: { id: true, title: true },
  });

  const taskIds = tasks.map((t) => t.id);
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t.title]));

  const messages = await db.chatMessage.findMany({
    where: { taskId: { in: taskIds } },
    select: {
      taskId: true,
      attachments: {
        select: { id: true, filename: true, mimeType: true, path: true },
      },
    },
  });

  const s3Service = getS3Service();
  const results: Array<{
    taskId: string;
    taskTitle: string;
    id: string;
    filename: string;
    mimeType: string;
    url: string;
  }> = [];

  await Promise.all(
    messages.map(async (msg) => {
      if (!msg.taskId) return;
      const media = msg.attachments.filter(
        (a) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/")
      );
      for (const att of media) {
        const url = await s3Service.generatePresignedDownloadUrl(att.path, 3600);
        results.push({
          taskId: msg.taskId,
          taskTitle: taskMap[msg.taskId] ?? "Unknown Task",
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          url,
        });
      }
    })
  );

  return NextResponse.json({ attachments: results });
}

import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";

/**
 * Fetch chat history for a task
 * @param taskId - The task ID to fetch history for
 * @param excludeMessageId - Optional message ID to exclude from results
 * @returns Array of chat messages with artifacts and attachments
 */
export async function fetchChatHistory(
  taskId: string,
  excludeMessageId?: string
): Promise<Record<string, unknown>[]> {
  const whereClause: { taskId: string; id?: { not: string } } = { taskId };
  if (excludeMessageId) {
    whereClause.id = { not: excludeMessageId };
  }

  const chatHistory = await db.chatMessage.findMany({
    where: whereClause,
    include: {
      artifacts: {
        where: {
          type: ArtifactType.LONGFORM,
        },
      },
      attachments: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return chatHistory.map((msg) => ({
    id: msg.id,
    message: msg.message,
    role: msg.role,
    status: msg.status,
    timestamp: msg.createdAt.toISOString(),
    contextTags: msg.contextTags ? JSON.parse(msg.contextTags as string) : [],
    artifacts: msg.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      content: artifact.content,
      icon: artifact.icon,
    })),
    attachments:
      msg.attachments?.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        path: attachment.path,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })) || [],
  }));
}

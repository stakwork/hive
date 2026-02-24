import { db } from "@/lib/db";
import type { WhiteboardMessage } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestWhiteboardMessageOptions {
  whiteboardId: string;
  role?: "USER" | "ASSISTANT";
  content?: string;
  status?: "SENDING" | "SENT" | "ERROR";
  userId?: string | null;
}

export async function createTestWhiteboardMessage(
  options: CreateTestWhiteboardMessageOptions
): Promise<WhiteboardMessage> {
  const uniqueId = generateUniqueId("wbmsg");
  return db.whiteboardMessage.create({
    data: {
      whiteboardId: options.whiteboardId,
      role: options.role ?? "USER",
      content: options.content ?? `Test message ${uniqueId}`,
      status: options.status ?? "SENT",
      userId: options.userId ?? null,
    },
  });
}

/** Create alternating USER/ASSISTANT messages for a whiteboard */
export async function createTestWhiteboardMessageThread(
  whiteboardId: string,
  userId: string,
  count = 6
): Promise<WhiteboardMessage[]> {
  const messages: WhiteboardMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      await createTestWhiteboardMessage({
        whiteboardId,
        role: i % 2 === 0 ? "USER" : "ASSISTANT",
        content: i % 2 === 0 ? `User question ${i + 1}` : `Assistant reply ${i + 1}`,
        userId: i % 2 === 0 ? userId : null,
      })
    );
  }
  return messages;
}

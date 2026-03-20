import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { ChatRole, ChatStatus } from "@/lib/chat";

describe("Feature Chat API - replyId Integration", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof db.features.create>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({owner_id: testUser.id });

    testFeature = await db.features.create({
      data: {
        title: "Test Feature for Chat",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
        phases: {
          create: {
            name: "Phase 1",
            order: 0,
          },
        },
      },
    });
  });

  afterEach(async () => {
    await db.chat_messages.deleteMany({ where: {feature_id: testFeature.id } });
    await db.phases.deleteMany({ where: {feature_id: testFeature.id } });
    await db.features.delete({ where: { id: testFeature.id } });
    await db.workspace_members.deleteMany({ where: {workspace_id: testWorkspace.id } });
    await db.workspaces.delete({ where: { id: testWorkspace.id } });
    await db.users.delete({ where: { id: testUser.id } });
  });

  const messageDefaults = () => ({feature_id: testFeature.id,user_id: testUser.id,
    status: ChatStatus.SENT,context_tags: "[]",
  });

  it("should persist replyId when creating a chat message", async () => {
    const originalMessage = await db.chat_messages.create({
      data: {
        ...messageDefaults(),
        message: "What is your target audience?",
        role: ChatRole.ASSISTANT,
      },
    });

    const replyMessage = await db.chat_messages.create({
      data: {
        ...messageDefaults(),
        message: "Our target audience is developers using TypeScript",
        role: ChatRole.USER,
        replyId: originalMessage.id,
      },
    });

    expect(replyMessage.replyId).toBe(originalMessage.id);

    const fetchedReply = await db.chat_messages.findUnique({
      where: { id: replyMessage.id },
    });
    expect(fetchedReply!.replyId).toBe(originalMessage.id);
  });

  it("should default replyId to null when not provided", async () => {
    const regularMessage = await db.chat_messages.create({
      data: {
        ...messageDefaults(),
        message: "This is a regular message",
        role: ChatRole.USER,
      },
    });

    expect(regularMessage.replyId).toBeNull();

    const fetchedMessage = await db.chat_messages.findUnique({
      where: { id: regularMessage.id },
    });
    expect(fetchedMessage!.replyId).toBeNull();
  });
});

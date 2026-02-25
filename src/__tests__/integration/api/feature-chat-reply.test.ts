import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { ChatRole, ChatStatus } from "@/lib/chat";

describe("Feature Chat API - replyId Integration", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof db.feature.create>>;

  beforeEach(async () => {
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    testFeature = await db.feature.create({
      data: {
        title: "Test Feature for Chat",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
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
    await db.chatMessage.deleteMany({ where: { featureId: testFeature.id } });
    await db.phase.deleteMany({ where: { featureId: testFeature.id } });
    await db.feature.delete({ where: { id: testFeature.id } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.delete({ where: { id: testWorkspace.id } });
    await db.user.delete({ where: { id: testUser.id } });
  });

  const messageDefaults = () => ({
    featureId: testFeature.id,
    userId: testUser.id,
    status: ChatStatus.SENT,
    contextTags: "[]",
  });

  it("should persist replyId when creating a chat message", async () => {
    const originalMessage = await db.chatMessage.create({
      data: {
        ...messageDefaults(),
        message: "What is your target audience?",
        role: ChatRole.ASSISTANT,
      },
    });

    const replyMessage = await db.chatMessage.create({
      data: {
        ...messageDefaults(),
        message: "Our target audience is developers using TypeScript",
        role: ChatRole.USER,
        replyId: originalMessage.id,
      },
    });

    expect(replyMessage.replyId).toBe(originalMessage.id);

    const fetchedReply = await db.chatMessage.findUnique({
      where: { id: replyMessage.id },
    });
    expect(fetchedReply!.replyId).toBe(originalMessage.id);
  });

  it("should default replyId to null when not provided", async () => {
    const regularMessage = await db.chatMessage.create({
      data: {
        ...messageDefaults(),
        message: "This is a regular message",
        role: ChatRole.USER,
      },
    });

    expect(regularMessage.replyId).toBeNull();

    const fetchedMessage = await db.chatMessage.findUnique({
      where: { id: regularMessage.id },
    });
    expect(fetchedMessage!.replyId).toBeNull();
  });
});

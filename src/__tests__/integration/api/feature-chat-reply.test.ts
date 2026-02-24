import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import { ChatRole, ChatStatus } from "@/lib/chat";

describe("Feature Chat API - replyId Integration", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testFeature: Awaited<ReturnType<typeof db.feature.create>>;

  beforeEach(async () => {
    // Create test user and workspace
    testUser = await createTestUser();
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create a test feature with Phase 1
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
    // Cleanup: delete test data
    await db.chatMessage.deleteMany({
      where: { featureId: testFeature.id },
    });
    await db.phase.deleteMany({
      where: { featureId: testFeature.id },
    });
    await db.feature.delete({
      where: { id: testFeature.id },
    });
    await db.workspaceMember.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.delete({
      where: { id: testWorkspace.id },
    });
    await db.user.delete({
      where: { id: testUser.id },
    });
  });

  it("should persist replyId when creating a chat message", async () => {
    // Create an original message (the clarifying questions message)
    const originalMessage = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "What is your target audience?",
        role: ChatRole.ASSISTANT,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
      },
    });

    // Create a reply message with replyId
    const replyMessage = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Our target audience is developers using TypeScript",
        role: ChatRole.USER,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
        replyId: originalMessage.id,
      },
    });

    // Verify the reply message was created with the correct replyId
    expect(replyMessage.replyId).toBe(originalMessage.id);

    // Fetch the message from the database to verify persistence
    const fetchedReply = await db.chatMessage.findUnique({
      where: { id: replyMessage.id },
    });

    expect(fetchedReply).toBeDefined();
    expect(fetchedReply!.replyId).toBe(originalMessage.id);
  });

  it("should allow messages without replyId", async () => {
    // Create a regular message without replyId
    const regularMessage = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "This is a regular message",
        role: ChatRole.USER,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
      },
    });

    expect(regularMessage.replyId).toBeNull();

    // Fetch from DB to verify
    const fetchedMessage = await db.chatMessage.findUnique({
      where: { id: regularMessage.id },
    });

    expect(fetchedMessage).toBeDefined();
    expect(fetchedMessage!.replyId).toBeNull();
  });

  it("should fetch reply message when querying original message", async () => {
    // Create original message
    const originalMessage = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Please clarify your requirements",
        role: ChatRole.ASSISTANT,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
      },
    });

    // Create reply
    const replyMessage = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Here are the clarifications...",
        role: ChatRole.USER,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
        replyId: originalMessage.id,
      },
    });

    // Fetch all messages for the feature
    const allMessages = await db.chatMessage.findMany({
      where: { featureId: testFeature.id },
      orderBy: { createdAt: "asc" },
    });

    expect(allMessages).toHaveLength(2);
    
    // Find the reply message in the results
    const fetchedReply = allMessages.find((m) => m.id === replyMessage.id);
    expect(fetchedReply).toBeDefined();
    expect(fetchedReply!.replyId).toBe(originalMessage.id);
  });

  it("should support multiple replies to different messages", async () => {
    // Create first original message
    const originalMessage1 = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Question 1?",
        role: ChatRole.ASSISTANT,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
      },
    });

    // Create second original message
    const originalMessage2 = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Question 2?",
        role: ChatRole.ASSISTANT,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
      },
    });

    // Create replies to both
    const reply1 = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Answer to question 1",
        role: ChatRole.USER,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
        replyId: originalMessage1.id,
      },
    });

    const reply2 = await db.chatMessage.create({
      data: {
        featureId: testFeature.id,
        message: "Answer to question 2",
        role: ChatRole.USER,
        userId: testUser.id,
        status: ChatStatus.SENT,
        contextTags: "[]",
        replyId: originalMessage2.id,
      },
    });

    // Verify both replies have correct replyIds
    expect(reply1.replyId).toBe(originalMessage1.id);
    expect(reply2.replyId).toBe(originalMessage2.id);

    // Fetch all messages
    const allMessages = await db.chatMessage.findMany({
      where: { featureId: testFeature.id },
      orderBy: { createdAt: "asc" },
    });

    expect(allMessages).toHaveLength(4);
    
    // Verify replyIds are correctly linked
    const fetchedReply1 = allMessages.find((m) => m.id === reply1.id);
    const fetchedReply2 = allMessages.find((m) => m.id === reply2.id);
    
    expect(fetchedReply1!.replyId).toBe(originalMessage1.id);
    expect(fetchedReply2!.replyId).toBe(originalMessage2.id);
  });
});

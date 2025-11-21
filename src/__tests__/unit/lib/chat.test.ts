import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChatMessage, createArtifact, ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";

describe("chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createChatMessage", () => {
    it("should create a basic chat message", () => {
      const message = createChatMessage({
        id: "msg-1",
        message: "Hello, world!",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      });

      expect(message).toMatchObject({
        id: "msg-1",
        message: "Hello, world!",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        taskId: null,
        workflowUrl: null,
        sourceWebsocketID: null,
        replyId: null,
        contextTags: [],
        artifacts: [],
        attachments: [],
      });
      expect(message.timestamp).toBeInstanceOf(Date);
      expect(message.createdAt).toBeInstanceOf(Date);
      expect(message.updatedAt).toBeInstanceOf(Date);
    });

    it("should create message with taskId", () => {
      const message = createChatMessage({
        id: "msg-1",
        message: "Task message",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        taskId: "task-123",
      });

      expect(message.taskId).toBe("task-123");
    });

    it("should create message with workflowUrl", () => {
      const message = createChatMessage({
        id: "msg-1",
        message: "Workflow message",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.PROCESSING,
        workflowUrl: "https://workflow.example.com/run/123",
      });

      expect(message.workflowUrl).toBe("https://workflow.example.com/run/123");
    });

    it("should create message with contextTags", () => {
      const contextTags = [
        { type: "REPOSITORY" as const, id: "repo-1" },
        { type: "FILE" as const, id: "file-1" },
      ];

      const message = createChatMessage({
        id: "msg-1",
        message: "Message with context",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        contextTags,
      });

      expect(message.contextTags).toEqual(contextTags);
    });

    it("should create message with artifacts", () => {
      const artifacts = [
        {
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
          content: { content: "console.log('test')", language: "javascript" },
          icon: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const message = createChatMessage({
        id: "msg-1",
        message: "Message with artifacts",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        artifacts,
      });

      expect(message.artifacts).toEqual(artifacts);
    });

    it("should create message with attachments", () => {
      const attachments = [
        {
          id: "attach-1",
          messageId: "msg-1",
          filename: "test.pdf",
          url: "https://example.com/test.pdf",
          size: 1024,
          mimeType: "application/pdf",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const message = createChatMessage({
        id: "msg-1",
        message: "Message with attachments",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        attachments,
      });

      expect(message.attachments).toEqual(attachments);
    });

    it("should create message with sourceWebsocketID", () => {
      const message = createChatMessage({
        id: "msg-1",
        message: "Websocket message",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        sourceWebsocketID: "ws-123",
      });

      expect(message.sourceWebsocketID).toBe("ws-123");
    });

    it("should create message with replyId", () => {
      const message = createChatMessage({
        id: "msg-2",
        message: "Reply message",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        replyId: "msg-1",
      });

      expect(message.replyId).toBe("msg-1");
    });

    it("should handle different ChatRole values", () => {
      const userMessage = createChatMessage({
        id: "msg-1",
        message: "User message",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      });
      expect(userMessage.role).toBe(ChatRole.USER);

      const assistantMessage = createChatMessage({
        id: "msg-2",
        message: "Assistant message",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
      });
      expect(assistantMessage.role).toBe(ChatRole.ASSISTANT);

      const systemMessage = createChatMessage({
        id: "msg-3",
        message: "System message",
        role: ChatRole.SYSTEM,
        status: ChatStatus.SENT,
      });
      expect(systemMessage.role).toBe(ChatRole.SYSTEM);
    });

    it("should handle different ChatStatus values", () => {
      const statuses = [ChatStatus.SENT, ChatStatus.PROCESSING, ChatStatus.ERROR, ChatStatus.CANCELLED];

      statuses.forEach((status) => {
        const message = createChatMessage({
          id: `msg-${status}`,
          message: "Test message",
          role: ChatRole.USER,
          status,
        });
        expect(message.status).toBe(status);
      });
    });
  });

  describe("createArtifact", () => {
    it("should create a basic artifact", () => {
      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.CODE,
      });

      expect(artifact).toMatchObject({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.CODE,
        content: undefined,
        icon: null,
      });
      expect(artifact.createdAt).toBeInstanceOf(Date);
      expect(artifact.updatedAt).toBeInstanceOf(Date);
    });

    it("should create artifact with CODE content", () => {
      const codeContent = {
        content: "function test() { return true; }",
        language: "javascript",
        file: "test.js",
      };

      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.CODE,
        content: codeContent,
      });

      expect(artifact.content).toEqual(codeContent);
    });

    it("should create artifact with FORM content", () => {
      const formContent = {
        actionText: "Submit Form",
        webhook: "https://api.example.com/submit",
        options: [
          {
            actionType: "button" as const,
            optionLabel: "Option 1",
            optionResponse: "Response 1",
          },
        ],
      };

      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.FORM,
        content: formContent,
      });

      expect(artifact.content).toEqual(formContent);
    });

    it("should create artifact with BROWSER content", () => {
      const browserContent = {
        url: "https://example.com",
      };

      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.BROWSER,
        content: browserContent,
      });

      expect(artifact.content).toEqual(browserContent);
    });

    it("should create artifact with LONGFORM content", () => {
      const longformContent = {
        text: "This is a long form text content",
        title: "Article Title",
      };

      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.LONGFORM,
        content: longformContent,
      });

      expect(artifact.content).toEqual(longformContent);
    });

    it("should create artifact with icon", () => {
      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.CODE,
        icon: "Code",
      });

      expect(artifact.icon).toBe("Code");
    });

    it("should handle all ArtifactType values", () => {
      const types = [ArtifactType.CODE, ArtifactType.FORM, ArtifactType.BROWSER, ArtifactType.LONGFORM];

      types.forEach((type) => {
        const artifact = createArtifact({
          id: `artifact-${type}`,
          messageId: "msg-1",
          type,
        });
        expect(artifact.type).toBe(type);
      });
    });

    it("should create artifact without content", () => {
      const artifact = createArtifact({
        id: "artifact-1",
        messageId: "msg-1",
        type: ArtifactType.CODE,
      });

      expect(artifact.content).toBeUndefined();
    });
  });
});

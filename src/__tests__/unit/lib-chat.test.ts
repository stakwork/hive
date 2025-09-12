import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createChatMessage,
  createArtifact,
  ChatRole,
  ChatStatus,
  ArtifactType,
  type ChatMessage,
  type Artifact,
  type ContextTag,
  type FormContent,
  type CodeContent,
  type BrowserContent,
  type LongformContent,
  type BugReportContent,
} from "@/lib/chat";

describe("Chat Utility Functions - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now to ensure consistent timestamps in tests
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  describe("createChatMessage", () => {
    test("should create basic chat message with required fields", () => {
      const data = {
        id: "msg-123",
        message: "Hello world",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      };

      const result = createChatMessage(data);

      expect(result).toEqual({
        id: "msg-123",
        taskId: null,
        message: "Hello world",
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        artifacts: [],
        attachments: [],
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      });
    });

    test("should handle sensitive fields properly", () => {
      const sensitiveData = {
        id: "msg-456",
        message: "Sensitive task update",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        taskId: "task-789",
        workflowUrl: "https://workflow.example.com/task-789",
        sourceWebsocketID: "ws-socket-123",
        replyId: "reply-456",
      };

      const result = createChatMessage(sensitiveData);

      // Verify sensitive fields are properly handled
      expect(result.taskId).toBe("task-789");
      expect(result.workflowUrl).toBe("https://workflow.example.com/task-789");
      expect(result.sourceWebsocketID).toBe("ws-socket-123");
      expect(result.replyId).toBe("reply-456");
    });

    test("should sanitize and validate message content", () => {
      const data = {
        id: "msg-789",
        message: "   Whitespace message   ",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      };

      const result = createChatMessage(data);

      // Message should be preserved as-is (no automatic trimming)
      expect(result.message).toBe("   Whitespace message   ");
    });

    test("should handle empty and null values safely", () => {
      const data = {
        id: "msg-empty",
        message: "",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        taskId: undefined,
        workflowUrl: undefined,
        sourceWebsocketID: undefined,
        replyId: undefined,
      };

      const result = createChatMessage(data);

      expect(result.message).toBe("");
      expect(result.taskId).toBeNull();
      expect(result.workflowUrl).toBeNull();
      expect(result.sourceWebsocketID).toBeNull();
      expect(result.replyId).toBeNull();
    });

    test("should handle context tags and artifacts", () => {
      const contextTags: ContextTag[] = [
        { type: "USER", id: "user-123" },
        { type: "TASK", id: "task-456" },
      ];

      const mockArtifact: Artifact = {
        id: "artifact-1",
        messageId: "msg-with-artifacts",
        type: ArtifactType.CODE,
        content: { content: "console.log('test')", language: "javascript" },
        icon: "Code",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      };

      const data = {
        id: "msg-with-artifacts",
        message: "Message with context and artifacts",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        contextTags,
        artifacts: [mockArtifact],
      };

      const result = createChatMessage(data);

      expect(result.contextTags).toEqual(contextTags);
      expect(result.artifacts).toEqual([mockArtifact]);
      expect(result.attachments).toEqual([]);
    });

    test("should generate consistent timestamps", () => {
      const data = {
        id: "msg-timestamp",
        message: "Timestamp test",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
      };

      const result = createChatMessage(data);

      expect(result.timestamp).toEqual(new Date("2024-01-01T00:00:00.000Z"));
      expect(result.createdAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
      expect(result.updatedAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
    });

    test("should handle all chat roles and statuses", () => {
      const roles = [ChatRole.USER, ChatRole.ASSISTANT, ChatRole.SYSTEM];
      const statuses = [
        ChatStatus.SENDING,
        ChatStatus.SENT,
        ChatStatus.ERROR,
        ChatStatus.RECEIVED,
      ];

      roles.forEach((role) => {
        statuses.forEach((status) => {
          const data = {
            id: `msg-${role}-${status}`,
            message: `Test message for ${role} with ${status}`,
            role,
            status,
          };

          const result = createChatMessage(data);

          expect(result.role).toBe(role);
          expect(result.status).toBe(status);
        });
      });
    });

    test("should prevent prototype pollution attempts", () => {
      const maliciousData = {
        id: "msg-malicious",
        message: "Normal message",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        ["__proto__"]: { malicious: true },
        constructor: { prototype: { evil: "payload" } },
      } as any;

      const result = createChatMessage(maliciousData);

      // Should not contain malicious properties
      expect(result).not.toHaveProperty("malicious");
      expect(result).not.toHaveProperty("evil");
      expect(result.constructor.prototype).not.toHaveProperty("evil");
    });
  });

  describe("createArtifact", () => {
    test("should create basic artifact with required fields", () => {
      const data = {
        id: "artifact-123",
        messageId: "msg-456",
        type: ArtifactType.CODE,
      };

      const result = createArtifact(data);

      expect(result).toEqual({
        id: "artifact-123",
        messageId: "msg-456",
        type: ArtifactType.CODE,
        content: undefined,
        icon: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      });
    });

    test("should handle form content with sensitive webhook data", () => {
      const formContent: FormContent = {
        actionText: "Submit Form",
        webhook: "https://api.sensitive.com/webhook/secret-token-123",
        options: [
          {
            actionType: "button",
            optionLabel: "Confirm",
            optionResponse: "confirmed",
          },
        ],
      };

      const data = {
        id: "artifact-form",
        messageId: "msg-form",
        type: ArtifactType.FORM,
        content: formContent,
        icon: "Message" as const,
      };

      const result = createArtifact(data);

      expect(result.content).toEqual(formContent);
      expect(result.icon).toBe("Message");
      expect((result.content as FormContent).webhook).toBe(
        "https://api.sensitive.com/webhook/secret-token-123",
      );
    });

    test("should handle code content with potential secrets", () => {
      const codeContent: CodeContent = {
        content: `
          const API_KEY = "sk-123456789";
          const DATABASE_URL = "postgres://user:pass@host:5432/db";
          console.log("Potentially sensitive code");
        `,
        language: "javascript",
        file: "/src/config/secrets.js",
        change: "Added API configuration",
        action: "create",
      };

      const data = {
        id: "artifact-code",
        messageId: "msg-code",
        type: ArtifactType.CODE,
        content: codeContent,
        icon: "Code" as const,
      };

      const result = createArtifact(data);

      expect(result.content).toEqual(codeContent);
      expect((result.content as CodeContent).content).toContain("API_KEY");
      expect((result.content as CodeContent).file).toBe("/src/config/secrets.js");
    });

    test("should handle browser content with URLs", () => {
      const browserContent: BrowserContent = {
        url: "https://admin.internal.com/dashboard?token=secret123",
      };

      const data = {
        id: "artifact-browser",
        messageId: "msg-browser",
        type: ArtifactType.BROWSER,
        content: browserContent,
      };

      const result = createArtifact(data);

      expect(result.content).toEqual(browserContent);
      expect((result.content as BrowserContent).url).toBe(
        "https://admin.internal.com/dashboard?token=secret123",
      );
    });

    test("should handle bug report content with sensitive debugging info", () => {
      const bugReportContent: BugReportContent = {
        bugDescription: "Authentication bypass in admin panel",
        iframeUrl: "https://internal-app.company.com/admin",
        method: "click",
        sourceFiles: [
          {
            file: "/src/auth/middleware.ts",
            lines: [42, 43, 44],
            context: "JWT token validation logic",
            message: "Bypassed authentication check",
            componentNames: [
              {
                name: "AuthMiddleware",
                level: 1,
                type: "function",
                element: "div.auth-wrapper",
              },
            ],
          },
        ],
        coordinates: { x: 100, y: 200, width: 50, height: 30 },
      };

      const data = {
        id: "artifact-bug",
        messageId: "msg-bug",
        type: ArtifactType.BUG_REPORT,
        content: bugReportContent,
      };

      const result = createArtifact(data);

      expect(result.content).toEqual(bugReportContent);
      const content = result.content as BugReportContent;
      expect(content.bugDescription).toContain("Authentication bypass");
      expect(content.iframeUrl).toBe("https://internal-app.company.com/admin");
      expect(content.sourceFiles[0].file).toBe("/src/auth/middleware.ts");
    });

    test("should handle longform content", () => {
      const longformContent: LongformContent = {
        text: "This is a detailed analysis containing sensitive business logic...",
        title: "Internal Security Analysis",
      };

      const data = {
        id: "artifact-longform",
        messageId: "msg-longform",
        type: ArtifactType.LONGFORM,
        content: longformContent,
      };

      const result = createArtifact(data);

      expect(result.content).toEqual(longformContent);
      expect((result.content as LongformContent).title).toBe(
        "Internal Security Analysis",
      );
    });

    test("should handle all artifact types", () => {
      const artifactTypes = [
        ArtifactType.CODE,
        ArtifactType.FORM,
        ArtifactType.BROWSER,
        ArtifactType.LONGFORM,
        ArtifactType.BUG_REPORT,
      ];

      artifactTypes.forEach((type) => {
        const data = {
          id: `artifact-${type.toLowerCase()}`,
          messageId: `msg-${type.toLowerCase()}`,
          type,
        };

        const result = createArtifact(data);

        expect(result.type).toBe(type);
        expect(result.id).toBe(`artifact-${type.toLowerCase()}`);
        expect(result.messageId).toBe(`msg-${type.toLowerCase()}`);
      });
    });

    test("should generate consistent timestamps", () => {
      const data = {
        id: "artifact-timestamp",
        messageId: "msg-timestamp",
        type: ArtifactType.CODE,
      };

      const result = createArtifact(data);

      expect(result.createdAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
      expect(result.updatedAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
    });

    test("should handle undefined and null content safely", () => {
      const data = {
        id: "artifact-empty",
        messageId: "msg-empty",
        type: ArtifactType.CODE,
        content: undefined,
        icon: undefined,
      };

      const result = createArtifact(data);

      expect(result.content).toBeUndefined();
      expect(result.icon).toBeNull();
    });

    test("should prevent prototype pollution in artifact content", () => {
      const maliciousContent = {
        content: "legitimate content",
        ["__proto__"]: { malicious: true },
        constructor: { prototype: { evil: "payload" } },
      } as any;

      const data = {
        id: "artifact-malicious",
        messageId: "msg-malicious",
        type: ArtifactType.CODE,
        content: maliciousContent,
      };

      const result = createArtifact(data);

      // Content should be preserved but without malicious prototype pollution
      expect(result.content).toEqual(maliciousContent);
      expect(result).not.toHaveProperty("malicious");
      expect(result.constructor.prototype).not.toHaveProperty("evil");
    });
  });

  describe("Integration Tests", () => {
    test("should create chat message with artifact containing sensitive data", () => {
      const sensitiveArtifact = createArtifact({
        id: "sensitive-artifact",
        messageId: "integration-msg",
        type: ArtifactType.CODE,
        content: {
          content: "const SECRET_KEY = process.env.SECRET_KEY;",
          language: "javascript",
          file: ".env.production",
        },
      });

      const chatMessage = createChatMessage({
        id: "integration-msg",
        message: "Here's the configuration with secrets",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        taskId: "sensitive-task-123",
        artifacts: [sensitiveArtifact],
      });

      expect(chatMessage.artifacts).toHaveLength(1);
      expect(chatMessage.artifacts?.[0].id).toBe("sensitive-artifact");
      expect(chatMessage.taskId).toBe("sensitive-task-123");
      
      const artifactContent = chatMessage.artifacts?.[0].content as CodeContent;
      expect(artifactContent.content).toContain("SECRET_KEY");
      expect(artifactContent.file).toBe(".env.production");
    });
  });
});

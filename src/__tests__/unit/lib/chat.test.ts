import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createChatMessage,
  createArtifact,
  ChatRole,
  ChatStatus,
  ArtifactType,
} from "@/lib/chat";

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
      const statuses = [
        ChatStatus.SENT,
        ChatStatus.PROCESSING,
        ChatStatus.ERROR,
        ChatStatus.CANCELLED,
      ];

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
    it("should create a basic artifact without content", () => {
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

    describe("CODE artifact", () => {
      it("should create artifact with full CODE content", () => {
        const codeContent = {
          content: "function test() { return true; }",
          language: "javascript",
          file: "test.js",
          change: "Added new function",
          action: "create",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
          content: codeContent,
        });

        expect(artifact.content).toEqual(codeContent);
        expect(artifact.type).toBe(ArtifactType.CODE);
      });

      it("should create CODE artifact with minimal content", () => {
        const codeContent = {
          content: "console.log('test')",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
          content: codeContent,
        });

        expect(artifact.content).toEqual(codeContent);
      });

      it("should handle CODE artifact with optional language field", () => {
        const codeContent = {
          content: "print('hello')",
          language: "python",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
          content: codeContent,
        });

        expect(artifact.content).toEqual(codeContent);
      });
    });

    describe("BROWSER artifact", () => {
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
        expect(artifact.type).toBe(ArtifactType.BROWSER);
      });

      it("should create BROWSER artifact with podId", () => {
        const browserContent = {
          url: "http://localhost:3000",
          podId: "pod-123",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.BROWSER,
          content: browserContent,
        });

        expect(artifact.content).toEqual(browserContent);
      });
    });

    describe("FORM artifact", () => {
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
        expect(artifact.type).toBe(ArtifactType.FORM);
      });

      it("should handle FORM with multiple options", () => {
        const formContent = {
          actionText: "Choose action",
          webhook: "https://api.example.com/action",
          options: [
            {
              actionType: "button" as const,
              optionLabel: "Yes",
              optionResponse: "User selected Yes",
            },
            {
              actionType: "chat" as const,
              optionLabel: "No",
              optionResponse: "User selected No",
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

      it("should handle FORM with chat actionType", () => {
        const formContent = {
          actionText: "Chat response",
          webhook: "https://api.example.com/chat",
          options: [
            {
              actionType: "chat" as const,
              optionLabel: "Send message",
              optionResponse: "Message sent",
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
    });

    describe("LONGFORM artifact", () => {
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
        expect(artifact.type).toBe(ArtifactType.LONGFORM);
      });

      it("should handle LONGFORM without title", () => {
        const longformContent = {
          text: "Text without title",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.LONGFORM,
          content: longformContent,
        });

        expect(artifact.content).toEqual(longformContent);
      });
    });

    describe("DIFF artifact", () => {
      it("should create artifact with DIFF content", () => {
        const diffContent = {
          diffs: [
            {
              file: "src/test.js",
              action: "modify" as const,
              content: "+console.log('test')\n-console.log('old')",
              repoName: "test-repo",
            },
          ],
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.DIFF,
          content: diffContent,
        });

        expect(artifact.content).toEqual(diffContent);
        expect(artifact.type).toBe(ArtifactType.DIFF);
      });

      it("should handle DIFF with multiple files", () => {
        const diffContent = {
          diffs: [
            {
              file: "src/file1.js",
              action: "create" as const,
              content: "+new content",
              repoName: "test-repo",
            },
            {
              file: "src/file2.js",
              action: "delete" as const,
              content: "-old content",
              repoName: "test-repo",
            },
            {
              file: "src/file3.js",
              action: "modify" as const,
              content: "+updated\n-old",
              repoName: "test-repo",
            },
            {
              file: "src/file4.js",
              action: "rewrite" as const,
              content: "completely new content",
              repoName: "test-repo",
            },
          ],
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.DIFF,
          content: diffContent,
        });

        expect(artifact.content).toEqual(diffContent);
      });
    });

    describe("PULL_REQUEST artifact", () => {
      it("should create artifact with PULL_REQUEST content", () => {
        const prContent = {
          repo: "owner/repo",
          url: "https://github.com/owner/repo/pull/123",
          status: "open",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.PULL_REQUEST,
          content: prContent,
        });

        expect(artifact.content).toEqual(prContent);
        expect(artifact.type).toBe(ArtifactType.PULL_REQUEST);
      });

      it("should handle PULL_REQUEST with different statuses", () => {
        const statuses = ["open", "closed", "merged", "draft"];

        statuses.forEach((status) => {
          const prContent = {
            repo: "owner/repo",
            url: `https://github.com/owner/repo/pull/${status}`,
            status,
          };

          const artifact = createArtifact({
            id: `artifact-${status}`,
            messageId: "msg-1",
            type: ArtifactType.PULL_REQUEST,
            content: prContent,
          });

          expect(artifact.content).toEqual(prContent);
        });
      });
    });

    describe("IDE artifact", () => {
      it("should create artifact with IDE content", () => {
        const ideContent = {
          url: "https://ide.example.com",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.IDE,
          content: ideContent,
        });

        expect(artifact.content).toEqual(ideContent);
        expect(artifact.type).toBe(ArtifactType.IDE);
      });

      it("should create IDE artifact with podId", () => {
        const ideContent = {
          url: "http://localhost:8080",
          podId: "pod-456",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.IDE,
          content: ideContent,
        });

        expect(artifact.content).toEqual(ideContent);
      });
    });

    describe("BUG_REPORT artifact", () => {
      it("should create artifact with BUG_REPORT content", () => {
        const bugContent = {
          bugDescription: "Button not clickable",
          iframeUrl: "https://app.example.com",
          method: "click" as const,
          sourceFiles: [
            {
              file: "src/components/Button.tsx",
              lines: [10, 11, 12],
            },
          ],
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.BUG_REPORT,
          content: bugContent,
        });

        expect(artifact.content).toEqual(bugContent);
        expect(artifact.type).toBe(ArtifactType.BUG_REPORT);
      });

      it("should handle BUG_REPORT with coordinates", () => {
        const bugContent = {
          bugDescription: "Element misaligned",
          iframeUrl: "https://app.example.com",
          method: "selection" as const,
          sourceFiles: [
            {
              file: "src/styles.css",
              lines: [20],
              context: "margin-top: 10px",
              message: "Incorrect margin",
            },
          ],
          coordinates: {
            x: 100,
            y: 200,
            width: 50,
            height: 30,
          },
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.BUG_REPORT,
          content: bugContent,
        });

        expect(artifact.content).toEqual(bugContent);
      });

      it("should handle BUG_REPORT with component names", () => {
        const bugContent = {
          bugDescription: "Component hierarchy issue",
          iframeUrl: "https://app.example.com",
          method: "click" as const,
          sourceFiles: [
            {
              file: "src/App.tsx",
              lines: [15, 16],
              componentNames: [
                {
                  name: "Button",
                  level: 1,
                  type: "component",
                  element: "button",
                },
                {
                  name: "Container",
                  level: 0,
                  type: "wrapper",
                  element: "div",
                },
              ],
            },
          ],
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.BUG_REPORT,
          content: bugContent,
        });

        expect(artifact.content).toEqual(bugContent);
      });
    });

    describe("GRAPH artifact", () => {
      it("should create artifact with GRAPH content", () => {
        const graphContent = {
          ref_id: "node-123",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.GRAPH,
          content: graphContent,
        });

        expect(artifact.content).toEqual(graphContent);
        expect(artifact.type).toBe(ArtifactType.GRAPH);
      });

      it("should create GRAPH artifact with depth", () => {
        const graphContent = {
          ref_id: "node-456",
          depth: 3,
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.GRAPH,
          content: graphContent,
        });

        expect(artifact.content).toEqual(graphContent);
      });

      it("should create GRAPH artifact with cluster_title", () => {
        const graphContent = {
          ref_id: "node-789",
          depth: 2,
          cluster_title: "Feature Cluster",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.GRAPH,
          content: graphContent,
        });

        expect(artifact.content).toEqual(graphContent);
      });
    });

    describe("WORKFLOW artifact", () => {
      it("should create artifact with WORKFLOW content (polling mode)", () => {
        const workflowContent = {
          projectId: "proj-123",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.WORKFLOW,
          content: workflowContent,
        });

        expect(artifact.content).toEqual(workflowContent);
        expect(artifact.type).toBe(ArtifactType.WORKFLOW);
      });

      it("should create WORKFLOW artifact with workflowJson", () => {
        const workflowContent = {
          workflowJson: '{"steps": [{"action": "test"}]}',
          workflowId: 456,
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.WORKFLOW,
          content: workflowContent,
        });

        expect(artifact.content).toEqual(workflowContent);
      });

      it("should create WORKFLOW artifact with all fields", () => {
        const workflowContent = {
          projectId: "proj-789",
          workflowJson: '{"workflow": "data"}',
          workflowId: 789,
          workflowName: "Test Workflow",
          workflowRefId: "wf-ref-123",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.WORKFLOW,
          content: workflowContent,
        });

        expect(artifact.content).toEqual(workflowContent);
      });
    });

    describe("MEDIA artifact", () => {
      it("should create artifact with MEDIA content (video)", () => {
        const mediaContent = {
          s3Key: "videos/test-video.webm",
          mediaType: "video" as const,
          filename: "test-video.webm",
          size: 1024000,
          contentType: "video/webm",
          uploadedAt: "2024-01-01T00:00:00Z",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.MEDIA,
          content: mediaContent,
        });

        expect(artifact.content).toEqual(mediaContent);
        expect(artifact.type).toBe(ArtifactType.MEDIA);
      });

      it("should create MEDIA artifact with audio", () => {
        const mediaContent = {
          s3Key: "audio/test-audio.mp3",
          mediaType: "audio" as const,
          filename: "test-audio.mp3",
          size: 512000,
          contentType: "audio/mpeg",
          uploadedAt: "2024-01-01T00:00:00Z",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.MEDIA,
          content: mediaContent,
        });

        expect(artifact.content).toEqual(mediaContent);
      });

      it("should create MEDIA artifact with duration and url", () => {
        const mediaContent = {
          url: "https://cdn.example.com/video.mp4",
          s3Key: "videos/video.mp4",
          mediaType: "video" as const,
          filename: "video.mp4",
          size: 2048000,
          contentType: "video/mp4",
          duration: 120.5,
          uploadedAt: "2024-01-01T00:00:00Z",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.MEDIA,
          content: mediaContent,
        });

        expect(artifact.content).toEqual(mediaContent);
      });

      it("should handle MEDIA with null duration", () => {
        const mediaContent = {
          s3Key: "audio/audio.ogg",
          mediaType: "audio" as const,
          filename: "audio.ogg",
          size: 256000,
          contentType: "audio/ogg",
          duration: null,
          uploadedAt: "2024-01-01T00:00:00Z",
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.MEDIA,
          content: mediaContent,
        });

        expect(artifact.content).toEqual(mediaContent);
      });
    });

    describe("PUBLISH_WORKFLOW artifact", () => {
      it("should create artifact with PUBLISH_WORKFLOW content", () => {
        const publishContent = {
          workflowId: 123,
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.PUBLISH_WORKFLOW,
          content: publishContent,
        });

        expect(artifact.content).toEqual(publishContent);
        expect(artifact.type).toBe(ArtifactType.PUBLISH_WORKFLOW);
      });

      it("should create PUBLISH_WORKFLOW with all fields", () => {
        const publishContent = {
          workflowId: 456,
          workflowName: "Production Workflow",
          workflowRefId: "wf-prod-123",
          published: true,
          publishedAt: "2024-01-01T12:00:00Z",
          workflowVersionId: 789,
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.PUBLISH_WORKFLOW,
          content: publishContent,
        });

        expect(artifact.content).toEqual(publishContent);
      });

      it("should handle PUBLISH_WORKFLOW with unpublished state", () => {
        const publishContent = {
          workflowId: 999,
          workflowName: "Draft Workflow",
          published: false,
        };

        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.PUBLISH_WORKFLOW,
          content: publishContent,
        });

        expect(artifact.content).toEqual(publishContent);
      });
    });

    describe("icon handling", () => {
      it("should create artifact with Code icon", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
          icon: "Code",
        });

        expect(artifact.icon).toBe("Code");
      });

      it("should create artifact with Agent icon", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.WORKFLOW,
          icon: "Agent",
        });

        expect(artifact.icon).toBe("Agent");
      });

      it("should create artifact with Call icon", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.FORM,
          icon: "Call",
        });

        expect(artifact.icon).toBe("Call");
      });

      it("should create artifact with Message icon", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.LONGFORM,
          icon: "Message",
        });

        expect(artifact.icon).toBe("Message");
      });

      it("should default icon to null when not provided", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
        });

        expect(artifact.icon).toBeNull();
      });
    });

    describe("all artifact types", () => {
      it("should handle all ArtifactType enum values", () => {
        const types = [
          ArtifactType.CODE,
          ArtifactType.BROWSER,
          ArtifactType.FORM,
          ArtifactType.LONGFORM,
          ArtifactType.DIFF,
          ArtifactType.PULL_REQUEST,
          ArtifactType.IDE,
          ArtifactType.BUG_REPORT,
          ArtifactType.GRAPH,
          ArtifactType.WORKFLOW,
          ArtifactType.MEDIA,
          ArtifactType.PUBLISH_WORKFLOW,
        ];

        types.forEach((type) => {
          const artifact = createArtifact({
            id: `artifact-${type}`,
            messageId: "msg-1",
            type,
          });
          expect(artifact.type).toBe(type);
          expect(artifact.id).toBe(`artifact-${type}`);
          expect(artifact.messageId).toBe("msg-1");
        });
      });
    });

    describe("timestamp handling", () => {
      it("should set createdAt and updatedAt to current time", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
        });

        expect(artifact.createdAt).toEqual(new Date("2024-01-01T00:00:00Z"));
        expect(artifact.updatedAt).toEqual(new Date("2024-01-01T00:00:00Z"));
      });

      it("should use the same timestamp for both fields", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
        });

        expect(artifact.createdAt.getTime()).toBe(artifact.updatedAt.getTime());
      });
    });

    describe("edge cases", () => {
      it("should handle artifact without content field", () => {
        const artifact = createArtifact({
          id: "artifact-1",
          messageId: "msg-1",
          type: ArtifactType.CODE,
        });

        expect(artifact.content).toBeUndefined();
      });

      it("should preserve all required fields", () => {
        const artifact = createArtifact({
          id: "test-id",
          messageId: "test-msg-id",
          type: ArtifactType.BROWSER,
        });

        expect(artifact).toHaveProperty("id");
        expect(artifact).toHaveProperty("messageId");
        expect(artifact).toHaveProperty("type");
        expect(artifact).toHaveProperty("content");
        expect(artifact).toHaveProperty("icon");
        expect(artifact).toHaveProperty("createdAt");
        expect(artifact).toHaveProperty("updatedAt");
      });
    });
  });
});

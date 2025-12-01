import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/mock/chat/route";
import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";
import { createTestUser, createTestWorkspace, createTestTask } from "@/__tests__/support/fixtures";
import { expectSuccess, expectError, createPostRequest } from "@/__tests__/support/helpers";

// Mock axios for callback interception
vi.mock("axios");
import axios from "axios";

describe("POST /api/mock Integration Tests", () => {
  const mockAxios = axios as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.post = vi.fn().mockResolvedValue({ data: { success: true } });
  });

  describe("Mock Response Generation", () => {
    test("should generate CODE response for 'code' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "write python code",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toContain("response will be generated shortly");
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/chat/response"),
        expect.objectContaining({
          taskId: task.id,
          message: expect.stringContaining("connection leak monitor"),
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.CODE,
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate FORM response for 'form' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "show me a form",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.FORM,
              content: expect.objectContaining({
                actionText: expect.any(String),
                webhook: expect.any(String),
                options: expect.any(Array),
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate BROWSER response for 'browser' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "show browser preview",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.BROWSER,
              content: expect.objectContaining({
                url: expect.stringContaining("localhost"),
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate LONGFORM response for 'longform' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "generate longform content",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.LONGFORM,
              content: expect.objectContaining({
                title: expect.any(String),
                text: expect.any(String),
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate BUG_REPORT response when artifacts contain BUG_REPORT with formatted message", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "analyze this bug",
        artifacts: [
          {
            type: "BUG_REPORT",
            content: {
              sourceFiles: [
                {
                  file: "test.ts",
                  message: "Debug analysis complete",
                  context: "Component error",
                },
              ],
            },
          },
        ],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining("Debug analysis complete"),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle BUG_REPORT without formatted message", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "analyze bug",
        artifacts: [
          {
            type: "BUG_REPORT",
            content: {
              sourceFiles: [
                {
                  file: "component.tsx",
                  context: "render error",
                },
              ],
            },
          },
        ],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining("Debug info"),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate chat FORM response for 'chat' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "chat with me",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.FORM,
              content: expect.objectContaining({
                options: expect.arrayContaining([
                  expect.objectContaining({
                    actionType: "chat",
                  }),
                ]),
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle confirmation keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "confirmed",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: "Ok! Let's move forward with this plan",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle modify keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "modify the plan",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: "What do you want to modify?",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate markdown response for 'markdown' keyword", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "show markdown example",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining("#"),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should generate default response for unmatched keywords", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "random message without keywords",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: "Autogenerated response.",
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should prioritize BUG_REPORT artifact over message keywords", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code browser form", // Has multiple keywords
        artifacts: [
          {
            type: "BUG_REPORT",
            content: {
              sourceFiles: [
                {
                  file: "test.ts",
                  message: "Bug analysis",
                },
              ],
            },
          },
        ],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining("Bug analysis"),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });
  });

  describe("Callback Integration", () => {
    test("should post response to /api/chat/response with correct payload structure", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "http://localhost:3000/api/chat/response",
        expect.objectContaining({
          taskId: task.id,
          message: expect.any(String),
          contextTags: expect.any(Array),
          sourceWebsocketID: null, // Mock implementation sets this to null
          artifacts: expect.any(Array),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should use https protocol for non-localhost hosts", async () => {
      const { workspace, task } = await createTestData();

      // Create request with custom host header
      const request = new Request("https://example.com/api/mock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "example.com",
        },
        body: JSON.stringify({
          taskId: task.id,
          message: "code",
          artifacts: [],
        }),
      });

      await POST(request as any);

      expect(mockAxios.post).toHaveBeenCalledWith(
        "https://example.com/api/chat/response",
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle callback errors gracefully", async () => {
      const { workspace, task } = await createTestData();

      mockAxios.post.mockRejectedValueOnce(new Error("Network error"));

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Should still return success even if callback fails
      expect(data.success).toBe(true);
      expect(data.message).toContain("response will be generated shortly");
    });

    test("should include contextTags in callback payload", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs.contextTags).toBeDefined();
      expect(Array.isArray(callArgs.contextTags)).toBe(true);
    });

    test("should include sourceWebsocketID in callback payload", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs.sourceWebsocketID).toBeDefined();
      // sourceWebsocketID is set to null in mock implementation
      expect(callArgs.sourceWebsocketID).toBe(null);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 for invalid JSON in request body", async () => {
      const request = new Request("http://localhost:3000/api/mock/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await POST(request as any);

      await expectError(response, "Failed to process message", 500);
    });

    test("should handle missing message field", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        artifacts: [],
        // message missing
      });

      const response = await POST(request);

      // Mock endpoint doesn't validate message presence, but generates response
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("should handle missing taskId field", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        message: "test message",
        artifacts: [],
        // taskId missing
      });

      const response = await POST(request);

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("should handle undefined artifacts array", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        // artifacts missing
      });

      const response = await POST(request);
      await expectSuccess(response);

      // Should still generate mock response
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.any(Array),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle empty artifacts array", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.any(Array),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should handle callback failure without throwing", async () => {
      const { workspace, task } = await createTestData();

      mockAxios.post.mockRejectedValueOnce(new Error("Callback failed"));

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      // Should not throw
      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });
  });

  describe("Environment-Based Activation", () => {
    test("should be callable without authentication (mock mode)", async () => {
      // Mock endpoint doesn't require authentication
      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: "test-task-id",
        message: "code",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    test("should work with MOCK_BROWSER_URL environment variable", async () => {
      const originalEnv = process.env.MOCK_BROWSER_URL;
      process.env.MOCK_BROWSER_URL = "https://custom-mock.com";

      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "browser",
        artifacts: [],
      });

      await POST(request);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              content: expect.objectContaining({
                url: "https://custom-mock.com",
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );

      // Restore original value
      if (originalEnv) {
        process.env.MOCK_BROWSER_URL = originalEnv;
      } else {
        delete process.env.MOCK_BROWSER_URL;
      }
    });

    test("should use localhost baseUrl when host header not present", async () => {
      const { workspace, task } = await createTestData();

      const request = new Request("http://localhost:3000/api/mock/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: task.id,
          message: "browser",
          artifacts: [],
        }),
      });

      await POST(request as any);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("localhost:3000"),
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });
  });

  describe("Artifact Mapping", () => {
    test("should map artifacts correctly from response to callback payload", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs.artifacts).toBeDefined();
      expect(Array.isArray(callArgs.artifacts)).toBe(true);
      expect(callArgs.artifacts[0]).toHaveProperty("type");
      expect(callArgs.artifacts[0]).toHaveProperty("content");
    });

    test("should preserve CODE artifact structure through callback", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      const codeArtifacts = callArgs.artifacts.filter((a: any) => a.type === ArtifactType.CODE);

      expect(codeArtifacts.length).toBeGreaterThan(0);
      expect(codeArtifacts[0].content).toHaveProperty("file");
      expect(codeArtifacts[0].content).toHaveProperty("content");
      expect(codeArtifacts[0].content).toHaveProperty("change");
      expect(codeArtifacts[0].content).toHaveProperty("action");
    });

    test("should preserve FORM artifact structure through callback", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "form",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      const formArtifact = callArgs.artifacts.find((a: any) => a.type === ArtifactType.FORM);

      expect(formArtifact).toBeDefined();
      expect(formArtifact.content).toHaveProperty("actionText");
      expect(formArtifact.content).toHaveProperty("webhook");
      expect(formArtifact.content).toHaveProperty("options");
      expect(Array.isArray(formArtifact.content.options)).toBe(true);
    });

    test("should preserve BROWSER artifact structure through callback", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "browser",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      const browserArtifact = callArgs.artifacts.find((a: any) => a.type === ArtifactType.BROWSER);

      expect(browserArtifact).toBeDefined();
      expect(browserArtifact.content).toHaveProperty("url");
      expect(typeof browserArtifact.content.url).toBe("string");
    });

    test("should preserve LONGFORM artifact structure through callback", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "longform",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      const longformArtifact = callArgs.artifacts.find((a: any) => a.type === ArtifactType.LONGFORM);

      expect(longformArtifact).toBeDefined();
      expect(longformArtifact.content).toHaveProperty("title");
      expect(longformArtifact.content).toHaveProperty("text");
    });

    test("should handle multiple artifacts in single response", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const callArgs = mockAxios.post.mock.calls[0][1];
      // CODE response generates 2 artifacts (Python and JSON)
      expect(callArgs.artifacts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Production Isolation", () => {
    test("should not modify task data in database", async () => {
      const { workspace, task } = await createTestData();

      // Get initial task state
      const initialTask = await db.task.findUnique({
        where: { id: task.id },
      });

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      // Verify task state unchanged
      const finalTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(finalTask).toEqual(initialTask);
    });

    test("should not create chat messages in database", async () => {
      const { workspace, task } = await createTestData();

      const initialMessageCount = await db.chatMessage.count({
        where: { taskId: task.id },
      });

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "code",
        artifacts: [],
      });

      await POST(request);

      const finalMessageCount = await db.chatMessage.count({
        where: { taskId: task.id },
      });

      // Mock endpoint should not create chat messages directly
      // (callback endpoint creates them, but that's mocked)
      expect(finalMessageCount).toBe(initialMessageCount);
    });

    test("should use force-no-store cache setting", async () => {
      // This is a module-level export that should be set
      const module = await import("@/app/api/mock/chat/route");
      expect(module.fetchCache).toBe("force-no-store");
    });

    test("should work with non-existent task IDs", async () => {
      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: "non-existent-task-id",
        message: "code",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Should still succeed even with non-existent task
      expect(data.success).toBe(true);
    });
  });

  describe("Keyword Matching Priority", () => {
    test("should check BUG_REPORT artifacts before keywords", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "browser code form",
        artifacts: [
          {
            type: "BUG_REPORT",
            content: { sourceFiles: [{ file: "test.ts", message: "Bug found" }] },
          },
        ],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining("Bug found"),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should match browser before other keywords", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "browser code form",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.BROWSER,
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should match code before form when both present", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "form code",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.CODE,
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });

    test("should be case-insensitive for keyword matching", async () => {
      const { workspace, task } = await createTestData();

      const request = createPostRequest("http://localhost:3000/api/mock/chat", {
        taskId: task.id,
        message: "BROWSER Preview",
        artifacts: [],
      });

      const response = await POST(request);
      await expectSuccess(response);

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: ArtifactType.BROWSER,
            }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": expect.any(String),
          }),
        }),
      );
    });
  });
});

// Helper function to create test data
async function createTestData() {
  const user = await createTestUser();
  const workspace = await createTestWorkspace({
    ownerId: user.id,
  });
  const task = await createTestTask({
    workspaceId: workspace.id,
    createdById: user.id,
  });

  return { user, workspace, task };
}

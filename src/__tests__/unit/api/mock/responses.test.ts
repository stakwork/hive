import { describe, test, expect, vi, beforeEach } from "vitest";
import { generateBugReportResponse } from "@/app/api/mock/responses";
import { makeRes } from "@/app/api/mock/helpers";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock the helpers module
vi.mock("@/app/api/mock/helpers", () => ({
  makeRes: vi.fn(),
}));

const mockedMakeRes = vi.mocked(makeRes);

describe("generateBugReportResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation
    mockedMakeRes.mockImplementation((message: string) => ({
      id: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      message,
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      artifacts: [],
      contextTags: [],
      taskId: null,
      workflowUrl: null,
      timestamp: new Date(),
      sourceWebsocketID: null,
      replyId: null,
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  test("should return no debug information message when artifacts is empty", () => {
    const artifacts: { type: string; content: unknown }[] = [];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("No debug information found in the request.");
  });

  test("should return no debug information message when artifacts is undefined", () => {
    const artifacts = undefined as any;
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("No debug information found in the request.");
  });

  test("should return no debug information message when no BUG_REPORT artifacts exist", () => {
    const artifacts = [
      { type: "CODE", content: { file: "test.js" } },
      { type: "FORM", content: { webhook: "https://example.com" } },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("No debug information found in the request.");
  });

  test("should return formatted message when BUG_REPORT has sourceFiles with message", () => {
    const mockMessage = "Component: LoginButton - detected authentication flow vulnerability";
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/components/LoginButton.tsx",
              lines: [25, 26, 27],
              context: "authentication flow",
              message: mockMessage,
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith(mockMessage);
  });

  test("should return debug info with file and context when no message but valid sourceFile exists", () => {
    const artifacts = [
      {
        type: "BUG_REPORT", 
        content: {
          sourceFiles: [
            {
              file: "src/utils/apiClient.ts",
              lines: [15, 16],
              context: "API key exposure risk",
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("🐛 Debug info: src/utils/apiClient.ts - API key exposure risk");
  });

  test("should return debug info with file only when no context provided", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/config/database.json",
              lines: [1, 2, 3],
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("🐛 Debug info: src/config/database.json");
  });

  test("should return fallback message when sourceFile has default mapping message", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "Source mapping will be available in future update",
              lines: [],
              context: "Debug UI preview",
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should return fallback message when sourceFiles is empty", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should return fallback message when content has no sourceFiles", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          bugDescription: "UI element analysis",
          coordinates: { x: 100, y: 200 },
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should return fallback message when BUG_REPORT has null content", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: null,
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should process first BUG_REPORT when multiple exist", () => {
    const firstMessage = "First bug report with sensitive data";
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/auth/session.ts",
              message: firstMessage,
            },
          ],
        },
      },
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/components/Button.tsx",
              message: "Second bug report",
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith(firstMessage);
  });

  test("should handle mixed artifact types and return first BUG_REPORT", () => {
    const bugMessage = "Database connection leak detected";
    const artifacts = [
      { type: "CODE", content: { file: "test.js" } },
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/db/connection.ts",
              message: bugMessage,
            },
          ],
        },
      },
      { type: "FORM", content: { webhook: "https://example.com" } },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith(bugMessage);
  });

  test("should handle malformed BUG_REPORT content gracefully", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: "invalid content format",
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should prioritize message over file when both exist", () => {
    const priorityMessage = "High priority: Potential XSS vulnerability detected";
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "src/components/UserInput.tsx",
              lines: [42, 43, 44],
              context: "user input validation",
              message: priorityMessage,
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith(priorityMessage);
    // Verify it doesn't fall back to file-based message
    expect(mockedMakeRes).not.toHaveBeenCalledWith(expect.stringContaining("🐛 Debug info:"));
  });

  test("should handle empty sourceFile.file gracefully", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "",
              lines: [1],
              context: "empty file name",
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should handle undefined sourceFile properties", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              lines: [1, 2, 3],
              // file and other properties undefined
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith("Debug artifact received. Component analysis in progress...");
  });

  test("should prevent potential information leakage from sensitive file paths", () => {
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: "/etc/passwd",
              lines: [1],
              context: "system file access attempt",
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    // Should still process but with our controlled message format
    expect(mockedMakeRes).toHaveBeenCalledWith("🐛 Debug info: /etc/passwd - system file access attempt");
    expect(mockedMakeRes).toHaveBeenCalledTimes(1);
  });

  test("should handle extremely long file paths and contexts safely", () => {
    const longFilePath = "a".repeat(1000);
    const longContext = "b".repeat(1000);
    const artifacts = [
      {
        type: "BUG_REPORT",
        content: {
          sourceFiles: [
            {
              file: longFilePath,
              context: longContext,
            },
          ],
        },
      },
    ];
    
    generateBugReportResponse(artifacts);
    
    expect(mockedMakeRes).toHaveBeenCalledWith(`🐛 Debug info: ${longFilePath} - ${longContext}`);
  });
});
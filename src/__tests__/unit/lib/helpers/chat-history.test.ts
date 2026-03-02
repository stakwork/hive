import { describe, test, expect, vi, beforeEach } from "vitest";
import { fetchChatHistory } from "@/lib/helpers/chat-history";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      findMany: vi.fn(),
    },
  },
}));

// Mock ArtifactType
vi.mock("@/lib/chat", () => ({
  ArtifactType: {
    LONGFORM: "LONGFORM",
  },
}));

describe("fetchChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should fetch all chat messages for a task when excludeMessageId is not provided", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Test message 1",
        role: "USER",
        status: "SENT",
        createdAt: new Date("2024-01-01"),
        contextTags: JSON.stringify([{ type: "file", value: "test.ts" }]),
        artifacts: [
          {
            id: "art-1",
            type: "LONGFORM",
            content: "console.log('test')",
            icon: null,
          },
        ],
        attachments: [
          {
            id: "att-1",
            filename: "test.pdf",
            path: "/uploads/test.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        ],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(db.chatMessage.findMany).toHaveBeenCalledWith({
      where: { taskId: "task-1" },
      include: {
        artifacts: {
          where: { type: "LONGFORM" },
        },
        attachments: true,
      },
      orderBy: { createdAt: "asc" },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "msg-1",
      message: "Test message 1",
      role: "USER",
      status: "SENT",
    });
  });

  test("should exclude a specific message when excludeMessageId is provided", async () => {
    const mockMessages = [
      {
        id: "msg-2",
        taskId: "task-1",
        message: "Test message 2",
        role: "ASSISTANT",
        status: "SENT",
        createdAt: new Date("2024-01-02"),
        contextTags: "[]",
        artifacts: [],
        attachments: [],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    await fetchChatHistory("task-1", "msg-1");

    expect(db.chatMessage.findMany).toHaveBeenCalledWith({
      where: {
        taskId: "task-1",
        id: { not: "msg-1" },
      },
      include: {
        artifacts: {
          where: { type: "LONGFORM" },
        },
        attachments: true,
      },
      orderBy: { createdAt: "asc" },
    });
  });

  test("should map artifacts correctly", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Message with artifacts",
        role: "ASSISTANT",
        status: "SENT",
        createdAt: new Date("2024-01-01"),
        contextTags: "[]",
        artifacts: [
          {
            id: "art-1",
            type: "LONGFORM",
            content: "const x = 1;",
            icon: "code",
          },
          {
            id: "art-2",
            type: "LONGFORM",
            content: "+line added",
            icon: "diff",
          },
        ],
        attachments: [],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(result[0].artifacts).toHaveLength(2);
    expect(result[0].artifacts[0]).toMatchObject({
      id: "art-1",
      type: "LONGFORM",
      content: "const x = 1;",
      icon: "code",
    });
    expect(result[0].artifacts[1]).toMatchObject({
      id: "art-2",
      type: "LONGFORM",
      content: "+line added",
      icon: "diff",
    });
  });

  test("should return empty array when no messages found", async () => {
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

    const result = await fetchChatHistory("task-999");

    expect(result).toEqual([]);
  });

  test("should handle messages without artifacts or attachments", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Simple message",
        role: "USER",
        status: "SENT",
        createdAt: new Date("2024-01-01"),
        contextTags: "[]",
        artifacts: [],
        attachments: null,
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(result[0].artifacts).toEqual([]);
    expect(result[0].attachments).toEqual([]);
  });

  test("should map attachments correctly", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Message with attachments",
        role: "USER",
        status: "SENT",
        createdAt: new Date("2024-01-01"),
        contextTags: "[]",
        artifacts: [],
        attachments: [
          {
            id: "att-1",
            filename: "doc.pdf",
            path: "/uploads/doc.pdf",
            mimeType: "application/pdf",
            size: 2048,
          },
          {
            id: "att-2",
            filename: "image.jpg",
            path: "/uploads/image.jpg",
            mimeType: "image/jpeg",
            size: 4096,
          },
        ],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(result[0].attachments).toHaveLength(2);
    expect(result[0].attachments[0]).toMatchObject({
      id: "att-1",
      filename: "doc.pdf",
      path: "/uploads/doc.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });
  });

  test("should parse contextTags from JSON string", async () => {
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Message with context",
        role: "USER",
        status: "SENT",
        createdAt: new Date("2024-01-01"),
        contextTags: JSON.stringify([
          { type: "file", value: "test.ts" },
          { type: "folder", value: "src/" },
        ]),
        artifacts: [],
        attachments: [],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(result[0].contextTags).toEqual([
      { type: "file", value: "test.ts" },
      { type: "folder", value: "src/" },
    ]);
  });

  test("should format timestamp as ISO string", async () => {
    const testDate = new Date("2024-01-15T10:30:00Z");
    const mockMessages = [
      {
        id: "msg-1",
        taskId: "task-1",
        message: "Test message",
        role: "USER",
        status: "SENT",
        createdAt: testDate,
        contextTags: "[]",
        artifacts: [],
        attachments: [],
      },
    ];

    vi.mocked(db.chatMessage.findMany).mockResolvedValue(mockMessages as any);

    const result = await fetchChatHistory("task-1");

    expect(result[0].timestamp).toBe(testDate.toISOString());
  });
});

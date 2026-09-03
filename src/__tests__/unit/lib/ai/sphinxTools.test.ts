/**
 * Unit tests for buildSphinxTools / send_sphinx_message.
 *
 * Mocks db, sendToSphinx, validateWorkspaceAccessById, checkRateLimit,
 * and EncryptionService. Does not pair with a real DB insert.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDecryptField } = vi.hoisted(() => ({
  mockDecryptField: vi.fn(() => "decrypted-bot-secret"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({ decryptField: mockDecryptField }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));

import { db } from "@/lib/db";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSphinxTools, SEND_SPHINX_MESSAGE_TOOL } from "@/lib/ai/sphinxTools";

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";
const WORKSPACE_SLUG = "hive";
const OTHER_WORKSPACE_ID = "ws-other";

const CONNECTED_WORKSPACE = {
  sphinxEnabled: true,
  sphinxChatPubkey: "chat-pubkey",
  sphinxBotId: "bot-id",
  sphinxBotSecret: "encrypted-secret",
};

type SendTool = {
  description: string;
  inputSchema: {
    safeParse: (v: unknown) => { success: boolean; error?: unknown };
    shape?: Record<string, unknown>;
  };
  execute: (args: { message: string }) => Promise<unknown>;
};

function getTool(): SendTool {
  const tools = buildSphinxTools({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    workspaceSlug: WORKSPACE_SLUG,
  });
  return tools[SEND_SPHINX_MESSAGE_TOOL] as unknown as SendTool;
}

describe("buildSphinxTools / send_sphinx_message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReturnValue("decrypted-bot-secret");
    (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(CONNECTED_WORKSPACE);
    (validateWorkspaceAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({
      canWrite: true,
    });
    (sendToSphinx as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      messageId: "msg-1",
    });
  });

  it("exposes only send_sphinx_message bound to the merge-time workspace", () => {
    const tools = buildSphinxTools({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
    });
    expect(Object.keys(tools)).toEqual([SEND_SPHINX_MESSAGE_TOOL]);
    const schema = getTool().inputSchema;
    expect(schema.shape).not.toHaveProperty("workspaceSlug");
    expect(schema.shape).not.toHaveProperty("workspaceId");
    expect(schema.safeParse({ message: "Hello tribe.", workspaceSlug: "other" }).success).toBe(
      true,
    );
  });

  it("sends on the bound connected workspace when the caller has canWrite", async () => {
    const result = await getTool().execute({ message: "The build is complete." });

    expect(checkRateLimit).toHaveBeenCalledWith(
      `send_sphinx_message:${USER_ID}:${WORKSPACE_ID}`,
      5,
      600,
    );
    expect(db.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_ID, deleted: false },
      }),
    );
    expect(validateWorkspaceAccessById).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID);
    expect(mockDecryptField).toHaveBeenCalledWith("sphinxBotSecret", "encrypted-secret");
    expect(sendToSphinx).toHaveBeenCalledWith(
      {
        chatPubkey: "chat-pubkey",
        botId: "bot-id",
        botSecret: "decrypted-bot-secret",
      },
      "The build is complete.",
      expect.any(AbortSignal),
    );
    expect(result).toEqual({ success: true, messageId: "msg-1" });
  });

  it("does not decrypt or send for VIEWER / canWrite: false", async () => {
    (validateWorkspaceAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({
      canWrite: false,
    });

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Workspace not found or not accessible" });
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("never uses a different workspace id than the one bound at merge time", async () => {
    await getTool().execute({ message: "Hello tribe." });

    expect(db.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_ID, deleted: false },
      }),
    );
    expect(validateWorkspaceAccessById).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID);
    expect(validateWorkspaceAccessById).not.toHaveBeenCalledWith(OTHER_WORKSPACE_ID, USER_ID);
  });

  it.each([
    ["sphinxEnabled", { ...CONNECTED_WORKSPACE, sphinxEnabled: false }],
    ["sphinxChatPubkey", { ...CONNECTED_WORKSPACE, sphinxChatPubkey: null }],
    ["sphinxBotId", { ...CONNECTED_WORKSPACE, sphinxBotId: null }],
    ["sphinxBotSecret", { ...CONNECTED_WORKSPACE, sphinxBotSecret: null }],
  ])("does not send when %s is missing", async (_field, row) => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Workspace not found or not accessible" });
    expect(validateWorkspaceAccessById).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID);
    expect(mockDecryptField).not.toHaveBeenCalled();
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("does not send when the bound workspace is missing", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Workspace not found or not accessible" });
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("rejects empty and whitespace-only messages in the schema", () => {
    const schema = getTool().inputSchema;
    expect(schema.safeParse({ message: "" }).success).toBe(false);
    expect(schema.safeParse({ message: "   " }).success).toBe(false);
    expect(schema.safeParse({ message: "Hello tribe." }).success).toBe(true);
  });

  it("rejects messages over 2000 characters", () => {
    const schema = getTool().inputSchema;
    expect(schema.safeParse({ message: "a".repeat(2000) }).success).toBe(true);
    expect(schema.safeParse({ message: "a".repeat(2001) }).success).toBe(false);
  });

  it("does not send when the rate limit is exceeded", async () => {
    (checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false });

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Failed to send Sphinx message" });
    expect(validateWorkspaceAccessById).not.toHaveBeenCalled();
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("catches decryptField throw and returns a generic error", async () => {
    mockDecryptField.mockImplementation(() => {
      throw new Error("Decryption key for keyId 'missing' not found");
    });

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Failed to send Sphinx message" });
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("maps sendToSphinx failure to a generic error without leaking the error string", async () => {
    (sendToSphinx as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Sphinx API error: 401 - bot_secret invalid",
      statusCode: 401,
    });

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Failed to send Sphinx message" });
    expect(JSON.stringify(result)).not.toContain("bot_secret");
    expect(JSON.stringify(result)).not.toContain("401");
  });

  it("maps timeout/abort to a generic error", async () => {
    (sendToSphinx as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "This operation was aborted",
    });

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Failed to send Sphinx message" });
  });

  it("maps unexpected execute exceptions to a generic error", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const result = await getTool().execute({ message: "Hello tribe." });

    expect(result).toEqual({ error: "Failed to send Sphinx message" });
    expect(sendToSphinx).not.toHaveBeenCalled();
  });

  it("describes ASD-STE100, current-workspace-only, and immediate send", () => {
    const { description } = getTool();
    expect(description).toMatch(/ASD-STE100/i);
    expect(description).toMatch(/current workspace/i);
    expect(description).toMatch(/immediately/i);
    expect(description).toMatch(/no draft/i);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { EncryptionService } from "@/lib/encryption";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";

vi.mock("@/lib/db");
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: any) => `decrypted-${value}`),
    })),
  },
}));
vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedLogger = vi.mocked(logger);
const mockedSendToSphinx = vi.mocked(sendToSphinx);

const sphinxWorkspace = {
  id: "ws-1",
  slug: "workspace-one",
  sphinxChatPubkey: "chat-pubkey-1",
  sphinxBotId: "bot-id-1",
  sphinxBotSecret: "encrypted-secret-1",
};

function makePrismaError(code: string) {
  const err = new Error("Unique constraint failed") as any;
  err.code = code;
  return err;
}

describe("handleAppBoot", () => {
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockedDb.appRelease as any) = { create: vi.fn() };
    (mockedDb.workspace as any) = { findMany: vi.fn() };
    mockedSendToSphinx.mockResolvedValue({ success: true, messageId: "msg-1" });
  });

  afterEach(() => {
    if (originalVersion === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    }
  });

  it("returns early when NEXT_PUBLIC_APP_VERSION is blank", async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;

    const { handleAppBoot } = await import("@/lib/app-release");
    await handleAppBoot();

    expect(mockedDb.appRelease.create).not.toHaveBeenCalled();
    expect(mockedDb.workspace.findMany).not.toHaveBeenCalled();
    expect(mockedSendToSphinx).not.toHaveBeenCalled();
    expect(mockedLogger.info).not.toHaveBeenCalled();
  });

  it("returns early silently when version is already recorded (P2002)", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.0.0";
    (mockedDb.appRelease.create as any).mockRejectedValue(makePrismaError("P2002"));

    const { handleAppBoot } = await import("@/lib/app-release");
    await handleAppBoot();

    expect(mockedDb.appRelease.create).toHaveBeenCalledOnce();
    expect(mockedDb.workspace.findMany).not.toHaveBeenCalled();
    expect(mockedSendToSphinx).not.toHaveBeenCalled();
    expect(mockedLogger.info).not.toHaveBeenCalled();
    // Should NOT throw
  });

  it("logs and returns early on unexpected DB error", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v1.0.0";
    const dbError = new Error("Connection refused");
    (mockedDb.appRelease.create as any).mockRejectedValue(dbError);

    const { handleAppBoot } = await import("@/lib/app-release");
    await handleAppBoot();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      "[APP BOOT] Failed to write AppRelease record",
      "APP_RELEASE",
      { error: dbError }
    );
    expect(mockedDb.workspace.findMany).not.toHaveBeenCalled();
    expect(mockedSendToSphinx).not.toHaveBeenCalled();
  });

  it("announces new version: logs and sends to sphinx-enabled workspaces", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v2.0.0";
    (mockedDb.appRelease.create as any).mockResolvedValue({});
    (mockedDb.workspace.findMany as any).mockResolvedValue([sphinxWorkspace]);

    const { handleAppBoot } = await import("@/lib/app-release");
    await handleAppBoot();

    expect(mockedDb.appRelease.create).toHaveBeenCalledWith({
      data: { version: "v2.0.0", bootedAt: expect.any(Date) },
    });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      "[APP BOOT] New release detected",
      "APP_RELEASE",
      expect.objectContaining({ version: "v2.0.0", bootedAt: expect.any(Date) })
    );

    expect(mockedSendToSphinx).toHaveBeenCalledOnce();
    expect(mockedSendToSphinx).toHaveBeenCalledWith(
      {
        chatPubkey: sphinxWorkspace.sphinxChatPubkey,
        botId: sphinxWorkspace.sphinxBotId,
        botSecret: `decrypted-${sphinxWorkspace.sphinxBotSecret}`,
      },
      "🚀 Hive v2.0.0 is live on production!"
    );
  });

  it("skips failed workspace broadcast gracefully and continues to next", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v3.0.0";
    (mockedDb.appRelease.create as any).mockResolvedValue({});

    const ws2 = { ...sphinxWorkspace, id: "ws-2", slug: "workspace-two", sphinxBotSecret: "encrypted-secret-2" };
    (mockedDb.workspace.findMany as any).mockResolvedValue([sphinxWorkspace, ws2]);

    // First workspace send fails, second succeeds
    mockedSendToSphinx
      .mockResolvedValueOnce({ success: false, error: "Sphinx unreachable" })
      .mockResolvedValueOnce({ success: true, messageId: "msg-2" });

    const { handleAppBoot } = await import("@/lib/app-release");
    await expect(handleAppBoot()).resolves.toBeUndefined();

    expect(mockedSendToSphinx).toHaveBeenCalledTimes(2);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      `[APP BOOT] Failed to send release broadcast to workspace: ${sphinxWorkspace.slug}`,
      "APP_RELEASE",
      { error: "Sphinx unreachable" }
    );
  });

  it("skips workspace that throws during broadcast and continues to next", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v4.0.0";
    (mockedDb.appRelease.create as any).mockResolvedValue({});

    const ws2 = { ...sphinxWorkspace, id: "ws-2", slug: "workspace-two", sphinxBotSecret: "encrypted-secret-2" };
    (mockedDb.workspace.findMany as any).mockResolvedValue([sphinxWorkspace, ws2]);

    const sendError = new Error("Network timeout");
    mockedSendToSphinx
      .mockRejectedValueOnce(sendError)
      .mockResolvedValueOnce({ success: true, messageId: "msg-3" });

    const { handleAppBoot } = await import("@/lib/app-release");
    await expect(handleAppBoot()).resolves.toBeUndefined();

    expect(mockedSendToSphinx).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      `[APP BOOT] Error broadcasting to workspace: ${sphinxWorkspace.slug}`,
      "APP_RELEASE",
      { error: sendError }
    );
  });
});

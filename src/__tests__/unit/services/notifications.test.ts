import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  NotificationMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";

vi.mock("@/lib/db");
vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn(),
}));
const mockDecryptField = vi.fn(() => "decrypted-secret");
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const mockedSendToSphinx = vi.mocked(sendToSphinx);

// Shared mock fns — reassigned fresh in beforeEach
let findFirst: ReturnType<typeof vi.fn>;
let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let workspaceFindUnique: ReturnType<typeof vi.fn>;
let userFindUnique: ReturnType<typeof vi.fn>;

const baseInput = {
  targetUserId: "user-1",
  workspaceId: "ws-1",
  notificationType: NotificationTriggerType.TASK_ASSIGNED,
  message:
    "@alice — You have been assigned to task 'Fix bug': http://localhost/w/test/task/task-1",
};

const configuredWorkspace = {
  sphinxEnabled: true,
  sphinxBotId: "bot-id",
  sphinxBotSecret:
    '{"data":"enc","iv":"iv","tag":"tag","keyId":"k1","version":1,"encryptedAt":"2024-01-01"}',
  sphinxChatPubkey: "chat-pubkey",
};

const userWithAlias = { sphinxAlias: "alice" };
const userWithoutAlias = { sphinxAlias: null };

const mockRecord = {
  id: "notif-1",
  targetUserId: "user-1",
  originatingUserId: null,
  taskId: null,
  featureId: null,
  notificationType: NotificationTriggerType.TASK_ASSIGNED,
  status: NotificationTriggerStatus.PENDING,
  notificationMethod: NotificationMethod.SPHINX,
  notificationTimestamps: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Import AFTER mocks are hoisted
import { createAndSendNotification } from "@/services/notifications";

describe("createAndSendNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findFirst = vi.fn();
    create = vi.fn();
    update = vi.fn();
    workspaceFindUnique = vi.fn();
    userFindUnique = vi.fn();

    Object.assign(db, {
      notificationTrigger: { findFirst, create, update },
      workspace: { findUnique: workspaceFindUnique },
      user: { findUnique: userFindUnique },
    });
  });

  describe("idempotency", () => {
    it("returns early without creating a record when a PENDING record already exists", async () => {
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      findFirst.mockResolvedValue(mockRecord);

      await createAndSendNotification(baseInput);

      expect(create).not.toHaveBeenCalled();
      expect(mockedSendToSphinx).not.toHaveBeenCalled();
    });

    it("uses explicit null for taskId and featureId in the idempotency query", async () => {
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      findFirst.mockResolvedValue(mockRecord);

      await createAndSendNotification({
        ...baseInput,
        taskId: undefined,
        featureId: undefined,
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ taskId: null, featureId: null }),
      });
    });
  });

  describe("Sphinx not configured — workspace", () => {
    it("inserts a SKIPPED row and does not send when Sphinx is disabled", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });
      workspaceFindUnique.mockResolvedValue({
        sphinxEnabled: false,
        sphinxBotId: null,
        sphinxBotSecret: null,
        sphinxChatPubkey: null,
      });
      userFindUnique.mockResolvedValue(userWithAlias);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SKIPPED }),
        })
      );
      expect(mockedSendToSphinx).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("inserts a SKIPPED row and does not send when Sphinx credentials are missing", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });
      workspaceFindUnique.mockResolvedValue({
        sphinxEnabled: true,
        sphinxBotId: null,
        sphinxBotSecret: null,
        sphinxChatPubkey: null,
      });
      userFindUnique.mockResolvedValue(userWithAlias);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SKIPPED }),
        })
      );
      expect(mockedSendToSphinx).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("Sphinx not configured — user has no sphinxAlias", () => {
    it("inserts a SKIPPED row and does not send when user has no sphinxAlias", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithoutAlias);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SKIPPED }),
        })
      );
      expect(mockedSendToSphinx).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("send success", () => {
    it("creates record, calls sendToSphinx, and updates record to SENT with timestamp", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      mockedSendToSphinx.mockResolvedValue({ success: true, messageId: "msg-1" });
      update.mockResolvedValue({
        ...mockRecord,
        status: NotificationTriggerStatus.SENT,
      });

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledOnce();
      expect(mockedSendToSphinx).toHaveBeenCalledOnce();
      expect(mockedSendToSphinx).toHaveBeenCalledWith(
        expect.objectContaining({
          botId: "bot-id",
          chatPubkey: "chat-pubkey",
          botSecret: "decrypted-secret",
        }),
        baseInput.message
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-1" },
          data: expect.objectContaining({
            status: NotificationTriggerStatus.SENT,
            notificationTimestamps: { push: expect.any(Date) },
          }),
        })
      );
    });

    it("decrypts sphinxBotSecret before sending", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      mockedSendToSphinx.mockResolvedValue({ success: true });
      update.mockResolvedValue(mockRecord);

      await createAndSendNotification(baseInput);

      expect(mockDecryptField).toHaveBeenCalledWith(
        "sphinxBotSecret",
        configuredWorkspace.sphinxBotSecret
      );
    });
  });

  describe("send failure", () => {
    it("updates record to FAILED with timestamp when sendToSphinx returns success: false", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      mockedSendToSphinx.mockResolvedValue({ success: false, error: "timeout" });
      update.mockResolvedValue({
        ...mockRecord,
        status: NotificationTriggerStatus.FAILED,
      });

      await createAndSendNotification(baseInput);

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotificationTriggerStatus.FAILED,
            notificationTimestamps: { push: expect.any(Date) },
          }),
        })
      );
    });
  });

  describe("never throws", () => {
    it("resolves without throwing even when db.notificationTrigger.findFirst throws", async () => {
      findFirst.mockRejectedValue(new Error("DB connection failed"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when db.notificationTrigger.create throws", async () => {
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      findFirst.mockResolvedValue(null);
      create.mockRejectedValue(new Error("constraint violation"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when db.notificationTrigger.create throws (Sphinx disabled)", async () => {
      workspaceFindUnique.mockResolvedValue({
        sphinxEnabled: false,
        sphinxBotId: null,
        sphinxBotSecret: null,
        sphinxChatPubkey: null,
      });
      userFindUnique.mockResolvedValue(userWithAlias);
      findFirst.mockResolvedValue(null);
      create.mockRejectedValue(new Error("constraint violation"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when sendToSphinx throws", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      workspaceFindUnique.mockResolvedValue(configuredWorkspace);
      userFindUnique.mockResolvedValue(userWithAlias);
      mockedSendToSphinx.mockRejectedValue(new Error("network error"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });
  });
});

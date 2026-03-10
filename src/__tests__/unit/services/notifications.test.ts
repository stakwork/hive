import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  NotificationMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { sendDirectMessage, isDirectMessageConfigured } from "@/lib/sphinx/direct-message";
import { sendHubPushNotification } from "@/lib/hub/push-notification";

vi.mock("@/lib/db");
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn(),
  isDirectMessageConfigured: vi.fn(),
}));
vi.mock("@/lib/hub/push-notification", () => ({
  sendHubPushNotification: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const mockedSendDirectMessage = vi.mocked(sendDirectMessage);
const mockedIsDirectMessageConfigured = vi.mocked(isDirectMessageConfigured);
const mockedSendHubPushNotification = vi.mocked(sendHubPushNotification);

// Shared mock fns — reassigned fresh in beforeEach
let findFirst: ReturnType<typeof vi.fn>;
let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let userFindUnique: ReturnType<typeof vi.fn>;
let workspaceFindUnique: ReturnType<typeof vi.fn>;

const baseInput = {
  targetUserId: "user-1",
  workspaceId: "ws-1",
  notificationType: NotificationTriggerType.TASK_ASSIGNED,
  message:
    "@alice — You have been assigned to task 'Fix bug': http://localhost/w/test/task/task-1",
};

const userWithPubkey = { lightningPubkey: "alice-pubkey", sphinxRouteHint: null, iosDeviceToken: null };
const userWithPubkeyAndToken = { lightningPubkey: "alice-pubkey", sphinxRouteHint: null, iosDeviceToken: "device-token-abc" };
const userWithoutPubkey = { lightningPubkey: null, sphinxRouteHint: null, iosDeviceToken: null };
const mockWorkspace = { slug: "test-workspace" };

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
    userFindUnique = vi.fn();
    workspaceFindUnique = vi.fn();

    Object.assign(db, {
      notificationTrigger: { findFirst, create, update },
      user: { findUnique: userFindUnique },
      workspace: { findUnique: workspaceFindUnique },
    });

    mockedIsDirectMessageConfigured.mockReturnValue(true);
    mockedSendHubPushNotification.mockResolvedValue({ success: true });
    workspaceFindUnique.mockResolvedValue(mockWorkspace);
  });

  describe("idempotency", () => {
    it("returns early without creating a record when a PENDING record already exists", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue(mockRecord);

      await createAndSendNotification(baseInput);

      expect(create).not.toHaveBeenCalled();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("uses explicit null for taskId and featureId in the idempotency query", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
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

  describe("DM not configured — isDirectMessageConfigured returns false", () => {
    it("inserts a SKIPPED row and does not send when DM is not configured", async () => {
      mockedIsDirectMessageConfigured.mockReturnValue(false);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });
      userFindUnique.mockResolvedValue(userWithPubkey);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SKIPPED }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("DM not configured — user has no lightningPubkey", () => {
    it("inserts a SKIPPED row and does not send when user has no lightningPubkey", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });
      userFindUnique.mockResolvedValue(userWithoutPubkey);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SKIPPED }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("deferred types (e.g. TASK_ASSIGNED)", () => {
    it("creates record with sendAfter + message and does NOT call sendDirectMessage", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      userFindUnique.mockResolvedValue(userWithPubkey);
      update.mockResolvedValue({ ...mockRecord });

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledOnce();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-1" },
          data: expect.objectContaining({
            sendAfter: expect.any(Date),
            message: baseInput.message,
          }),
        })
      );
    });
  });

  describe("send success (immediate type — TASK_PR_MERGED)", () => {
    it("creates record, calls sendDirectMessage, and updates record to SENT with timestamp", async () => {
      const immediateInput = { ...baseInput, notificationType: NotificationTriggerType.TASK_PR_MERGED };
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, notificationType: NotificationTriggerType.TASK_PR_MERGED });
      userFindUnique.mockResolvedValue(userWithPubkey);
      mockedSendDirectMessage.mockResolvedValue({ success: true });
      update.mockResolvedValue({
        ...mockRecord,
        status: NotificationTriggerStatus.SENT,
      });

      await createAndSendNotification(immediateInput);

      expect(create).toHaveBeenCalledOnce();
      expect(mockedSendDirectMessage).toHaveBeenCalledOnce();
      expect(mockedSendDirectMessage).toHaveBeenCalledWith("alice-pubkey", immediateInput.message, {
        routeHint: undefined,
      });
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
  });

  describe("send failure (immediate type — TASK_PR_MERGED)", () => {
    it("updates record to FAILED with timestamp when sendDirectMessage returns success: false", async () => {
      const immediateInput = { ...baseInput, notificationType: NotificationTriggerType.TASK_PR_MERGED };
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, notificationType: NotificationTriggerType.TASK_PR_MERGED });
      userFindUnique.mockResolvedValue(userWithPubkey);
      mockedSendDirectMessage.mockResolvedValue({ success: false, error: "timeout" });
      update.mockResolvedValue({
        ...mockRecord,
        status: NotificationTriggerStatus.FAILED,
      });

      await createAndSendNotification(immediateInput);

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
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockRejectedValue(new Error("DB connection failed"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when db.notificationTrigger.create throws", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue(null);
      create.mockRejectedValue(new Error("constraint violation"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when db.notificationTrigger.create throws (DM disabled)", async () => {
      mockedIsDirectMessageConfigured.mockReturnValue(false);
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue(null);
      create.mockRejectedValue(new Error("constraint violation"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });

    it("resolves without throwing even when sendDirectMessage throws", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      userFindUnique.mockResolvedValue(userWithPubkey);
      mockedSendDirectMessage.mockRejectedValue(new Error("network error"));

      await expect(createAndSendNotification(baseInput)).resolves.toBeUndefined();
    });
  });

  describe("HUB push — immediate send path", () => {
    const immediateInput = { ...baseInput, notificationType: NotificationTriggerType.TASK_PR_MERGED, taskId: "task-1" };

    it("fires HUB push when iosDeviceToken is set on an immediate send", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, notificationType: NotificationTriggerType.TASK_PR_MERGED });
      userFindUnique.mockResolvedValue(userWithPubkeyAndToken);
      mockedSendDirectMessage.mockResolvedValue({ success: true });
      update.mockResolvedValue({});

      await createAndSendNotification(immediateInput);

      expect(mockedSendHubPushNotification).toHaveBeenCalledOnce();
      expect(mockedSendHubPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceToken: "device-token-abc",
          message: immediateInput.message,
          workspaceSlug: "test-workspace",
          taskId: "task-1",
        })
      );
    });

    it("does NOT fire HUB push when iosDeviceToken is absent", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, notificationType: NotificationTriggerType.TASK_PR_MERGED });
      userFindUnique.mockResolvedValue(userWithPubkey); // no iosDeviceToken
      mockedSendDirectMessage.mockResolvedValue({ success: true });
      update.mockResolvedValue({});

      await createAndSendNotification(immediateInput);

      expect(mockedSendHubPushNotification).not.toHaveBeenCalled();
    });

    it("does NOT fire HUB push on the deferred path (TASK_ASSIGNED)", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      userFindUnique.mockResolvedValue(userWithPubkeyAndToken);
      update.mockResolvedValue({});

      // baseInput uses TASK_ASSIGNED which is deferred
      await createAndSendNotification({ ...baseInput, taskId: "task-1" });

      expect(mockedSendHubPushNotification).not.toHaveBeenCalled();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("still completes successfully even if HUB push fails", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue({ ...mockRecord, notificationType: NotificationTriggerType.TASK_PR_MERGED });
      userFindUnique.mockResolvedValue(userWithPubkeyAndToken);
      mockedSendDirectMessage.mockResolvedValue({ success: true });
      mockedSendHubPushNotification.mockResolvedValue({ success: false, error: "hub down" });
      update.mockResolvedValue({});

      await expect(createAndSendNotification(immediateInput)).resolves.toBeUndefined();
      // DM status update should still happen
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SENT }),
        })
      );
    });
  });
});

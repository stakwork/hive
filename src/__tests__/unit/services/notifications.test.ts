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
  buildPushMessage: vi.fn((msg: string) => msg),
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
let presenceFindUnique: ReturnType<typeof vi.fn>;

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
const mockWorkspace = { slug: "test-workspace", sphinxEnabled: true };

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
    presenceFindUnique = vi.fn().mockResolvedValue(null); // default: no presence row

    Object.assign(db, {
      notificationTrigger: { findFirst, create, update },
      user: { findUnique: userFindUnique },
      workspace: { findUnique: workspaceFindUnique },
      userFeaturePresence: { findUnique: presenceFindUnique },
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

    it("returns early without creating a record when a FAILED record already exists", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.FAILED });

      await createAndSendNotification(baseInput);

      expect(create).not.toHaveBeenCalled();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("queries with status in [PENDING, FAILED] for the idempotency check", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification(baseInput);

      expect(findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: { in: [NotificationTriggerStatus.PENDING, NotificationTriggerStatus.FAILED] },
        }),
      });
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
    it("creates record with sendAfter + message atomically and does NOT call sendDirectMessage", async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      userFindUnique.mockResolvedValue(userWithPubkey);

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotificationTriggerStatus.PENDING,
            sendAfter: expect.any(Date),
            message: baseInput.message,
          }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
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
          // buildPushMessage is mocked as pass-through; real stripping is tested in unit/lib/hub/push-notification.test.ts
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

  describe("notification preference gate", () => {
    it("creates a SKIPPED record and does not send when the type is disabled in user preferences", async () => {
      userFindUnique.mockResolvedValue({
        ...userWithPubkey,
        notificationPreferences: { TASK_ASSIGNED: false },
      });
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SKIPPED });

      await createAndSendNotification(baseInput);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotificationTriggerStatus.SKIPPED,
            notificationType: NotificationTriggerType.TASK_ASSIGNED,
          }),
        })
      );
      // The idempotency check must NOT have run (findFirst not called)
      expect(findFirst).not.toHaveBeenCalled();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("sends normally when notificationPreferences is null (backward-compat)", async () => {
      userFindUnique.mockResolvedValue({
        ...userWithPubkey,
        notificationPreferences: null,
      });
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification(baseInput);

      // Preference gate should NOT have fired — idempotency check should have run
      expect(findFirst).toHaveBeenCalled();
    });

    it("sends normally when notificationPreferences is an empty object", async () => {
      userFindUnique.mockResolvedValue({
        ...userWithPubkey,
        notificationPreferences: {},
      });
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification(baseInput);

      expect(findFirst).toHaveBeenCalled();
    });

    it("sends normally when only a different type is disabled", async () => {
      userFindUnique.mockResolvedValue({
        ...userWithPubkey,
        notificationPreferences: { FEATURE_ASSIGNED: false },
      });
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      // baseInput is TASK_ASSIGNED — FEATURE_ASSIGNED being disabled should not affect it
      await createAndSendNotification(baseInput);

      expect(findFirst).toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.PENDING }),
        })
      );
    });
  });

  describe("self-assignment suppression", () => {
    it("suppresses TASK_ASSIGNED when originatingUserId === targetUserId", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SUPPRESSED });

      await createAndSendNotification({
        ...baseInput,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,
        originatingUserId: baseInput.targetUserId, // self-assign
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SUPPRESSED }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      // Should not proceed to preference gate or idempotency check
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("suppresses FEATURE_ASSIGNED when originatingUserId === targetUserId", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SUPPRESSED });

      await createAndSendNotification({
        ...baseInput,
        notificationType: NotificationTriggerType.FEATURE_ASSIGNED,
        originatingUserId: baseInput.targetUserId,
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SUPPRESSED }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("does NOT suppress when originator differs from target (normal assignment)", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      workspaceFindUnique.mockResolvedValue(mockWorkspace);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification({
        ...baseInput,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,
        originatingUserId: "other-user-id",
      });

      // Should reach the idempotency check
      expect(findFirst).toHaveBeenCalled();
    });

    it("does NOT suppress when originatingUserId is absent (system-generated)", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      workspaceFindUnique.mockResolvedValue(mockWorkspace);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification({
        ...baseInput,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,
        // no originatingUserId
      });

      expect(findFirst).toHaveBeenCalled();
    });
  });

  describe("presence suppression", () => {
    const featureInput = {
      ...baseInput,
      featureId: "feature-1",
      notificationType: NotificationTriggerType.PLAN_AWAITING_APPROVAL,
    };

    it("writes SUPPRESSED record and returns early when user lastSeenAt is within 5 minutes", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      presenceFindUnique.mockResolvedValue({
        lastSeenAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago — within window
      });
      create.mockResolvedValue({ ...mockRecord, status: NotificationTriggerStatus.SUPPRESSED });

      await createAndSendNotification(featureInput);

      expect(presenceFindUnique).toHaveBeenCalledWith({
        where: { userId_featureId: { userId: baseInput.targetUserId, featureId: "feature-1" } },
        select: { lastSeenAt: true },
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SUPPRESSED }),
        })
      );
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled(); // short-circuits before idempotency
    });

    it("falls through normally when lastSeenAt is stale (> 5 minutes)", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      presenceFindUnique.mockResolvedValue({
        lastSeenAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago — stale
      });
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification(featureInput);

      // Should proceed past the presence check
      expect(findFirst).toHaveBeenCalled();
    });

    it("falls through normally when there is no presence row", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      presenceFindUnique.mockResolvedValue(null);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      await createAndSendNotification(featureInput);

      expect(findFirst).toHaveBeenCalled();
    });

    it("skips presence check entirely when featureId is null", async () => {
      userFindUnique.mockResolvedValue(userWithPubkey);
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(mockRecord);
      update.mockResolvedValue({});

      // baseInput has no featureId
      await createAndSendNotification(baseInput);

      expect(presenceFindUnique).not.toHaveBeenCalled();
      expect(findFirst).toHaveBeenCalled();
    });
  });
});

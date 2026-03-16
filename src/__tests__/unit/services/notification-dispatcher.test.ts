import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotificationTriggerType,
  NotificationTriggerStatus,
  TaskStatus,
  WorkflowStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { sendDirectMessage } from "@/lib/sphinx/direct-message";
import { sendHubPushNotification } from "@/lib/hub/push-notification";

vi.mock("@/lib/db");
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn(),
}));
vi.mock("@/lib/hub/push-notification", () => ({
  sendHubPushNotification: vi.fn(),
  buildPushMessage: vi.fn((msg: string) => msg),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { dispatchPendingNotifications } from "@/services/notification-dispatcher";

const mockedSendDirectMessage = vi.mocked(sendDirectMessage);
const mockedSendHubPushNotification = vi.mocked(sendHubPushNotification);

// Shared db mock fns
let triggerFindMany: ReturnType<typeof vi.fn>;
let triggerUpdate: ReturnType<typeof vi.fn>;
let taskFindUnique: ReturnType<typeof vi.fn>;
let featureFindUnique: ReturnType<typeof vi.fn>;
let queryRaw: ReturnType<typeof vi.fn>;
let transaction: ReturnType<typeof vi.fn>;

// Base record for an active task-linked TASK_ASSIGNED notification
function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "record-1",
    notificationType: NotificationTriggerType.TASK_ASSIGNED,
    taskId: "task-1",
    featureId: null,
    message: "You have been assigned a task",
    targetUser: {
      lightningPubkey: "pubkey-abc",
      sphinxRouteHint: null,
      iosDeviceToken: null,
    },
    task: { workspace: { slug: "my-workspace" } },
    feature: null,
    ...overrides,
  };
}

describe("dispatchPendingNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    triggerFindMany = vi.fn();
    triggerUpdate = vi.fn().mockResolvedValue({});
    taskFindUnique = vi.fn();
    featureFindUnique = vi.fn();
    queryRaw = vi.fn();

    // No longer used — kept for type compatibility; code now calls db.$queryRaw directly
    transaction = vi.fn();

    Object.assign(db, {
      $transaction: transaction,
      $queryRaw: queryRaw,
      notificationTrigger: { findMany: triggerFindMany, update: triggerUpdate },
      task: { findUnique: taskFindUnique },
      feature: { findUnique: featureFindUnique },
    });

    // Default: $queryRaw returns one claimed ID, findMany returns the matching record
    queryRaw.mockResolvedValue([{ id: "record-1" }]);
    triggerFindMany.mockResolvedValue([makeRecord()]);

    // Default: task is still IN_PROGRESS → not cancelled
    taskFindUnique.mockResolvedValue({ status: TaskStatus.IN_PROGRESS });
    mockedSendDirectMessage.mockResolvedValue({ success: true });
    mockedSendHubPushNotification.mockResolvedValue({ success: true });
  });

  describe("atomic claim — SELECT FOR UPDATE SKIP LOCKED", () => {
    it("returns zeros when $queryRaw returns an empty array (all rows locked)", async () => {
      queryRaw.mockResolvedValue([]);

      const result = await dispatchPendingNotifications();

      expect(result.dispatched).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
      // findMany should not be called when no IDs were claimed
      expect(triggerFindMany).not.toHaveBeenCalled();
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
    });

    it("fetches full records only for the claimed IDs", async () => {
      queryRaw.mockResolvedValue([{ id: "record-1" }, { id: "record-2" }]);
      triggerFindMany.mockResolvedValue([makeRecord(), makeRecord({ id: "record-2" })]);

      await dispatchPendingNotifications();

      expect(triggerFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["record-1", "record-2"] } },
        })
      );
    });
  });

  describe("HUB push — deferred dispatch path", () => {
    it("fires HUB push after DM send when iosDeviceToken is set", async () => {
      triggerFindMany.mockResolvedValue([
        makeRecord({
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
        }),
      ]);

      await dispatchPendingNotifications();

      expect(mockedSendDirectMessage).toHaveBeenCalledOnce();
      expect(mockedSendHubPushNotification).toHaveBeenCalledOnce();
      expect(mockedSendHubPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceToken: "device-xyz",
          message: "You have been assigned a task",
          workspaceSlug: "my-workspace",
          taskId: "task-1",
          featureId: undefined,
        })
      );
    });

    it("does NOT fire HUB push when iosDeviceToken is absent", async () => {
      triggerFindMany.mockResolvedValue([makeRecord()]); // iosDeviceToken: null

      await dispatchPendingNotifications();

      expect(mockedSendDirectMessage).toHaveBeenCalledOnce();
      expect(mockedSendHubPushNotification).not.toHaveBeenCalled();
    });

    it("skips HUB push on cancellation path", async () => {
      // Task is DONE → shouldCancel returns true
      taskFindUnique.mockResolvedValue({ status: TaskStatus.DONE });
      triggerFindMany.mockResolvedValue([
        makeRecord({
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
        }),
      ]);

      const result = await dispatchPendingNotifications();

      expect(result.cancelled).toBe(1);
      expect(mockedSendDirectMessage).not.toHaveBeenCalled();
      expect(mockedSendHubPushNotification).not.toHaveBeenCalled();
    });

    it("resolves workspace slug from task relation", async () => {
      triggerFindMany.mockResolvedValue([
        makeRecord({
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
          task: { workspace: { slug: "task-workspace" } },
          feature: null,
        }),
      ]);

      await dispatchPendingNotifications();

      expect(mockedSendHubPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceSlug: "task-workspace" })
      );
    });

    it("resolves workspace slug from feature relation when task is absent", async () => {
      featureFindUnique.mockResolvedValue({ status: "IN_PROGRESS" });
      triggerFindMany.mockResolvedValue([
        makeRecord({
          notificationType: NotificationTriggerType.WORKFLOW_HALTED,
          taskId: null,
          featureId: "feat-1",
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
          task: null,
          feature: { workspace: { slug: "feature-workspace" } },
        }),
      ]);
      // WORKFLOW_HALTED with feature — only cancel if workflowStatus !== HALTED
      featureFindUnique.mockResolvedValue({ workflowStatus: WorkflowStatus.HALTED });

      await dispatchPendingNotifications();

      expect(mockedSendHubPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceSlug: "feature-workspace", featureId: "feat-1" })
      );
    });

    it("does NOT fire HUB push when workspaceSlug cannot be resolved", async () => {
      triggerFindMany.mockResolvedValue([
        makeRecord({
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
          task: null,   // no task relation
          feature: null, // no feature relation
        }),
      ]);

      await dispatchPendingNotifications();

      expect(mockedSendDirectMessage).toHaveBeenCalledOnce();
      expect(mockedSendHubPushNotification).not.toHaveBeenCalled();
    });

    it("HUB push failure does not affect notification record status", async () => {
      mockedSendHubPushNotification.mockResolvedValue({ success: false, error: "hub down" });
      triggerFindMany.mockResolvedValue([
        makeRecord({
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
        }),
      ]);

      const result = await dispatchPendingNotifications();

      expect(result.dispatched).toBe(1);
      expect(result.failed).toBe(0);
      // Record status is driven by DM result — SENT
      expect(triggerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationTriggerStatus.SENT }),
        })
      );
    });

    it("passes featureId (not taskId) in push payload when record is feature-linked", async () => {
      featureFindUnique.mockResolvedValue({ workflowStatus: WorkflowStatus.HALTED });
      triggerFindMany.mockResolvedValue([
        makeRecord({
          notificationType: NotificationTriggerType.WORKFLOW_HALTED,
          taskId: null,
          featureId: "feat-999",
          targetUser: {
            lightningPubkey: "pubkey-abc",
            sphinxRouteHint: null,
            iosDeviceToken: "device-xyz",
          },
          task: null,
          feature: { workspace: { slug: "feat-ws" } },
        }),
      ]);

      await dispatchPendingNotifications();

      expect(mockedSendHubPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: undefined,
          featureId: "feat-999",
          workspaceSlug: "feat-ws",
        })
      );
    });
  });
});

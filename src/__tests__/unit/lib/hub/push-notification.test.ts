import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/config/env", () => ({
  optionalEnvVars: { HUB_NOTIFY_URL: "https://hub.sphinx.chat/api/v1/nodes/notify" },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { sendHubPushNotification } from "@/lib/hub/push-notification";
import { optionalEnvVars } from "@/config/env";
import { logger } from "@/lib/logger";

const mockedLogger = vi.mocked(logger);

// Helper to cast env mock for reassignment in tests
function setHubUrl(url: string | undefined) {
  (optionalEnvVars as Record<string, unknown>).HUB_NOTIFY_URL = url;
}

describe("sendHubPushNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHubUrl("https://hub.sphinx.chat/api/v1/nodes/notify");
  });

  describe("payload shape", () => {
    it("sends correct payload with taskId present", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await sendHubPushNotification({
        deviceToken: "device-abc",
        message: "You have a new task",
        workspaceSlug: "my-workspace",
        taskId: "task-123",
        featureId: "feat-999",
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://hub.sphinx.chat/api/v1/nodes/notify");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body).toMatchObject({
        v2: true,
        push_environment: "production",
        device_id: "device-abc",
        notification: {
          child: "my-workspace/task:task-123",
          message: "You have a new task",
          badge: null,
          sound: "default",
        },
      });
    });

    it("uses featureId in child when taskId is absent", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await sendHubPushNotification({
        deviceToken: "device-abc",
        message: "Feature update",
        workspaceSlug: "my-workspace",
        featureId: "feat-456",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.notification.child).toBe("my-workspace/feature:feat-456");
    });

    it("taskId takes priority over featureId in child", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await sendHubPushNotification({
        deviceToken: "device-abc",
        message: "msg",
        workspaceSlug: "slug",
        taskId: "task-111",
        featureId: "feat-222",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.notification.child).toBe("slug/task:task-111");
    });

    it("includes workspace slug in child string", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "acme-corp",
        taskId: "t-1",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.notification.child).toMatch(/^acme-corp\//);
    });
  });

  describe("return value", () => {
    it("returns { success: true } on 200 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const result = await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(result).toEqual({ success: true });
    });

    it("returns { success: false, error } on non-200 response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Bad Request", { status: 400 })
      );

      const result = await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("400");
    });
  });

  describe("error handling — never throws", () => {
    it("returns { success: false } and logs when fetch throws", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("network error"));

      const result = await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("network error");
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("HubPush"),
        "HUB_PUSH",
        expect.any(Object)
      );
    });

    it("does not throw when fetch rejects", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));

      await expect(
        sendHubPushNotification({
          deviceToken: "tok",
          message: "msg",
          workspaceSlug: "ws",
          taskId: "t-1",
        })
      ).resolves.not.toThrow();
    });

    it("logs on non-200 response with HUB_PUSH tag", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500 })
      );

      await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        "HUB_PUSH",
        expect.any(Object)
      );
    });
  });

  describe("no-op when HUB_NOTIFY_URL not configured", () => {
    it("returns { success: false } without calling fetch when URL is empty string", async () => {
      setHubUrl("");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const result = await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(result.success).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns { success: false } without calling fetch when URL is undefined", async () => {
      setHubUrl(undefined);
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const result = await sendHubPushNotification({
        deviceToken: "tok",
        message: "msg",
        workspaceSlug: "ws",
        taskId: "t-1",
      });

      expect(result.success).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

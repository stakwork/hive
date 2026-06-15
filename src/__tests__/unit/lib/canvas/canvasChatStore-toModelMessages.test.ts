import { describe, it, expect } from "vitest";
import { toModelMessages } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import type { CanvasChatMessage, CanvasAttachment } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUserMsg(
  content: string,
  attachments?: CanvasAttachment[],
): CanvasChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content,
    timestamp: new Date(),
    ...(attachments ? { attachments } : {}),
  };
}

function makeAssistantMsg(content: string): CanvasChatMessage {
  return { id: "msg-2", role: "assistant", content, timestamp: new Date() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("toModelMessages — multimodal attachments", () => {
  it("produces a plain string content entry when user message has no attachments", () => {
    const msgs = toModelMessages([makeUserMsg("hello")]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
  });

  it("produces a plain string content entry when attachments array is empty", () => {
    const msgs = toModelMessages([makeUserMsg("hello", [])]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
  });

  it("produces a multimodal content array for user message with image attachment", () => {
    const attachment: CanvasAttachment = {
      path: "uploads/ws-1/canvas/ts_abc_photo.jpg",
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 1024,
    };
    const msgs = toModelMessages([makeUserMsg("look at this", [attachment])]);

    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string; text?: string; image?: string }>;
    expect(parts).toContainEqual({ type: "text", text: "look at this" });
    expect(parts).toContainEqual({
      type: "image",
      image: `/api/upload/presigned-url?s3Key=${encodeURIComponent(attachment.path)}`,
    });
  });

  it("omits the text part when content is empty but attachment is present", () => {
    const attachment: CanvasAttachment = {
      path: "uploads/ws-1/canvas/ts_abc_photo.png",
      filename: "photo.png",
      mimeType: "image/png",
      size: 512,
    };
    const msgs = toModelMessages([makeUserMsg("", [attachment])]);

    expect(msgs).toHaveLength(1);
    const parts = msgs[0].content as Array<{ type: string }>;
    const textParts = parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(0);
    const imageParts = parts.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(1);
  });

  it("includes multiple image parts for multiple image attachments", () => {
    const attachments: CanvasAttachment[] = [
      { path: "uploads/ws-1/canvas/a.jpg", filename: "a.jpg", mimeType: "image/jpeg", size: 100 },
      { path: "uploads/ws-1/canvas/b.png", filename: "b.png", mimeType: "image/png", size: 200 },
    ];
    const msgs = toModelMessages([makeUserMsg("two images", attachments)]);

    const parts = msgs[0].content as Array<{ type: string; image?: string }>;
    const imageParts = parts.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(2);
    expect(imageParts[0].image).toContain(encodeURIComponent("uploads/ws-1/canvas/a.jpg"));
    expect(imageParts[1].image).toContain(encodeURIComponent("uploads/ws-1/canvas/b.png"));
  });

  it("falls through to plain string for non-image attachments (e.g. video)", () => {
    const attachment: CanvasAttachment = {
      path: "uploads/ws-1/canvas/clip.mp4",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      size: 5000,
    };
    const msgs = toModelMessages([makeUserMsg("watch this", [attachment])]);
    // video attachment → no image parts → fallthrough to text-only
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "user", content: "watch this" });
  });

  it("does not affect assistant messages", () => {
    const msgs = toModelMessages([makeAssistantMsg("sure!")]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: "assistant", content: "sure!" });
  });

  it("handles a mix of user messages with and without attachments", () => {
    const attachment: CanvasAttachment = {
      path: "uploads/ws-1/canvas/img.jpg",
      filename: "img.jpg",
      mimeType: "image/jpeg",
      size: 1024,
    };
    const msgs = toModelMessages([
      makeUserMsg("plain text"),
      makeAssistantMsg("ok"),
      makeUserMsg("with image", [attachment]),
    ]);

    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "user", content: "plain text" });
    expect(msgs[1]).toEqual({ role: "assistant", content: "ok" });
    expect(Array.isArray(msgs[2].content)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { captureChatPreload } from "@/app/org/[githubLogin]/_state/captureChatPreload";

describe("?chat= preload activeStream capture", () => {
  it("captures streamId and turnId from the conversation GET", () => {
    const captured = captureChatPreload({
      messages: [{ id: "t-u", role: "user", content: "hi", timestamp: "2026-01-01T00:00:00.000Z" }],
      title: "Planning",
      activeStream: { streamId: "turn-1", turnId: "turn-1" },
    });
    expect(captured.activeStream).toEqual({ streamId: "turn-1", turnId: "turn-1" });
    expect(captured.messages).toHaveLength(1);
    expect(captured.messages?.[0].timestamp).toBeInstanceOf(Date);
    expect(captured.title).toBe("Planning");
  });

  it("treats a missing or malformed pointer as no in-flight stream", () => {
    expect(captureChatPreload({ messages: [], activeStream: null }).activeStream).toBeNull();
    expect(
      captureChatPreload({ activeStream: { streamId: 1, turnId: "x" } }).activeStream,
    ).toBeNull();
    expect(captureChatPreload(null).activeStream).toBeNull();
  });
});

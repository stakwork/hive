import { describe, it, expect } from "vitest";
import { buildPushMessage } from "@/lib/hub/push-notification";

describe("buildPushMessage", () => {
  it("strips @alias — prefix and trailing URL (happy path)", () => {
    const input = "@Tom — Your plan for 'X' is ready for your review: https://hive.sphinx.chat/w/abc";
    expect(buildPushMessage(input)).toBe("Your plan for 'X' is ready for your review");
  });

  it("strips prefix only when no trailing URL is present", () => {
    const input = "@alice — You have been assigned to task 'Fix bug'";
    expect(buildPushMessage(input)).toBe("You have been assigned to task 'Fix bug'");
  });

  it("strips trailing URL only when no prefix is present", () => {
    const input = "Your PR has been merged: https://hive.sphinx.chat/w/my-ws/task/123";
    expect(buildPushMessage(input)).toBe("Your PR has been merged");
  });

  it("falls back to the original message if stripping would produce an empty string", () => {
    const input = "@bob — : https://hive.sphinx.chat/w/ws";
    // After stripping prefix → ": https://..." → stripping URL → "" → fallback
    expect(buildPushMessage(input)).toBe(input);
  });

  it("handles aliases with hyphens (e.g. @tom-smith)", () => {
    const input = "@tom-smith — Workflow halted for task 'Auth refactor': https://hive.sphinx.chat/w/ws/task/t1";
    expect(buildPushMessage(input)).toBe("Workflow halted for task 'Auth refactor'");
  });

  it("handles aliases with underscores (e.g. @tom_smith)", () => {
    const input = "@tom_smith — Feature 'Dashboard' is complete: https://hive.sphinx.chat/w/ws/feature/f1";
    expect(buildPushMessage(input)).toBe("Feature 'Dashboard' is complete");
  });

  it("returns the original message unchanged when no prefix or URL is present", () => {
    const input = "You have been assigned a task";
    expect(buildPushMessage(input)).toBe("You have been assigned a task");
  });

  it("supports http:// URLs as well as https://", () => {
    const input = "@dev — Task updated: http://localhost/w/test/task/1";
    expect(buildPushMessage(input)).toBe("Task updated");
  });
});

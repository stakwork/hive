import { describe, it, expect, vi } from "vitest";
import {
  findClarifyingReply,
  hasPendingClarifyingQuestions,
} from "@/lib/utils/clarifying-questions";

describe("findClarifyingReply", () => {
  it("returns explicit replyId match when present", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "r1", role: "USER", replyId: "q1" },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result?.id).toBe("r1");
  });

  it("returns first subsequent USER message when no replyId match", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "u1", role: "USER", replyId: null },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result?.id).toBe("u1");
  });

  it("returns undefined when question is not in the array", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "u1", role: "USER", replyId: null },
    ];
    const result = findClarifyingReply(messages, "missing-id");
    expect(result).toBeUndefined();
  });

  it("does not return a subsequent ASSISTANT message as fallback reply", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "a2", role: "ASSISTANT", replyId: null },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result).toBeUndefined();
  });

  it("prioritises explicit replyId over subsequent USER message", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "explicit", role: "USER", replyId: "q1" },
      { id: "freeform", role: "USER", replyId: null },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result?.id).toBe("explicit");
  });

  it("returns the FIRST subsequent USER message, not a later one", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null },
      { id: "u1", role: "USER", replyId: null },
      { id: "u2", role: "USER", replyId: null },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result?.id).toBe("u1");
  });

  it("does not return USER messages that appear before the question", () => {
    const messages = [
      { id: "u0", role: "USER", replyId: null },
      { id: "q1", role: "ASSISTANT", replyId: null },
    ];
    const result = findClarifyingReply(messages, "q1");
    expect(result).toBeUndefined();
  });
});

describe("hasPendingClarifyingQuestions", () => {
  const isClarifyingQuestions = (c: unknown) =>
    typeof c === "object" && c !== null && "questions" in c;

  const clarifyingArtifact = {
    type: "PLAN",
    content: { questions: [{ question: "Q?", type: "text" }] },
  };

  it("returns true when a clarifying question has no subsequent answer", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null, artifacts: [clarifyingArtifact] },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(true);
  });

  it("returns false when answered via explicit replyId message", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null, artifacts: [clarifyingArtifact] },
      { id: "r1", role: "USER", replyId: "q1", artifacts: [] },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(false);
  });

  it("returns false when a USER message appears after the question (free-form path)", () => {
    const messages = [
      { id: "q1", role: "ASSISTANT", replyId: null, artifacts: [clarifyingArtifact] },
      { id: "u1", role: "USER", replyId: null, artifacts: [] },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(false);
  });

  it("returns false when no clarifying artifacts exist", () => {
    const messages = [
      { id: "m1", role: "ASSISTANT", replyId: null, artifacts: [{ type: "PLAN", content: {} }] },
      { id: "m2", role: "USER", replyId: null, artifacts: [] },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(false);
  });

  it("returns false for messages with no artifacts", () => {
    const messages = [
      { id: "m1", role: "USER", replyId: null },
      { id: "m2", role: "ASSISTANT", replyId: null },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(false);
  });

  it("returns true when only a prior USER message exists (before the question)", () => {
    const messages = [
      { id: "u0", role: "USER", replyId: null, artifacts: [] },
      { id: "q1", role: "ASSISTANT", replyId: null, artifacts: [clarifyingArtifact] },
    ];
    expect(hasPendingClarifyingQuestions(messages, isClarifyingQuestions)).toBe(true);
  });
});

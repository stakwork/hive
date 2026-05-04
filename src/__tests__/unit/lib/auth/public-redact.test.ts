import { describe, it, expect } from "vitest";
import {
  redactArtifactContentForPublic,
  toPublicArtifact,
  toPublicChatMessage,
  toPublicUser,
} from "@/lib/auth/public-redact";

describe("redactArtifactContentForPublic", () => {
  it("strips url, agentPassword, and podId from IDE artifact content", () => {
    const result = redactArtifactContentForPublic("IDE", {
      url: "https://pod-xyz.example.com:8080",
      podId: "pod-xyz",
      agentPassword: "super-secret",
    }) as Record<string, unknown>;

    expect(result.url).toBeUndefined();
    expect(result.agentPassword).toBeUndefined();
    expect(result.podId).toBeUndefined();
  });

  it("strips url, agentPassword, and podId from BROWSER artifact content", () => {
    const result = redactArtifactContentForPublic("BROWSER", {
      url: "https://pod.example.com",
      podId: "pod-1",
      agentPassword: "pw",
      // any non-credential fields should pass through
      extra: "keep-me",
    }) as Record<string, unknown>;

    expect(result.url).toBeUndefined();
    expect(result.agentPassword).toBeUndefined();
    expect(result.podId).toBeUndefined();
    expect(result.extra).toBe("keep-me");
  });

  it("strips eventsToken/baseUrl/requestId from STREAM content", () => {
    const result = redactArtifactContentForPublic("STREAM", {
      requestId: "req-1",
      eventsToken: "tok",
      baseUrl: "https://stream.example.com",
    }) as Record<string, unknown>;

    expect(result.eventsToken).toBeUndefined();
    expect(result.baseUrl).toBeUndefined();
    expect(result.requestId).toBeUndefined();
  });

  it("strips iframeUrl from BUG_REPORT content", () => {
    const result = redactArtifactContentForPublic("BUG_REPORT", {
      iframeUrl: "https://pod.example.com",
      bugDescription: "broken button",
    }) as Record<string, unknown>;

    expect(result.iframeUrl).toBeUndefined();
    expect(result.bugDescription).toBe("broken button");
  });

  it("passes CODE artifact content through unchanged", () => {
    const content = { content: "console.log('x')", language: "js", file: "a.js" };
    const result = redactArtifactContentForPublic("CODE", content);
    expect(result).toEqual(content);
  });

  it("passes FORM artifact content through unchanged", () => {
    const content = { actionText: "Submit", webhook: "https://w", options: [] };
    const result = redactArtifactContentForPublic("FORM", content);
    expect(result).toEqual(content);
  });

  it("returns null/undefined content unchanged", () => {
    expect(redactArtifactContentForPublic("IDE", null)).toBeNull();
    expect(redactArtifactContentForPublic("IDE", undefined)).toBeUndefined();
  });

  it("returns content unchanged for unknown artifact types", () => {
    const content = { foo: "bar", url: "https://example.com" };
    expect(redactArtifactContentForPublic("UNKNOWN_TYPE", content)).toEqual(content);
  });
});

describe("toPublicArtifact", () => {
  it("redacts content based on artifact type", () => {
    const artifact = {
      id: "a1",
      type: "IDE",
      content: { url: "https://pod", agentPassword: "pw", podId: "p" },
      icon: null,
    };
    const result = toPublicArtifact(artifact);
    expect((result.content as Record<string, unknown>).agentPassword).toBeUndefined();
    expect((result.content as Record<string, unknown>).url).toBeUndefined();
    expect(result.id).toBe("a1");
    expect(result.type).toBe("IDE");
  });
});

describe("toPublicChatMessage", () => {
  it("redacts user email AND artifact credentials in one pass", () => {
    const msg = {
      id: "m1",
      message: "hi",
      user: { id: "u1", name: "Alice", email: "alice@example.com", image: null },
      artifacts: [
        {
          id: "a1",
          type: "IDE",
          content: { url: "https://pod", agentPassword: "pw" },
        },
        {
          id: "a2",
          type: "CODE",
          content: { content: "x", language: "js" },
        },
      ],
    };
    const result = toPublicChatMessage(msg);

    expect(result.user?.email).toBeNull();
    expect(result.user?.name).toBe("Alice");

    const ide = result.artifacts?.[0];
    expect((ide?.content as Record<string, unknown>).agentPassword).toBeUndefined();
    expect((ide?.content as Record<string, unknown>).url).toBeUndefined();

    // CODE artifact passes through
    const code = result.artifacts?.[1];
    expect((code?.content as Record<string, unknown>).content).toBe("x");
  });

  it("handles messages without artifacts", () => {
    const msg = {
      id: "m1",
      user: { id: "u1", name: "Alice", email: "a@b.c", image: null },
    };
    const result = toPublicChatMessage(msg);
    expect(result.user?.email).toBeNull();
    expect(result.artifacts).toBeUndefined();
  });
});

describe("toPublicUser", () => {
  it("nulls out email", () => {
    expect(toPublicUser({ id: "1", name: "x", image: null })).toEqual({
      id: "1",
      name: "x",
      email: null,
      image: null,
    });
  });

  it("returns null for null input", () => {
    expect(toPublicUser(null)).toBeNull();
  });
});

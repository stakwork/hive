// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";

const { getObject, generatePresignedDownloadUrl, validateUserBelongsToOrg, validateWorkspaceAccessById } =
  vi.hoisted(() => ({
    getObject: vi.fn(),
    generatePresignedDownloadUrl: vi.fn(),
    validateUserBelongsToOrg: vi.fn(),
    validateWorkspaceAccessById: vi.fn(),
  }));

vi.mock("@/services/s3", () => ({
  getS3Service: () => ({ getObject, generatePresignedDownloadUrl }),
}));
vi.mock("@/services/workspace", () => ({
  validateUserBelongsToOrg,
  validateWorkspaceAccessById,
}));

import { resolveMessageAttachments } from "@/lib/ai/resolveMessageAttachments";
import { buildUserContent } from "@/lib/ai/attachmentParts";

const md = { path: "orgs/acme/canvas/notes.md", filename: "notes.md", mimeType: "", size: 5 };
const png = { path: "orgs/acme/canvas/a.png", filename: "a.png", mimeType: "image/png", size: 5 };

function userMsg(text: string, attachments: (typeof md)[]): ModelMessage {
  return { role: "user", content: buildUserContent(text, attachments) } as ModelMessage;
}

describe("resolveMessageAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generatePresignedDownloadUrl.mockResolvedValue("https://s3.example.com/a.png?sig=1");
    getObject.mockResolvedValue(Buffer.from("# Hello\nworld"));
    validateUserBelongsToOrg.mockResolvedValue(true);
  });

  it("inlines a text attachment and signs an image", async () => {
    const messages = [userMsg("read these", [md, png])];
    await resolveMessageAttachments(messages, { userId: "u1" });

    expect(validateUserBelongsToOrg).toHaveBeenCalledWith("acme", "u1", "githubLogin");
    expect(getObject).toHaveBeenCalledWith(md.path);
    expect(messages[0].content).toEqual([
      { type: "text", text: "read these" },
      { type: "text", text: '<attachment filename="notes.md">\n# Hello\nworld\n</attachment>' },
      { type: "image", image: new URL("https://s3.example.com/a.png?sig=1") },
    ]);
  });

  it("does not read a text attachment the caller cannot access", async () => {
    validateUserBelongsToOrg.mockResolvedValue(false);
    const messages = [userMsg("", [md])];
    await resolveMessageAttachments(messages, { userId: "u1" });

    expect(getObject).not.toHaveBeenCalled();
    expect(messages[0].content).toEqual([
      { type: "text", text: '[Attached file "notes.md" could not be read]' },
    ]);
  });

  it("does not read text attachments without a userId", async () => {
    const messages = [userMsg("", [md])];
    await resolveMessageAttachments(messages, { userId: null });

    expect(getObject).not.toHaveBeenCalled();
    expect((messages[0].content as Array<{ text: string }>)[0].text).toContain("could not be read");
  });

  it("checks workspace access for workspace-scoped keys", async () => {
    validateWorkspaceAccessById.mockResolvedValue({ hasAccess: true, canRead: true });
    const messages = [userMsg("", [{ ...md, path: "uploads/ws-1/canvas/notes.md" }])];
    await resolveMessageAttachments(messages, { userId: "u1" });

    expect(validateWorkspaceAccessById).toHaveBeenCalledWith("ws-1", "u1");
    expect((messages[0].content as Array<{ text: string }>)[0].text).toContain("# Hello");
  });
});

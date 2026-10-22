/**
 * Unit tests for `services/strut-attachments.ts` — a message's files for a
 * strut launch: read as the person, strut's caps checked here so one file
 * over them is left out (and named) instead of strut refusing the launch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCanReadKey, mockGetObject } = vi.hoisted(() => ({ mockCanReadKey: vi.fn(), mockGetObject: vi.fn() }));
vi.mock("@/lib/ai/resolveMessageAttachments", () => ({ canReadKey: mockCanReadKey }));
vi.mock("@/services/s3", () => ({ getS3Service: () => ({ getObject: mockGetObject }) }));

import { skippedAttachmentsNote, strutAttachments } from "@/services/strut-attachments";

const MB = 1024 * 1024;
const file = (filename: string, mimeType = "text/plain") => ({ path: `uploads/org/acme/${filename}`, filename, mimeType, size: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  mockCanReadKey.mockResolvedValue(true);
  mockGetObject.mockResolvedValue(Buffer.from("x"));
});

describe("strutAttachments", () => {
  it("sends each file as name, media type and base64, in the order attached", async () => {
    mockGetObject.mockImplementation(async (key: string) => Buffer.from(key));
    const out = await strutAttachments("user-1", [file("a.txt"), file("b.pdf", "application/pdf")]);
    expect(out).toEqual({
      attachments: [
        { name: "a.txt", mediaType: "text/plain", data: Buffer.from("uploads/org/acme/a.txt").toString("base64") },
        { name: "b.pdf", mediaType: "application/pdf", data: Buffer.from("uploads/org/acme/b.pdf").toString("base64") },
      ],
      skipped: [],
    });
  });

  it("leaves out what strut would refuse the whole launch for, and says why", async () => {
    const files = [
      file("big.pdf", "application/pdf"), // 11 MB: over the cap for one file
      file("scan", ""), // no type and no image extension: a file, so 6 MB is fine
      file("pic.JPG", ""), // an image by its extension: 6 MB is over the cap for one image
      file("c.bin", "application/octet-stream"), // 10 MB: with scan's 6, over 15 together
      ...Array.from({ length: 8 }, (_, i) => file(`n${i}.txt`)), // n6 and n7 are the 11th and 12th
    ];
    const sizes: Record<string, number> = { "big.pdf": 11 * MB, scan: 6 * MB, "pic.JPG": 6 * MB, "c.bin": 10 * MB };
    mockGetObject.mockImplementation(async (key: string) => Buffer.alloc(sizes[key.split("/").pop()!] ?? 1));

    const out = await strutAttachments("user-1", files);
    expect(out.attachments.map((a) => a.name)).toEqual(["scan", "n0.txt", "n1.txt", "n2.txt", "n3.txt", "n4.txt", "n5.txt"]);
    expect(out.skipped).toEqual([
      { name: "big.pdf", reason: "11.0 MB, over the 10.0 MB limit for one file" },
      { name: "pic.JPG", reason: "6.0 MB, over the 5.0 MB limit for one image" },
      { name: "c.bin", reason: "the message's files are over 15.0 MB together" },
      { name: "n6.txt", reason: "more than 10 files in one message" },
      { name: "n7.txt", reason: "more than 10 files in one message" },
    ]);
    // The files past the tenth are never fetched.
    expect(mockGetObject).toHaveBeenCalledTimes(10);
  });

  it("a key the person cannot read, or one S3 fails on, is not sent", async () => {
    mockCanReadKey.mockImplementation(async (key: string) => !key.endsWith("theirs.txt"));
    mockGetObject.mockImplementation(async (key: string) => {
      if (key.endsWith("gone.txt")) throw new Error("NoSuchKey");
      return Buffer.from("x");
    });
    const out = await strutAttachments("user-1", [file("theirs.txt"), file("gone.txt"), file("ok.txt")]);
    expect(out.attachments.map((a) => a.name)).toEqual(["ok.txt"]);
    expect(out.skipped).toEqual([
      { name: "theirs.txt", reason: "it could not be read" },
      { name: "gone.txt", reason: "it could not be read" },
    ]);
    expect(mockCanReadKey).toHaveBeenCalledWith("uploads/org/acme/theirs.txt", "user-1");
    expect(mockGetObject).not.toHaveBeenCalledWith("uploads/org/acme/theirs.txt");
  });
});

describe("skippedAttachmentsNote", () => {
  it("is empty with nothing skipped, else one line after the message", () => {
    expect(skippedAttachmentsNote([])).toBe("");
    expect(skippedAttachmentsNote([{ name: "a.pdf", reason: "11.0 MB, over the 10.0 MB limit for one file" }])).toBe(
      "\n\n(Attached but not sent to you: a.pdf — 11.0 MB, over the 10.0 MB limit for one file.)",
    );
  });
});

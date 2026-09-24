import { describe, it, expect, vi, beforeEach } from "vitest";

const redisGet = vi.fn();
const redisSet = vi.fn();
const redisDel = vi.fn();
const duplicate = vi.fn(() => ({ role: "subscriber" }));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: (...args: unknown[]) => redisGet(...args),
    set: (...args: unknown[]) => redisSet(...args),
    del: (...args: unknown[]) => redisDel(...args),
    duplicate: () => duplicate(),
  },
}));

const createResumableStreamContext = vi.fn((_options?: unknown) => ({
  createNewResumableStream: vi.fn(),
  resumeExistingStream: vi.fn(),
}));

vi.mock("resumable-stream/ioredis", () => ({
  createResumableStreamContext: (options: unknown) =>
    createResumableStreamContext(options),
}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

import {
  CANVAS_STREAM_TTL_SECONDS,
  clearActiveStream,
  createCanvasResumableStream,
  parseActiveStream,
  readActiveStream,
  writeActiveStream,
} from "@/lib/ai/canvas-resumable-stream";
import { redis } from "@/lib/redis";

describe("canvas-resumable-stream", () => {
  beforeEach(() => {
    redisGet.mockReset();
    redisSet.mockReset();
    redisDel.mockReset();
    duplicate.mockClear();
    createResumableStreamContext.mockClear();
  });

  it("parses a pointer and rejects malformed values", () => {
    expect(parseActiveStream(JSON.stringify({ streamId: "t1", turnId: "t1" }))).toEqual({
      streamId: "t1",
      turnId: "t1",
    });
    expect(parseActiveStream(null)).toBeNull();
    expect(parseActiveStream("not-json")).toBeNull();
    expect(parseActiveStream(JSON.stringify({ streamId: "", turnId: "t" }))).toBeNull();
  });

  it("writes the pointer keyed by the canvas row id with the maxDuration TTL", async () => {
    redisSet.mockResolvedValue("OK");
    await writeActiveStream("row-1", "turn-1");
    expect(redisSet).toHaveBeenCalledWith(
      "canvas:active-stream:row-1",
      JSON.stringify({ streamId: "turn-1", turnId: "turn-1" }),
      "EX",
      CANVAS_STREAM_TTL_SECONDS,
    );
    expect(CANVAS_STREAM_TTL_SECONDS).toBe(800);
  });

  it("returns null when Redis GET throws so a history load can continue", async () => {
    redisGet.mockRejectedValue(new Error("down"));
    await expect(readActiveStream("row-1")).resolves.toBeNull();
  });

  it("does not construct the resumable context until create/resume", async () => {
    expect(createResumableStreamContext).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    const uiStream = new ReadableStream<string>({ start: (c) => c.close() });
    await createCanvasResumableStream("turn-1", uiStream);
    expect(createResumableStreamContext).toHaveBeenCalledTimes(1);
    const opts = createResumableStreamContext.mock.calls[0][0] as unknown as {
      publisher: unknown;
      subscriber: unknown;
      waitUntil: unknown;
    };
    expect(opts.publisher).toBe(redis);
    expect(opts.subscriber).toEqual({ role: "subscriber" });
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(typeof opts.waitUntil).toBe("function");
  });

  it("swallows a failed pointer delete", async () => {
    redisDel.mockRejectedValue(new Error("down"));
    await expect(clearActiveStream("row-1")).resolves.toBeUndefined();
  });
});

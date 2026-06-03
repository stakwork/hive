import { describe, it, expect, vi, beforeEach } from "vitest";
import { withLock, LockAcquireTimeoutError } from "@/lib/locks/redis-lock";

vi.mock("@/lib/redis", () => ({
  redis: {
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

const { redis } = await import("@/lib/redis");

describe("withLock", () => {
  beforeEach(() => {
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.eval).mockReset();
  });

  it("acquires the lock, runs the fn, and releases", async () => {
    vi.mocked(redis.set).mockResolvedValueOnce("OK" as never);
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);

    const result = await withLock("k1", async () => "value");

    expect(result).toBe("value");
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      "k1",
      expect.any(String),
      "PX",
      expect.any(Number),
      "NX",
    );
    // Release uses compare-and-delete with the same token.
    const lockToken = vi.mocked(redis.set).mock.calls[0][1];
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "k1",
      lockToken,
    );
  });

  it("releases the lock even if the fn throws", async () => {
    vi.mocked(redis.set).mockResolvedValueOnce("OK" as never);
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);

    await expect(
      withLock("k2", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("retries when the lock is held, then succeeds", async () => {
    vi.mocked(redis.set)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce("OK" as never);
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);

    const result = await withLock("k3", async () => "ok", {
      retryIntervalMs: 1,
      acquireTimeoutMs: 1_000,
    });

    expect(result).toBe("ok");
    expect(redis.set).toHaveBeenCalledTimes(3);
  });

  it("throws LockAcquireTimeoutError when acquisition times out", async () => {
    vi.mocked(redis.set).mockResolvedValue(null as never);

    await expect(
      withLock("k4", async () => "never", {
        retryIntervalMs: 1,
        acquireTimeoutMs: 30,
      }),
    ).rejects.toBeInstanceOf(LockAcquireTimeoutError);

    // fn must not have been invoked; release must not have happened.
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("does not let a release failure mask the fn result", async () => {
    vi.mocked(redis.set).mockResolvedValueOnce("OK" as never);
    vi.mocked(redis.eval).mockRejectedValueOnce(new Error("redis down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(withLock("k5", async () => "value")).resolves.toBe("value");
  });
});

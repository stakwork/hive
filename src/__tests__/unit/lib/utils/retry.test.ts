import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithExponentialBackoff } from "@/lib/utils/retry";

describe("retryWithExponentialBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const promise = retryWithExponentialBackoff(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on failure and resolves on subsequent success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const promise = retryWithExponentialBackoff(fn, {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("delays double each attempt (exponential backoff)", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    // Track setTimeout calls to measure delays
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))
      .mockResolvedValue("done");

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((cb, delay, ...args) => {
      if (typeof delay === "number" && delay > 0) {
        delays.push(delay);
      }
      return originalSetTimeout(cb as () => void, 0, ...args);
    });

    const promise = retryWithExponentialBackoff(fn, {
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    });

    await vi.runAllTimersAsync();
    await promise;

    setTimeoutSpy.mockRestore();

    // Delays should be: 1000, 2000, 4000
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
  });

  test("caps delay at maxDelayMs", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))
      .mockRejectedValueOnce(new Error("fail 4"))
      .mockResolvedValue("done");

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((cb, delay, ...args) => {
      if (typeof delay === "number" && delay > 0) {
        delays.push(delay);
      }
      return originalSetTimeout(cb as () => void, 0, ...args);
    });

    const promise = retryWithExponentialBackoff(fn, {
      maxAttempts: 6,
      baseDelayMs: 1000,
      maxDelayMs: 3000,
    });

    await vi.runAllTimersAsync();
    await promise;

    setTimeoutSpy.mockRestore();

    // Delays: 1000, 2000, 3000 (capped), 3000 (capped)
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(3000);
    expect(delays[3]).toBe(3000);
  });

  test("throws last error after maxAttempts exhausted", async () => {
    const error = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(error);

    const promise = retryWithExponentialBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    // Attach the rejection handler BEFORE running timers to prevent unhandled rejection
    const expectation = expect(promise).rejects.toThrow("always fails");
    await vi.runAllTimersAsync();
    await expectation;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("uses default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("default");

    const promise = retryWithExponentialBackoff(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("default");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

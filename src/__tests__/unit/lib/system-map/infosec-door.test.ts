import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInfosecDoorCache, InfosecDoorError, runCweCatalog } from "@/lib/system-map/infosec-door";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const launched = () => json({ runId: "r1", token: "tok" }, 202);
const finished = (result: unknown, status = "success") => json({ status, output: { op: "view", result } });
const input = { op: "view", view: "CWE-1435" } as const;
const BASE = "https://infosec.sphinx.chat:3355/lab/public/workflows/cwe-catalog";

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INFOSEC_DOOR_URL", "");
  clearInfosecDoorCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runCweCatalog", () => {
  it("launches then reads, returning output.result", async () => {
    const result = { status: "ready", members: [] };
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished(result));
    await expect(runCweCatalog(input)).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/run`);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    const body = JSON.parse(init.body);
    expect(body.input).toEqual(input);
    expect(typeof body.key).toBe("string");
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/runs/r1?wait=25&t=tok`);
  });

  it("honours INFOSEC_DOOR_URL with a trailing slash", async () => {
    vi.stubEnv("INFOSEC_DOOR_URL", "https://door.test/lab/");
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "ready" }));
    await runCweCatalog(input);
    expect(fetchMock.mock.calls[0][0]).toBe("https://door.test/lab/public/workflows/cwe-catalog/run");
  });

  it("reads again while the run is running", async () => {
    fetchMock
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(json({ status: "running" }))
      .mockResolvedValueOnce(finished({ status: "ready" }));
    await expect(runCweCatalog(input)).resolves.toEqual({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 429 with the same key", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "too many launches" }, 429, { "retry-after": "1" }))
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "ready" }));
    const p = runCweCatalog(input);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ status: "ready" });
    const keys = [0, 1].map((i) => JSON.parse(fetchMock.mock.calls[i][1].body).key);
    expect(keys[0]).toBe(keys[1]);
  });

  it("retries a network error", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "ready" }));
    const p = runCweCatalog(input);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ status: "ready" });
  });

  it("fails busy when 429 persists", async () => {
    fetchMock.mockImplementation(async () => json({}, 429));
    const assertion = expect(runCweCatalog(input)).rejects.toMatchObject({
      kind: "busy",
      message: "The infosec catalogue is busy, try again in a minute",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails unavailable when the network keeps failing", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const assertion = expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("times out", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("fails when the run status is error", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "error", error: "boom" }, "error"));
    const err = await runCweCatalog(input).catch((e) => e);
    expect(err).toBeInstanceOf(InfosecDoorError);
    expect(err).toMatchObject({ kind: "failed", message: "boom" });
  });

  it("caches ready answers by normalized args", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "ready" }));
    await runCweCatalog(input);
    await runCweCatalog({ op: "view", view: " CWE-1435 " });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache error answers or failures", async () => {
    fetchMock
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "error", error: "CWE not found" }))
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "ready" }));
    await runCweCatalog(input);
    await expect(runCweCatalog(input)).resolves.toEqual({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shares one run between concurrent identical requests", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "ready" }));
    await Promise.all([runCweCatalog(input), runCweCatalog(input)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

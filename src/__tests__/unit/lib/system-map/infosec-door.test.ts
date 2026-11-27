import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInfosecDoorCache, InfosecDoorError, runCweCatalog } from "@/lib/system-map/infosec-door";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const launched = () => json({ runId: "r1", token: "tok" }, 202);
const finished = (result: unknown, status = "success") => json({ status, output: { result } });
const input = { op: "view", view: "CWE-1435" } as const;

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
    const [launchUrl, launchInit] = fetchMock.mock.calls[0];
    expect(launchUrl).toBe("https://infosec.sphinx.chat:3355/lab/public/workflows/cwe-catalog/run");
    expect(launchInit.method).toBe("POST");
    expect(launchInit.cache).toBe("no-store");
    const body = JSON.parse(launchInit.body);
    expect(body.input).toEqual(input);
    expect(typeof body.key).toBe("string");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://infosec.sphinx.chat:3355/lab/public/workflows/cwe-catalog/runs/r1?wait=25&t=tok",
    );
  });

  it("honours INFOSEC_DOOR_URL and strips a trailing slash", async () => {
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

  it("caches ready answers", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "ready" }));
    await runCweCatalog(input);
    await runCweCatalog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache error answers", async () => {
    fetchMock
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "error", error: "x" }))
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "ready" }));
    await runCweCatalog(input);
    await expect(runCweCatalog(input)).resolves.toEqual({ status: "ready" });
  });

  it("shares one run between concurrent identical requests", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(finished({ status: "ready" }));
    await Promise.all([runCweCatalog(input), runCweCatalog(input)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries after a 429", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "1" }))
      .mockResolvedValueOnce(launched())
      .mockResolvedValueOnce(finished({ status: "ready" }));
    const p = runCweCatalog(input);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails busy when 429 persists", async () => {
    fetchMock.mockImplementation(async () => json({}, 429));
    const p = runCweCatalog(input);
    const assertion = expect(p).rejects.toMatchObject({ kind: "busy", message: "Infosec catalogue is busy, try again in a minute" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails when the run status is error", async () => {
    fetchMock.mockResolvedValueOnce(launched()).mockResolvedValueOnce(json({ status: "error" }));
    await expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "failed" });
  });

  it("is unavailable when fetch rejects or returns non-2xx", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(runCweCatalog(input)).rejects.toBeInstanceOf(InfosecDoorError);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "unavailable" });
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("is a timeout when the request times out", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(runCweCatalog(input)).rejects.toMatchObject({ kind: "timeout" });
  });
});

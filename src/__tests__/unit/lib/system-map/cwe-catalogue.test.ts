import { describe, expect, it, vi, beforeEach } from "vitest";
import { listCweView, loadCweRelated, searchCwes, InfosecDoorError } from "@/lib/system-map/cwe-catalogue";
import { runCweCatalog } from "@/lib/system-map/infosec-door";

vi.mock("@/lib/system-map/infosec-door", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-map/infosec-door")>()),
  runCweCatalog: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const run = vi.mocked(runCweCatalog);

beforeEach(() => run.mockReset());

describe("listCweView", () => {
  it("sends the view op and returns members", async () => {
    run.mockResolvedValue({ status: "ready", view: { id: "CWE-1435", name: "Top 25" }, members: [{ id: "CWE-79" }] });
    const out = await listCweView("CWE-1435");
    expect(run).toHaveBeenCalledWith({ op: "view", view: "CWE-1435" });
    expect(out).toEqual({ ok: true, view: { id: "CWE-1435", name: "Top 25" }, members: [{ id: "CWE-79" }] });
  });

  it("maps not-found to 404 and other errors to 502", async () => {
    run.mockResolvedValueOnce({ status: "error", error: "CWE not found: CWE-1" });
    expect(await listCweView("CWE-1")).toEqual({ ok: false, error: "CWE not found: CWE-1", status: 404 });
    run.mockResolvedValueOnce({ status: "error", error: "boom" });
    expect(await listCweView("CWE-1")).toMatchObject({ ok: false, status: 502 });
  });

  it("maps the door's unknown-view message to 404", async () => {
    const error = "CWE-1 is not a view or category with members in the CWE catalogue";
    run.mockResolvedValueOnce({ status: "error", error });
    expect(await listCweView("CWE-1")).toEqual({ ok: false, error, status: 404 });
  });

  it("maps door errors by kind", async () => {
    run.mockRejectedValueOnce(new InfosecDoorError("busy", "busy"));
    expect(await listCweView("x")).toEqual({ ok: false, error: "busy", status: 503 });
    run.mockRejectedValueOnce(new InfosecDoorError("slow", "timeout"));
    expect(await listCweView("x")).toMatchObject({ status: 504 });
    run.mockRejectedValueOnce(new InfosecDoorError("down", "unavailable"));
    expect(await listCweView("x")).toMatchObject({ status: 502 });
  });
});

describe("searchCwes", () => {
  it("returns empty for a blank query without calling", async () => {
    expect(await searchCwes("  ")).toEqual({ ok: true, results: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it("sends the trimmed query and returns results", async () => {
    run.mockResolvedValue({ status: "ready", results: [{ id: "CWE-79" }] });
    expect(await searchCwes(" 79 ")).toEqual({ ok: true, results: [{ id: "CWE-79" }] });
    expect(run).toHaveBeenCalledWith({ op: "search", q: "79" });
  });

  it("maps an error result", async () => {
    run.mockResolvedValue({ status: "error", error: "bad" });
    expect(await searchCwes("x")).toEqual({ ok: false, error: "bad", status: 502 });
  });
});

describe("loadCweRelated", () => {
  it("passes ref_id and returns buckets including capec and cves", async () => {
    const capec = [{ id: "CAPEC-63" }];
    const cves = { total: 3, recent: [{ id: "CVE-1" }] };
    run.mockResolvedValue({ status: "ready", templates: [], mitigations: [], detection: [], platforms: [], capec, cves });
    const out = await loadCweRelated("abc");
    expect(run).toHaveBeenCalledWith({ op: "related", ref_id: "abc" });
    expect(out).toEqual({ status: "ready", templates: [], mitigations: [], detection: [], platforms: [], capec, cves });
  });

  it("throws not_found for an unknown CWE", async () => {
    run.mockResolvedValue({ status: "error", error: "CWE not found: abc" });
    await expect(loadCweRelated("abc")).rejects.toMatchObject({ kind: "not_found" });
  });
});

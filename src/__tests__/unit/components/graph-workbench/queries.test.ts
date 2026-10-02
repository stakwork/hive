import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { saveConceptDocs } from "@/components/graph-workbench/queries";

describe("saveConceptDocs", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  test("PUTs docs to the ref_id-keyed route", async () => {
    await saveConceptDocs("my ws", "ref/1", "# Docs");

    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/my%20ws/graph/node/ref%2F1/docs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs: "# Docs" }),
    });
  });

  test("throws the server's error message on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "nope" }) });

    await expect(saveConceptDocs("ws", "r", "x")).rejects.toThrow("nope");
  });
});

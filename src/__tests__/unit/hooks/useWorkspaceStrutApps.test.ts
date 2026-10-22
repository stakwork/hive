import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceStrutApps } from "@/hooks/useWorkspaceStrutApps";
import { STRUT_APPS_CHANGED_EVENT } from "@/lib/strut-apps";

const mockFetch = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockImplementation(async () => json({ githubLogin: "stakwork", swarmId: "swarm-oh", apps: [] }));
});

describe("useWorkspaceStrutApps", () => {
  it("reads nothing without a slug", () => {
    const { result } = renderHook(() => useWorkspaceStrutApps(null));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reads the tabs again when a pin changes them on THIS swarm, not another", async () => {
    const { result } = renderHook(() => useWorkspaceStrutApps("openhealth"));
    await waitFor(() => expect(result.current.data?.swarmId).toBe("swarm-oh"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/workspaces/openhealth/strut/apps");

    act(() => {
      window.dispatchEvent(new CustomEvent(STRUT_APPS_CHANGED_EVENT, { detail: { swarmId: "swarm-other" } }));
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockImplementation(async () => json({ githubLogin: "stakwork", swarmId: "swarm-oh", apps: [{ name: "bench", title: "Bench" }] }));
    act(() => {
      window.dispatchEvent(new CustomEvent(STRUT_APPS_CHANGED_EVENT, { detail: { swarmId: "swarm-oh" } }));
    });
    await waitFor(() => expect(result.current.data?.apps).toEqual([{ name: "bench", title: "Bench" }]));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

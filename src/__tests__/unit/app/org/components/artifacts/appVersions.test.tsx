// @vitest-environment jsdom
/**
 * An app card's bar: the version picker (the live version unless the
 * reader picked another, every version listed newest first) and beside it
 * the pin — or, while an older version is shown, "Make vN live" in the
 * pin's place, an admin's, which sets it live for everyone and goes back
 * to the pin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "stakwork" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Radix's menu opens on pointer events jsdom does not dispatch: the items, flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

globalThis.React = React;

const { AppActions } = await import("@/app/org/[githubLogin]/_components/artifacts/viewers/appVersions");
const { appVersionsKey, useAppVersionsStore } = await import("@/app/org/[githubLogin]/_state/appVersionsStore");

const mockFetch = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KEY = appVersionsKey("swarm-oh", "acme/bench");
const VERSIONS = [
  { version: "v3", createdAt: "2026-10-23T04:39:14.000Z" },
  { version: "v2", createdAt: "2026-10-23T04:30:49.000Z" },
  { version: "v1", createdAt: "2026-10-22T21:23:42.000Z" },
];

async function show(canSetLive = true) {
  useAppVersionsStore.setState({ byApp: { [KEY]: { live: "v3", versions: VERSIONS, canSetLive } }, failed: {}, viewing: {} });
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/strut/apps/versions") && init?.method === "POST") return json({ live: JSON.parse(init.body as string).version });
    if (url.includes("/strut/apps/pin")) return json({ pinned: true, workspace: { slug: "openhealth", name: "Open Health" }, canPin: canSetLive });
    return json({ error: "unexpected" }, 500);
  });
  await act(async () => {
    render(<AppActions artifact={{ id: "a", kind: "app", title: "Bench" } as never} content={{ swarmId: "swarm-oh", app: "acme/bench" }} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("AppActions", () => {
  it("shows the live version, lists every version, and keeps the pin beside it", async () => {
    await show();
    expect(screen.getByRole("button", { name: "Version v3, live" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.slice(0, 2))).toEqual(["v3", "v2", "v1"]);
    expect(screen.getByRole("button", { name: "Pinned in Open Health · Unpin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make .* live/ })).not.toBeInTheDocument();
  });

  it("an older version picked puts 'Make vN live' in the pin's place; a click sets it live and the pin comes back", async () => {
    await show();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[2]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBe("v1");
    expect(screen.getByRole("button", { name: "Version v1" })).toHaveTextContent("not live");
    expect(screen.queryByRole("button", { name: /Unpin|Pin as a tab/ })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make v1 live" }));
    });
    const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/orgs/stakwork/strut/apps/versions");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ swarmId: "swarm-oh", app: "acme/bench", version: "v1" });
    expect(useAppVersionsStore.getState().byApp[KEY].live).toBe("v1");
    expect(useAppVersionsStore.getState().viewing[KEY]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Version v1, live" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pinned in Open Health · Unpin" })).toBeInTheDocument();
  });

  it("picking the live version follows it again", async () => {
    await show();
    act(() => useAppVersionsStore.getState().view(KEY, "v2"));
    expect(useAppVersionsStore.getState().viewing[KEY]).toBe("v2");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[0]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBeUndefined();
  });

  it("is disabled, with the reason, for someone who may not change the live version", async () => {
    await show(false);
    act(() => useAppVersionsStore.getState().view(KEY, "v2"));
    const button = screen.getByRole("button", { name: "Make v2 live" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", "Only an admin of the app's workspace can change which version is live");
  });
});

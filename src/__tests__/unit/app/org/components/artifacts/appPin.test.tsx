/**
 * The app card's "Pin as a tab in <workspace>": named for the workspace the
 * app's SWARM is, flipped by a click, disabled with the reason for a
 * non-admin, nothing shown when the state cannot be read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "stakwork" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AppPinAction, pinLabel } = await import("@/app/org/[githubLogin]/_components/artifacts/viewers/appPin");
const { STRUT_APPS_CHANGED_EVENT } = await import("@/lib/strut-apps");

const mockFetch = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const workspace = { slug: "openhealth", name: "Open Health" };

async function show(state: Record<string, unknown> | null) {
  mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return json({ pinned: JSON.parse(init.body as string).pinned, workspace });
    return state ? json(state) : json({ error: "No such app on the swarm" }, 404);
  });
  await act(async () => {
    render(<AppPinAction artifact={{ id: "a", kind: "app", title: "Bench" } as never} content={{ swarmId: "swarm-oh", app: "acme/bench" }} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("AppPinAction", () => {
  it("labels the tab with the swarm's workspace", () => {
    expect(pinLabel(false, "Open Health")).toBe("Pin as a tab in Open Health");
    expect(pinLabel(true, "Open Health")).toBe("Pinned in Open Health · Unpin");
  });

  it("reads the pin by swarm and app, and flips it on a click", async () => {
    const changed = vi.fn();
    window.addEventListener(STRUT_APPS_CHANGED_EVENT, changed);
    await show({ pinned: false, workspace, canPin: true });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/orgs/stakwork/strut/apps/pin?swarmId=swarm-oh&app=acme%2Fbench");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin as a tab in Open Health" }));
    });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("/api/orgs/stakwork/strut/apps/pin");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ swarmId: "swarm-oh", app: "acme/bench", pinned: true });
    expect(screen.getByRole("button", { name: "Pinned in Open Health · Unpin" })).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ swarmId: "swarm-oh" });
    // Pinning an app that follows latest holds it: its versions are read again.
    expect(mockFetch.mock.calls[2][0]).toBe("/api/orgs/stakwork/strut/apps/versions?swarmId=swarm-oh&app=acme%2Fbench");
    window.removeEventListener(STRUT_APPS_CHANGED_EVENT, changed);
  });

  it("is disabled, with the reason, for someone who may not pin", async () => {
    await show({ pinned: false, workspace, canPin: false });
    const button = screen.getByRole("button", { name: "Pin as a tab in Open Health" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", "Only an admin of Open Health can pin its tabs");
  });

  it("shows nothing when the state cannot be read", async () => {
    await show(null);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

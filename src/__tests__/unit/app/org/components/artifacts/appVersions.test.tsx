// @vitest-environment jsdom
/**
 * An app card's bar: the version picker (the live version, or the draft the
 * card names while the app is held, unless the reader picked another; every
 * version listed newest first, `live` and `draft` marked) and beside it the
 * pin — or, while another version is shown, "Make vN live" in the pin's
 * place, an admin's, which promotes it for everyone and goes back to the
 * pin. The picker's menu says what everyone sees and, for an admin, holds
 * the app at its live version, follows latest again, rolls back to a
 * release, or updates the workflows the live release locked. A strut
 * without releases shows none of that.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { STRUT_APPS_CHANGED_EVENT } from "@/lib/strut-apps";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "stakwork" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Radix's menu opens on pointer events jsdom does not dispatch: the items, flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onSelect, disabled, title }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; title?: string }) => (
    <button type="button" role="menuitem" disabled={disabled} title={title} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

globalThis.React = React;

const { AppActions } = await import("@/app/org/[githubLogin]/_components/artifacts/viewers/appVersions");
const { appVersionsKey, shownVersion, useAppVersionsStore } = await import("@/app/org/[githubLogin]/_state/appVersionsStore");
type AppVersions = import("@/app/org/[githubLogin]/_state/appVersionsStore").AppVersions;
const { toast } = await import("sonner");

const mockFetch = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KEY = appVersionsKey("swarm-oh", "acme/bench");
const v = (n: number, createdAt = "2026-10-23T04:39:14.000Z") => ({ version: `v${n}`, createdAt });
const lock = (workflows: Record<string, string> = {}) => ({ workflows, steps: {}, floating: [] });

/** An app that follows latest, on a strut with releases. */
const following = (over: Partial<AppVersions> = {}): AppVersions => ({
  live: "v3",
  versions: [v(3), v(2), v(1)],
  canSetLive: true,
  holdable: true,
  release: null,
  releases: [],
  behind: [],
  ...over,
});

/** The same app held at r2 (v3), published to v5 since: v4 and v5 are drafts. */
const held = (over: Partial<AppVersions> = {}): AppVersions =>
  following({
    versions: [v(5), v(4), v(3), v(2), v(1)],
    release: "r2",
    releases: [
      { id: "r1", version: "v1", createdAt: "2026-10-22T21:24:00.000Z", lock: lock({ "openhealth-run": "v12" }) },
      { id: "r2", version: "v3", createdAt: "2026-10-23T04:40:00.000Z", by: "evanfeenstra-cmb2x9k0a0000abcdefghijkl", lock: lock({ "openhealth-run": "v14" }) },
    ],
    ...over,
  });

/** What the swarm says now; a POST changes it the way strut would. */
let server: AppVersions;

async function show(read: AppVersions, named?: string) {
  server = read;
  useAppVersionsStore.setState({ byApp: { [KEY]: read }, failed: {}, viewing: {} });
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/strut/apps/versions") && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as { version?: string; release?: string };
      if (body.release) {
        const live = server.releases.find((r) => r.id === body.release)!.version;
        server = { ...server, live, release: body.release };
      } else if (body.version === "latest") {
        server = { ...server, live: server.versions[0].version, release: null, behind: [] };
      } else if (server.holdable) {
        const id = `r${server.releases.length + 1}`;
        server = { ...server, live: body.version!, release: id, releases: [...server.releases, { id, version: body.version!, lock: lock() }], behind: [] };
      } else {
        server = { ...server, live: body.version! };
      }
      return json({ live: server.live, release: server.release });
    }
    if (url.includes("/strut/apps/versions")) return json(server);
    if (url.includes("/strut/apps/pin")) return json({ pinned: true, workspace: { slug: "openhealth", name: "Open Health" }, canPin: read.canSetLive });
    return json({ error: "unexpected" }, 500);
  });
  await act(async () => {
    render(<AppActions artifact={{ id: "a", kind: "app", title: "Bench" } as never} content={{ swarmId: "swarm-oh", app: "acme/bench", ...(named ? { version: named } : {}) }} />);
  });
}

const posted = () =>
  mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)]);
const menuitem = (name: string | RegExp) => screen.findByRole("menuitem", { name });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("shownVersion", () => {
  it("the pick; else the card's draft; else live; else what the card named", () => {
    const read = held();
    expect(shownVersion(read, "v2", "v5")).toBe("v2");
    expect(shownVersion(read, undefined, "v5")).toBe("v5");
    expect(shownVersion(read, undefined, "v2")).toBe("v3");
    expect(shownVersion(read, undefined)).toBe("v3");
    expect(shownVersion(undefined, undefined, "v5")).toBe("v5");
    expect(shownVersion(undefined, undefined)).toBeUndefined();
  });

  it("a version a release made live is no draft: rolled back past it, the frame shows what is live", () => {
    // Rolled back from r2 (v3) to r1 (v1): the card still names v3.
    expect(shownVersion(held({ live: "v1", release: "r1" }), undefined, "v3")).toBe("v1");
  });

  it("following latest, a card newer than the read is shown (the read has not caught up)", () => {
    expect(shownVersion(following(), undefined, "v4")).toBe("v4");
  });
});

describe("AppActions, following latest", () => {
  it("shows the live version, lists every version, and keeps the pin beside it", async () => {
    await show(following());
    expect(screen.getByRole("button", { name: "Version v3, live" })).toBeInTheDocument();
    const versions = screen.getAllByRole("menuitem").filter((item) => /^v\d/.test(item.textContent ?? ""));
    expect(versions.map((item) => item.textContent?.slice(0, 2))).toEqual(["v3", "v2", "v1"]);
    expect(await screen.findByRole("button", { name: "Pinned in Open Health · Unpin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make .* live/ })).not.toBeInTheDocument();
    expect(screen.getByText("Following latest · v3")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Follow latest/ })).not.toBeInTheDocument();
  });

  it("'Hold at vN' promotes the live version, re-reads, and tells the tabs", async () => {
    await show(following());
    const changed = vi.fn();
    window.addEventListener(STRUT_APPS_CHANGED_EVENT, changed);
    const hold = await menuitem(/Hold at v3/);
    expect(hold).toHaveAttribute("title", expect.stringContaining("with its workflows as they are now"));
    await act(async () => {
      fireEvent.click(hold);
    });
    window.removeEventListener(STRUT_APPS_CHANGED_EVENT, changed);
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "v3" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v3", release: "r1", releases: [{ id: "r1", version: "v3" }] });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Held at v3 (r1)", expect.anything());
    expect(await screen.findByText("Held at r1 · v3")).toBeInTheDocument();
  });

  it("an older version picked puts 'Make vN live' in the pin's place; a click promotes it and the pin comes back", async () => {
    await show(following());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[2]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBe("v1");
    expect(screen.getByRole("button", { name: "Version v1" })).toHaveTextContent("not live");
    expect(screen.queryByRole("button", { name: /Unpin|Pin as a tab/ })).not.toBeInTheDocument();

    const make = await screen.findByRole("button", { name: "Make v1 live" });
    expect(make.parentElement).toHaveAttribute("title", "Everyone who opens the app sees v1, with its workflows as they are now");
    await act(async () => {
      fireEvent.click(make);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "v1" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v1", release: "r1" });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Version v1, live" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pinned in Open Health · Unpin" })).toBeInTheDocument();
  });

  it("picking the live version follows it again", async () => {
    await show(following());
    act(() => useAppVersionsStore.getState().view(KEY, "v2"));
    expect(useAppVersionsStore.getState().viewing[KEY]).toBe("v2");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[0]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBeUndefined();
  });
});

describe("AppActions, held at a release", () => {
  it("a card naming a draft shows it: marked draft, 'Make v5 live' beside it", async () => {
    await show(held(), "v5");
    expect(screen.getByRole("button", { name: "Version v5, draft" })).toBeInTheDocument();
    // A version's item: its label, its mark (when it has one), when it was published.
    const labels = Object.fromEntries(
      screen
        .getAllByRole("menuitem")
        .filter((item) => /^v\d/.test(item.textContent ?? ""))
        .map((item) => {
          const spans = [...item.querySelectorAll("span")].map((span) => span.textContent);
          return [spans[0], spans.length === 3 ? spans[1] : ""];
        }),
    );
    expect(labels).toEqual({ v5: "draft", v4: "draft", v3: "live", v2: "", v1: "" });
    expect(screen.getByText("Held at r2 · v3")).toBeInTheDocument();

    const make = await screen.findByRole("button", { name: "Make v5 live" });
    await act(async () => {
      fireEvent.click(make);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "v5" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v5", release: "r3" });
    expect(screen.getByRole("button", { name: "Version v5, live" })).toBeInTheDocument();
  });

  it("picking the live version while the card names a draft looks at the live one; picking the draft goes back", async () => {
    await show(held(), "v5");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[2]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBe("v3");
    expect(screen.getByRole("button", { name: "Version v3, live" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("menuitem")[0]);
    });
    expect(useAppVersionsStore.getState().viewing[KEY]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Version v5, draft" })).toBeInTheDocument();
  });

  it("'Follow latest' lets go of the hold: the newest version is live", async () => {
    await show(held());
    const follow = await menuitem(/Follow latest/);
    expect(follow).toHaveAttribute("title", "Every publish is live again: everyone sees the newest version, v5");
    await act(async () => {
      fireEvent.click(follow);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "latest" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v5", release: null });
    expect(await screen.findByText("Following latest · v5")).toBeInTheDocument();
  });

  it("lists the releases newest first, the live one checked and not clickable; another rolls back to it", async () => {
    await show(held());
    const r2 = await menuitem(/^r2 · v3 · /);
    expect(r2).toHaveTextContent(/ · evanfeenstra$/);
    expect(r2).toBeDisabled();
    const r1 = await menuitem(/^r1 · v1 · /);
    expect(r1).toHaveAttribute("title", "Make r1 live: everyone sees v1, with openhealth-run v12");
    expect(screen.getAllByRole("menuitem").filter((item) => /^r\d/.test(item.textContent ?? "")).map((item) => item.textContent?.slice(0, 2))).toEqual(["r2", "r1"]);
    await act(async () => {
      fireEvent.click(r1);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", release: "r1" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v1", release: "r1" });
    expect(toast.success).toHaveBeenCalledWith("r1 is live: everyone sees v1", expect.anything());
  });

  it("'Update workflows' only when the live release's lock has moved on; it re-promotes the live version", async () => {
    await show(held());
    expect(screen.queryByRole("menuitem", { name: /Update workflows/ })).not.toBeInTheDocument();
    cleanup();
    await show(
      held({
        behind: [
          { kind: "workflow", name: "openhealth-run", locked: "v14", current: "v17" },
          { kind: "step", name: "acme/score", locked: "v3", current: null },
        ],
      }),
    );
    const update = await menuitem(/Update workflows/);
    expect(update).toHaveTextContent("2 moved");
    expect(update.getAttribute("title")).toBe("v3 stays live and calls its workflows as they are now:\nopenhealth-run v14 → v17\nacme/score v3 → removed");
    await act(async () => {
      fireEvent.click(update);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "v3" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v3", release: "r3", behind: [] });
    expect(screen.queryByRole("menuitem", { name: /Update workflows/ })).not.toBeInTheDocument();
  });

  it("a refusal from the swarm is a toast, and nothing changes", async () => {
    await show(held());
    mockFetch.mockImplementation(async () => json({ error: 'release r1 locks workflow "openhealth-old", which no longer exists' }, 409));
    await act(async () => {
      fireEvent.click(await menuitem(/^r1 · /));
    });
    expect(toast.error).toHaveBeenCalledWith('release r1 locks workflow "openhealth-old", which no longer exists', expect.anything());
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v3", release: "r2" });
  });
});

describe("AppActions, someone who may not change what is live", () => {
  it("'Make vN live' is disabled with the reason; the hold section says why and offers nothing", async () => {
    await show(held({ canSetLive: false }), "v5");
    const button = await screen.findByRole("button", { name: "Make v5 live" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", "Only an admin of the app's workspace can change which version is live");
    expect(screen.getByText("Only an admin of the app's workspace can change which version is live")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Follow latest|Hold at|Update workflows/ })).not.toBeInTheDocument();
    expect(await menuitem(/^r1 · /)).toBeDisabled();
  });
});

describe("AppActions, a strut without releases", () => {
  it("shows no hold: no mode, no releases, and 'Make vN live' makes it live as before", async () => {
    await show(following({ holdable: false }));
    expect(screen.queryByText(/Following latest|Held at/)).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Hold at|Follow latest|Update workflows|^r\d/ })).not.toBeInTheDocument();
    act(() => useAppVersionsStore.getState().view(KEY, "v2"));
    const make = await screen.findByRole("button", { name: "Make v2 live" });
    expect(make.parentElement).toHaveAttribute("title", "Everyone who opens the app sees v2");
    await act(async () => {
      fireEvent.click(make);
    });
    expect(posted()).toEqual([["/api/orgs/stakwork/strut/apps/versions", { swarmId: "swarm-oh", app: "acme/bench", version: "v2" }]]);
    expect(useAppVersionsStore.getState().byApp[KEY]).toMatchObject({ live: "v2", release: null });
  });
});

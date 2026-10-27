// @vitest-environment jsdom
/**
 * RTL tests for the org page's chat list: a row is its title; jobs nest
 * under their chat (the newest, then "N more"); the PR glyph lists the
 * pull requests and opens them; archive / restore never click through to
 * the row; Archive rows show only while the section is open.
 */
import React from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ControlPanelList } from "@/app/org/[githubLogin]/_components/control-panel/ControlPanelList";
import type { ControlPanelListProps } from "@/app/org/[githubLogin]/_components/control-panel/ControlPanelList";
import type { ControlPanelItem, ControlPanelPullRequest } from "@/types/control-panel";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Radix menus and hover cards open on pointer events jsdom does not fire; render their content inline.
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
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="pr-card">{children}</div>,
}));

function pr(number: number, state: ControlPanelPullRequest["state"], jobId?: string): ControlPanelPullRequest {
  return {
    identity: `pull_request:acme/app#${number}`,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    repo: "acme/app",
    number,
    state,
    jobId,
  };
}

function item(id: string, overrides: Partial<ControlPanelItem> = {}): ControlPanelItem {
  return {
    id,
    title: `Chat ${id}`,
    lastActivityAt: "2026-09-04T10:00:00.000Z",
    working: false,
    jobs: [],
    pullRequests: [],
    ...overrides,
  };
}

function props(overrides: Partial<ControlPanelListProps> = {}): ControlPanelListProps {
  return {
    groups: [],
    totalCount: 0,
    loading: false,
    query: "",
    onQueryChange: vi.fn(),
    cursorId: null,
    activeId: null,
    onOpen: vi.fn(),
    onOpenJob: vi.fn(),
    onOpenPullRequest: vi.fn(),
    remaining: 0,
    onShowMore: vi.fn(),
    archivedItems: [],
    archivedExpanded: false,
    onToggleArchived: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onRename: vi.fn(),
    onNewChat: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
}

const group = (...items: ControlPanelItem[]) => [{ key: "2026-09-04", label: "Today", items }];

describe("ControlPanelList", () => {
  test("a row is its title under its day; clicking opens it", () => {
    const onOpen = vi.fn();
    const chat = item("a", { title: "Auto-set the default workspace" });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1, activeId: "a", onOpen })} />);

    expect(screen.getByText("Today")).toBeTruthy();
    const row = screen.getByRole("button", { name: "Auto-set the default workspace" });
    expect(row.getAttribute("aria-current")).toBe("page");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(chat);
  });

  test("jobs nest under their chat: the newest, the rest behind N more", () => {
    const onOpenJob = vi.fn();
    const jobs = ["Newest job", "Older job", "Oldest job"].map((title, i) => ({
      id: `j${i}`,
      title,
      working: i === 0,
      lastActivityAt: "2026-09-04T10:00:00.000Z",
    }));
    const chat = item("a", { jobs });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1, onOpenJob })} />);

    expect(screen.getByText("Newest job")).toBeTruthy();
    expect(screen.queryByText("Older job")).toBeNull();
    expect(screen.getByLabelText("Working")).toBeTruthy();

    fireEvent.click(screen.getByText("2 more"));
    expect(screen.getByText("Oldest job")).toBeTruthy();

    fireEvent.click(screen.getByText("Older job"));
    expect(onOpenJob).toHaveBeenCalledWith(chat, jobs[1]);
  });

  test("the PR glyph counts the chat's PRs and opens the one picked without opening the chat", () => {
    const onOpen = vi.fn();
    const onOpenPullRequest = vi.fn();
    const prs = [pr(7, "merged"), pr(8, "open")];
    const chat = item("a", { pullRequests: prs });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1, onOpen, onOpenPullRequest })} />);

    expect(screen.getByLabelText("2 pull requests").textContent).toContain("2");
    const card = screen.getByTestId("pr-card");
    expect(within(card).getByText("Merged")).toBeTruthy();
    expect(within(card).getByText("acme/app #8")).toBeTruthy();

    fireEvent.click(within(card).getByText("PR 8"));
    expect(onOpenPullRequest).toHaveBeenCalledWith(chat, prs[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("a job row shows only the PRs its job reported", () => {
    const chat = item("a", {
      jobs: [{ id: "j1", title: "Backfill", working: false, lastActivityAt: "2026-09-04T10:00:00.000Z" }],
      pullRequests: [pr(7, "open", "j1"), pr(8, "open")],
    });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1 })} />);
    // The chat row has both; the job row has its one.
    expect(screen.getByLabelText("2 pull requests")).toBeTruthy();
    expect(screen.getByLabelText("1 pull request")).toBeTruthy();
  });

  test("archive and restore act on the chat without opening it; Archive rows show only while open", () => {
    const onOpen = vi.fn();
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    const active = item("a");
    const archived = item("z", { title: "Old chat", archivedAt: "2026-09-01T00:00:00.000Z" });
    const base = { groups: group(active), totalCount: 1, archivedItems: [archived], onOpen, onArchive, onRestore };

    const { rerender } = render(<ControlPanelList {...props(base)} />);
    expect(screen.queryByText("Old chat")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));
    expect(onArchive).toHaveBeenCalledWith(active);

    rerender(<ControlPanelList {...props({ ...base, archivedExpanded: true })} />);
    expect(screen.getByText("Old chat")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Restore/ }));
    expect(onRestore).toHaveBeenCalledWith(archived);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("rename: Enter saves the trimmed title, Escape and blank cancel", () => {
    const onRename = vi.fn();
    const chat = item("a", { title: "Old title" });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1, onRename })} />);
    const edit = () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
      return screen.getByLabelText("Chat title");
    };

    let input = edit();
    fireEvent.change(input, { target: { value: "  New title  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(chat, "New title");
    expect(screen.queryByLabelText("Chat title")).toBeNull();

    onRename.mockClear();
    input = edit();
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();

    input = edit();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();

    input = edit();
    fireEvent.change(input, { target: { value: "Blur save" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith(chat, "Blur save");
  });

  test("rename: the input is present and focused after choosing Rename", () => {
    const chat = item("a", { title: "Old title" });
    render(<ControlPanelList {...props({ groups: group(chat), totalCount: 1 })} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const input = screen.getByLabelText("Chat title") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Old title".length);
  });

  test("empty states: loading, nothing yet, no match; Show more only when there are more", () => {
    const { rerender } = render(<ControlPanelList {...props({ loading: true })} />);
    expect(screen.getByLabelText("Loading chats")).toBeTruthy();

    rerender(<ControlPanelList {...props()} />);
    expect(screen.getByText("No chats yet.")).toBeTruthy();

    rerender(<ControlPanelList {...props({ query: "zzz", totalCount: 3 })} />);
    expect(screen.getByText("No chats match.")).toBeTruthy();

    const onShowMore = vi.fn();
    rerender(<ControlPanelList {...props({ groups: group(item("a")), totalCount: 1, remaining: 5, onShowMore })} />);
    fireEvent.click(screen.getByText("Show more"));
    expect(onShowMore).toHaveBeenCalled();
  });
});

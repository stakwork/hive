// @vitest-environment jsdom
/**
 * RTL tests for the control-panel left bar: empty-state copy when Archive
 * is populated vs empty, archive/restore actions that stop row click-through,
 * and keyboard-reachable Archive rows only while the section is expanded.
 */
import React from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ControlPanelList } from "@/app/org/[githubLogin]/_components/control-panel/ControlPanelList";
import type { ControlPanelListProps } from "@/app/org/[githubLogin]/_components/control-panel/ControlPanelList";
import type { ControlPanelItem } from "@/types/control-panel";
import type { ControlPanelGroup, ControlPanelRow } from "@/services/orgs/control-panel-state";

// jsdom does not implement scrollIntoView; ControlPanelList scrolls the cursor row into view.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      layout: _layout,
      layoutDependency: _layoutDependency,
      layoutScroll: _layoutScroll,
      transition: _transition,
      ...rest
    }: {
      children?: React.ReactNode;
      layout?: unknown;
      layoutDependency?: unknown;
      layoutScroll?: unknown;
      transition?: unknown;
    }) => React.createElement("div", rest, children),
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <span>{children}</span>,
}));

// kbd.tsx uses `React.ComponentProps` / JSX without importing React, which
// blows up under vitest's transform. The footer shortcuts are not under test.
vi.mock("@/components/ui/kbd", () => ({
  Kbd: ({ children }: { children?: React.ReactNode }) => <kbd>{children}</kbd>,
  KbdGroup: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

function makeItem(overrides: Partial<ControlPanelItem>): ControlPanelItem {
  const id = overrides.id ?? "x";
  const kind = overrides.kind ?? "chat";
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    title: overrides.title ?? "Chat",
    workspaceSlug: null,
    workspaceId: null,
    workspaceName: null,
    lastActivityAt: "2026-09-04T10:00:00.000Z",
    sinceYou: "",
    state: "none",
    unread: false,
    ...overrides,
  };
}

function emptyProps(overrides: Partial<ControlPanelListProps> = {}): ControlPanelListProps {
  return {
    groups: [],
    totalCount: 0,
    loading: false,
    query: "",
    onQueryChange: vi.fn(),
    expandedKeys: new Set(),
    onToggleExpanded: vi.fn(),
    cursorKey: null,
    focusedKey: null,
    onOpen: vi.fn(),
    remaining: 0,
    onShowMore: vi.fn(),
    archivedRows: [],
    archivedExpanded: false,
    onToggleArchived: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  };
}

function chatRow(item: ControlPanelItem, extra: Partial<ControlPanelRow> = {}): ControlPanelRow {
  return { item, depth: 0, childCount: 0, latestAt: item.lastActivityAt, ...extra };
}

describe("ControlPanelList empty states", () => {
  test("both empty shows the whole-column empty copy", () => {
    render(<ControlPanelList {...emptyProps()} />);
    expect(screen.getByText("Nothing yet. Start a Jamie chat and it lands here.")).toBeInTheDocument();
    expect(screen.queryByTestId("control-panel-archive")).not.toBeInTheDocument();
  });

  test("active empty + Archive populated does not show Nothing yet, and still renders Archive", () => {
    const archived = makeItem({ id: "archived-1", title: "Finished kickoff", archivedAt: "2026-09-03T00:00:00.000Z" });
    render(
      <ControlPanelList
        {...emptyProps({
          totalCount: 0,
          archivedRows: [chatRow(archived)],
          archivedExpanded: true,
        })}
      />,
    );
    expect(screen.queryByText("Nothing yet. Start a Jamie chat and it lands here.")).not.toBeInTheDocument();
    expect(screen.getByTestId("control-panel-archive")).toBeInTheDocument();
    expect(screen.getByText("Finished kickoff")).toBeInTheDocument();
  });

  test("empty Archive section shows short empty copy when expanded", () => {
    const active = makeItem({ id: "c1", title: "Live chat" });
    const groups: ControlPanelGroup[] = [
      { key: "2026-09-04", label: "Today", rows: [chatRow(active)] },
    ];
    render(
      <ControlPanelList
        {...emptyProps({
          groups,
          totalCount: 1,
          archivedRows: [],
          archivedExpanded: true,
        })}
      />,
    );
    expect(screen.getByText("No archived chats")).toBeInTheDocument();
  });
});

describe("ControlPanelList archive actions", () => {
  test("Archive action stops propagation and does not call onOpen", () => {
    const active = makeItem({ id: "c1", title: "Live chat" });
    const onOpen = vi.fn();
    const onArchive = vi.fn();
    const groups: ControlPanelGroup[] = [
      { key: "2026-09-04", label: "Today", rows: [chatRow(active)] },
    ];
    render(
      <ControlPanelList
        {...emptyProps({
          groups,
          totalCount: 1,
          onOpen,
          onArchive,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("Restore action stops propagation and does not call onOpen", () => {
    const archived = makeItem({ id: "a1", title: "Old chat", archivedAt: "2026-09-03T00:00:00.000Z" });
    const onOpen = vi.fn();
    const onRestore = vi.fn();
    render(
      <ControlPanelList
        {...emptyProps({
          archivedRows: [chatRow(archived)],
          archivedExpanded: true,
          onOpen,
          onRestore,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("ControlPanelList archive keyboard rows", () => {
  test("collapsed Archive does not render archived chat rows", () => {
    const archived = makeItem({ id: "a1", title: "Old chat", archivedAt: "2026-09-03T00:00:00.000Z" });
    const active = makeItem({ id: "c1", title: "Live chat" });
    render(
      <ControlPanelList
        {...emptyProps({
          groups: [{ key: "2026-09-04", label: "Today", rows: [chatRow(active)] }],
          totalCount: 1,
          archivedRows: [chatRow(archived)],
          archivedExpanded: false,
        })}
      />,
    );
    expect(screen.getByText("Live chat")).toBeInTheDocument();
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();
    expect(document.querySelector('[data-panel-key="chat:a1"]')).toBeNull();
  });

  test("expanded Archive renders archived rows that Enter can open via onOpen", () => {
    const archived = makeItem({ id: "a1", title: "Old chat", archivedAt: "2026-09-03T00:00:00.000Z" });
    const onOpen = vi.fn();
    render(
      <ControlPanelList
        {...emptyProps({
          archivedRows: [chatRow(archived)],
          archivedExpanded: true,
          cursorKey: "chat:a1",
          onOpen,
        })}
      />,
    );
    const row = document.querySelector('[data-panel-key="chat:a1"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
  });
});

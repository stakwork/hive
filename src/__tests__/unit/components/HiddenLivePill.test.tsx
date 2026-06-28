// @vitest-environment jsdom
/**
 * Unit tests for HiddenLivePill.
 *
 * Verifies:
 * 1. Renders nothing when entries list is empty
 * 2. Pill trigger button has correct `right` style (default rightInset=0 → right: 16)
 * 3. Pill trigger button has correct `right` style with rightInset=400 → right: 416
 * 4. Expanded modal is shown on click and uses right: 0 (relative to parent)
 * 5. Snapshot regression when rightInset is omitted (default behaviour)
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  HiddenLivePill,
  type HiddenLiveEntry,
} from "@/app/org/[githubLogin]/connections/HiddenLivePill";

const sampleEntries: HiddenLiveEntry[] = [
  { id: "ws:abc", name: "My Workspace", kind: "ws" },
  { id: "ws:def", name: "Another Workspace", kind: "ws" },
];

describe("HiddenLivePill", () => {
  it("renders nothing when entries list is empty", () => {
    const { container } = render(
      <HiddenLivePill entries={[]} onRestore={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("pill root has right: 16 when rightInset is omitted (default)", () => {
    const { container } = render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.right).toBe("16px");
  });

  it("pill root has right: 16 when rightInset=0 is explicit", () => {
    const { container } = render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} rightInset={0} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.right).toBe("16px");
  });

  it("pill root has right: 416px when rightInset=400", () => {
    const { container } = render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} rightInset={400} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.right).toBe("416px");
  });

  it("pill root has CSS transition on right", () => {
    const { container } = render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} rightInset={0} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.transition).toContain("right 200ms ease");
  });

  it("expanded modal appears when pill is clicked", () => {
    render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} rightInset={0} />
    );
    const button = screen.getByRole("button", { name: /hidden list/i });
    fireEvent.click(button);
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("Another Workspace")).toBeInTheDocument();
  });

  it("shows entry count in the pill button", () => {
    render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} />
    );
    expect(screen.getByText(/2 hidden/i)).toBeInTheDocument();
  });

  it("calls onRestore with the correct id when Restore is clicked", async () => {
    const onRestore = vi.fn();
    render(
      <HiddenLivePill entries={sampleEntries} onRestore={onRestore} />
    );
    fireEvent.click(screen.getByRole("button", { name: /hidden list/i }));
    const restoreButtons = screen.getAllByRole("button", { name: /restore/i });
    fireEvent.click(restoreButtons[0]);
    expect(onRestore).toHaveBeenCalledWith("ws:abc");
  });

  it("snapshot — default rightInset behaviour (no regression)", () => {
    const { container } = render(
      <HiddenLivePill entries={sampleEntries} onRestore={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

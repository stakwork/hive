import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TaskFilters } from "@/components/tasks/TaskFilters";

/** Open a Radix UI DropdownMenu trigger in jsdom (requires PointerEvent polyfill in setup). */
async function openDropdown(trigger: Element) {
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    fireEvent.click(trigger);
  });
}

describe("TaskFilters Component", () => {
  const defaultProps = {
    filters: {},
    onFiltersChange: vi.fn(),
    onClearFilters: vi.fn(),
  };

  it("renders all four filter dropdowns", () => {
    render(<TaskFilters {...defaultProps} />);

    expect(screen.getByTestId("task-filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("task-filter-priority")).toBeInTheDocument();
    expect(screen.getByTestId("task-filter-source")).toBeInTheDocument();
    expect(screen.getByTestId("task-filter-pod")).toBeInTheDocument();
  });

  it("does not show clear button when no filters are active", () => {
    render(<TaskFilters {...defaultProps} />);

    expect(screen.queryByTestId("clear-filters-button")).not.toBeInTheDocument();
  });

  it("shows clear button when any filter is active", () => {
    render(
      <TaskFilters
        {...defaultProps}
        filters={{ status: "running" }}
      />
    );

    expect(screen.getByTestId("clear-filters-button")).toBeInTheDocument();
  });

  it("calls onClearFilters when clear button is clicked", () => {
    const onClearFilters = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        filters={{ status: "running" }}
        onClearFilters={onClearFilters}
      />
    );

    fireEvent.click(screen.getByTestId("clear-filters-button"));

    expect(onClearFilters).toHaveBeenCalled();
  });

  it("calls onFiltersChange with correct status value when Running is selected", async () => {
    const onFiltersChange = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    await openDropdown(screen.getByTestId("task-filter-status").querySelector("button")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Running" }));

    expect(onFiltersChange).toHaveBeenCalledWith({ status: "running" });
  });

  it("calls onFiltersChange with correct priority value when HIGH is selected", async () => {
    const onFiltersChange = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    await openDropdown(screen.getByTestId("task-filter-priority").querySelector("button")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "High" }));

    expect(onFiltersChange).toHaveBeenCalledWith({ priority: "HIGH" });
  });

  it("calls onFiltersChange with correct sourceType value when USER is selected", async () => {
    const onFiltersChange = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    await openDropdown(screen.getByTestId("task-filter-source").querySelector("button")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "User" }));

    expect(onFiltersChange).toHaveBeenCalledWith({ sourceType: "USER" });
  });

  it("calls onFiltersChange with hasPod boolean true when Has Pod is selected", async () => {
    const onFiltersChange = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />
    );

    await openDropdown(screen.getByTestId("task-filter-pod").querySelector("button")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Has Pod" }));

    expect(onFiltersChange).toHaveBeenCalledWith({ hasPod: true });
  });

  it("removes status key from filters when All is selected", async () => {
    const onFiltersChange = vi.fn();

    render(
      <TaskFilters
        {...defaultProps}
        filters={{ status: "running" }}
        onFiltersChange={onFiltersChange}
      />
    );

    await openDropdown(screen.getByTestId("task-filter-status").querySelector("button")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "All" }));

    expect(onFiltersChange).toHaveBeenCalledWith({});
  });
});

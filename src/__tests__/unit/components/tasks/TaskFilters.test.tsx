import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskFilters, TaskFiltersType } from "@/components/tasks/TaskFilters";

describe("TaskFilters Component", () => {
  it("should render filters button", () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    expect(screen.getByTestId("task-filters-button")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("should show active filter count when filters are applied", () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{ sourceType: "USER", priority: "HIGH" }}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("should show clear filters button when filters are active", () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{ sourceType: "USER" }}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    expect(screen.getByTestId("clear-filters-button")).toBeInTheDocument();
  });

  it("should not show clear filters button when no filters are active", () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    expect(screen.queryByTestId("clear-filters-button")).not.toBeInTheDocument();
  });

  it("should open popover when filters button is clicked", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("task-filters-popover")).toBeInTheDocument();
    });
  });

  it("should call onFiltersChange when sourceType filter is selected", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-sourceType-USER")).toBeInTheDocument();
    });

    const userCheckbox = screen.getByTestId("filter-sourceType-USER");
    fireEvent.click(userCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ sourceType: "USER" });
  });

  it("should call onFiltersChange when priority filter is selected", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-priority-HIGH")).toBeInTheDocument();
    });

    const highPriorityCheckbox = screen.getByTestId("filter-priority-HIGH");
    fireEvent.click(highPriorityCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ priority: "HIGH" });
  });

  it("should call onFiltersChange when status filter is selected", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-status-running")).toBeInTheDocument();
    });

    const runningCheckbox = screen.getByTestId("filter-status-running");
    fireEvent.click(runningCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ status: "running" });
  });

  it("should call onFiltersChange to remove filter when already selected checkbox is clicked", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{ sourceType: "USER" }}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-sourceType-USER")).toBeInTheDocument();
    });

    const userCheckbox = screen.getByTestId("filter-sourceType-USER");
    fireEvent.click(userCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({});
  });

  it("should call onClearFilters when clear button is clicked", () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{ sourceType: "USER", priority: "HIGH" }}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const clearButton = screen.getByTestId("clear-filters-button");
    fireEvent.click(clearButton);

    expect(mockOnClearFilters).toHaveBeenCalled();
  });

  it("should handle multiple filters selection", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-sourceType-USER")).toBeInTheDocument();
    });

    const userCheckbox = screen.getByTestId("filter-sourceType-USER");
    fireEvent.click(userCheckbox);
    expect(mockOnFiltersChange).toHaveBeenCalledWith({ sourceType: "USER" });

    const highPriorityCheckbox = screen.getByTestId("filter-priority-HIGH");
    fireEvent.click(highPriorityCheckbox);
    expect(mockOnFiltersChange).toHaveBeenCalledWith({ priority: "HIGH" });
  });

  it("should render hasPod filter options", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-hasPod-true")).toBeInTheDocument();
      expect(screen.getByTestId("filter-hasPod-false")).toBeInTheDocument();
    });
  });

  it("should call onFiltersChange when hasPod filter is selected", async () => {
    const mockOnFiltersChange = vi.fn();
    const mockOnClearFilters = vi.fn();

    render(
      <TaskFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        onClearFilters={mockOnClearFilters}
      />
    );

    const filtersButton = screen.getByTestId("task-filters-button");
    fireEvent.click(filtersButton);

    await waitFor(() => {
      expect(screen.getByTestId("filter-hasPod-true")).toBeInTheDocument();
    });

    const hasPodCheckbox = screen.getByTestId("filter-hasPod-true");
    fireEvent.click(hasPodCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ hasPod: true });
  });
});

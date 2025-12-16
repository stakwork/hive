import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FilterButton } from "@/components/filters/FilterButton";

describe("FilterButton", () => {
  describe("Rendering", () => {
    it("renders filter button with correct label", () => {
      render(<FilterButton />);
      const button = screen.getByRole("button", { name: /filter tasks/i });
      expect(button).toBeInTheDocument();
    });

    it("renders filter icon", () => {
      const { container } = render(<FilterButton />);
      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it("does not show badge when no filters are active", () => {
      render(<FilterButton />);
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("renders with initial filter state", () => {
      render(<FilterButton initialFilters={{ isRunning: true, hasPodAttached: false }} />);
      const button = screen.getByRole("button", { name: /filter tasks/i });
      expect(within(button).getByText("1")).toBeInTheDocument();
    });
  });

  describe("Popover Interactions", () => {
    it("opens popover when button is clicked", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      await user.click(button);
      
      expect(screen.getByLabelText(/running tasks/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/has pod attached/i)).toBeInTheDocument();
    });

    it("closes popover when button is clicked again", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      await user.click(button);
      expect(screen.getByLabelText(/running tasks/i)).toBeInTheDocument();
      
      await user.click(button);
      expect(screen.queryByLabelText(/running tasks/i)).not.toBeInTheDocument();
    });

    it("popover is initially closed", () => {
      render(<FilterButton />);
      expect(screen.queryByLabelText(/running tasks/i)).not.toBeInTheDocument();
    });
  });

  describe("Filter Checkboxes", () => {
    it("toggles running tasks checkbox", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      const checkbox = screen.getByRole("checkbox", { name: /running tasks/i });
      
      expect(checkbox).not.toBeChecked();
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it("toggles has pod attached checkbox", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      const checkbox = screen.getByRole("checkbox", { name: /has pod attached/i });
      
      expect(checkbox).not.toBeChecked();
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it("allows both checkboxes to be checked simultaneously", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      
      const runningCheckbox = screen.getByRole("checkbox", { name: /running tasks/i });
      const podCheckbox = screen.getByRole("checkbox", { name: /has pod attached/i });
      
      await user.click(runningCheckbox);
      await user.click(podCheckbox);
      
      expect(runningCheckbox).toBeChecked();
      expect(podCheckbox).toBeChecked();
    });

    it("shows correct initial checkbox state", async () => {
      const user = userEvent.setup();
      render(<FilterButton initialFilters={{ isRunning: true, hasPodAttached: false }} />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      
      expect(screen.getByRole("checkbox", { name: /running tasks/i })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /has pod attached/i })).not.toBeChecked();
    });
  });

  describe("Active Filter Count Badge", () => {
    it("shows badge with count 1 when one filter is active", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      expect(within(button).getByText("1")).toBeInTheDocument();
    });

    it("shows badge with count 2 when both filters are active", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /has pod attached/i }));
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      expect(within(button).getByText("2")).toBeInTheDocument();
    });

    it("hides badge when no filters are active", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      expect(within(button).getByText("1")).toBeInTheDocument();
      
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      expect(within(button).queryByText("1")).not.toBeInTheDocument();
    });
  });

  describe("Clear Filters Button", () => {
    it("does not show clear button when no filters are active", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
    });

    it("shows clear button when filters are active", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
    });

    it("clears all filters when clear button is clicked", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      
      const runningCheckbox = screen.getByRole("checkbox", { name: /running tasks/i });
      const podCheckbox = screen.getByRole("checkbox", { name: /has pod attached/i });
      
      await user.click(runningCheckbox);
      await user.click(podCheckbox);
      
      expect(runningCheckbox).toBeChecked();
      expect(podCheckbox).toBeChecked();
      
      await user.click(screen.getByRole("button", { name: /clear filters/i }));
      
      expect(runningCheckbox).not.toBeChecked();
      expect(podCheckbox).not.toBeChecked();
    });

    it("hides clear button after clearing filters", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      const clearButton = screen.getByRole("button", { name: /clear filters/i });
      await user.click(clearButton);
      
      expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
    });
  });

  describe("onFilterChange Callback", () => {
    it("calls onFilterChange when running tasks filter changes", async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<FilterButton onFilterChange={onFilterChange} />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      expect(onFilterChange).toHaveBeenCalledWith({
        isRunning: true,
        hasPodAttached: false,
      });
    });

    it("calls onFilterChange when pod attached filter changes", async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<FilterButton onFilterChange={onFilterChange} />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /has pod attached/i }));
      
      expect(onFilterChange).toHaveBeenCalledWith({
        isRunning: false,
        hasPodAttached: true,
      });
    });

    it("calls onFilterChange with both filters true", async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<FilterButton onFilterChange={onFilterChange} />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /has pod attached/i }));
      
      expect(onFilterChange).toHaveBeenLastCalledWith({
        isRunning: true,
        hasPodAttached: true,
      });
    });

    it("calls onFilterChange when clear filters is clicked", async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<FilterButton onFilterChange={onFilterChange} />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      await user.click(screen.getByRole("button", { name: /clear filters/i }));
      
      expect(onFilterChange).toHaveBeenLastCalledWith({
        isRunning: false,
        hasPodAttached: false,
      });
    });

    it("does not call onFilterChange if callback not provided", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      await user.click(screen.getByRole("checkbox", { name: /running tasks/i }));
      
      // Test should not throw error
      expect(screen.getByRole("checkbox", { name: /running tasks/i })).toBeChecked();
    });
  });

  describe("Accessibility", () => {
    it("has accessible label for filter button", () => {
      render(<FilterButton />);
      expect(screen.getByRole("button", { name: /filter tasks/i })).toHaveAccessibleName();
    });

    it("has proper labels for checkboxes", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      
      expect(screen.getByLabelText(/running tasks/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/has pod attached/i)).toBeInTheDocument();
    });

    it("checkbox labels are properly associated with inputs", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      await user.click(screen.getByRole("button", { name: /filter tasks/i }));
      
      const runningLabel = screen.getByText(/running tasks/i);
      const runningCheckbox = screen.getByRole("checkbox", { name: /running tasks/i });
      
      expect(runningLabel).toHaveAttribute("for", runningCheckbox.id);
    });

    it("supports keyboard navigation", async () => {
      const user = userEvent.setup();
      render(<FilterButton />);
      
      const button = screen.getByRole("button", { name: /filter tasks/i });
      button.focus();
      
      await user.keyboard("{Enter}");
      expect(screen.getByLabelText(/running tasks/i)).toBeInTheDocument();
    });
  });
});

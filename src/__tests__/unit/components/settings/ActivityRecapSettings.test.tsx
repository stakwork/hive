import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityRecapSettings } from "@/components/settings/ActivityRecapSettings";
import { toast } from "sonner";

vi.mock("sonner");

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, id }: any) => (
    <button
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
      data-testid="activity-recap-switch"
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

describe("ActivityRecapSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders with toggle off when activityRecapEnabled=false from the API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ activityRecapEnabled: false }),
    });

    render(<ActivityRecapSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId("activity-recap-switch");
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("renders with toggle on when activityRecapEnabled=true from the API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ activityRecapEnabled: true }),
    });

    render(<ActivityRecapSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId("activity-recap-switch");
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("clicking toggle calls PATCH /api/user/preferences with { activityRecapEnabled: true }", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ activityRecapEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ activityRecapEnabled: true }),
      });

    render(<ActivityRecapSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("activity-recap-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("activity-recap-switch"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ activityRecapEnabled: true }),
        })
      );
    });
  });

  it("on success shows success toast", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ activityRecapEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ activityRecapEnabled: true }),
      });

    render(<ActivityRecapSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("activity-recap-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("activity-recap-switch"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Preference saved");
    });
  });

  it("on API error shows error toast and reverts toggle to previous state", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ activityRecapEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

    render(<ActivityRecapSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("activity-recap-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("activity-recap-switch"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to save preference");
      expect(screen.getByTestId("activity-recap-switch")).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });
  });
});

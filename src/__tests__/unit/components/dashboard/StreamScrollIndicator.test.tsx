// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

// framer-motion: AnimatePresence exits are async; stub to render children synchronously
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className} {...rest}>{children}</div>
    ),
    span: ({ children, className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span className={className} {...rest}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { StreamScrollIndicator } from "@/components/dashboard/DashboardChat/StreamScrollIndicator";

const noop = vi.fn();

const defaultProps = {
  isStreaming: false,
  userScrolledUp: false,
  showBackButton: false,
  onStreamingClick: noop,
  onLatestClick: noop,
  onBackClick: noop,
};

describe("StreamScrollIndicator", () => {
  test("renders nothing when all flags are false", () => {
    const { container } = render(<StreamScrollIndicator {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders streaming pill when isStreaming=true and userScrolledUp=true", () => {
    render(
      <StreamScrollIndicator
        {...defaultProps}
        isStreaming={true}
        userScrolledUp={true}
      />
    );
    expect(screen.getByText(/Streaming/)).toBeInTheDocument();
    expect(screen.queryByText(/Latest response/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Back/)).not.toBeInTheDocument();
  });

  test("renders latest-response pill when isStreaming=false and userScrolledUp=true", () => {
    render(
      <StreamScrollIndicator
        {...defaultProps}
        isStreaming={false}
        userScrolledUp={true}
      />
    );
    expect(screen.getByText(/Latest response/)).toBeInTheDocument();
    expect(screen.queryByText(/Streaming/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Back/)).not.toBeInTheDocument();
  });

  test("renders back pill when showBackButton=true (regardless of other flags)", () => {
    render(
      <StreamScrollIndicator
        {...defaultProps}
        showBackButton={true}
        userScrolledUp={false}
        isStreaming={false}
      />
    );
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.queryByText(/Streaming/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest response/)).not.toBeInTheDocument();
  });

  test("showBackButton takes priority over streaming state", () => {
    render(
      <StreamScrollIndicator
        {...defaultProps}
        showBackButton={true}
        userScrolledUp={true}
        isStreaming={true}
      />
    );
    // Back button wins
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.queryByText(/Streaming/)).not.toBeInTheDocument();
  });

  test("clicking streaming pill calls onStreamingClick", async () => {
    const onStreamingClick = vi.fn();
    render(
      <StreamScrollIndicator
        {...defaultProps}
        isStreaming={true}
        userScrolledUp={true}
        onStreamingClick={onStreamingClick}
      />
    );
    await userEvent.click(screen.getByText(/Streaming/));
    expect(onStreamingClick).toHaveBeenCalledTimes(1);
  });

  test("clicking latest-response pill calls onLatestClick", async () => {
    const onLatestClick = vi.fn();
    render(
      <StreamScrollIndicator
        {...defaultProps}
        isStreaming={false}
        userScrolledUp={true}
        onLatestClick={onLatestClick}
      />
    );
    await userEvent.click(screen.getByText(/Latest response/));
    expect(onLatestClick).toHaveBeenCalledTimes(1);
  });

  test("clicking back pill calls onBackClick", async () => {
    const onBackClick = vi.fn();
    render(
      <StreamScrollIndicator
        {...defaultProps}
        showBackButton={true}
        onBackClick={onBackClick}
      />
    );
    await userEvent.click(screen.getByText("Back"));
    expect(onBackClick).toHaveBeenCalledTimes(1);
  });
});

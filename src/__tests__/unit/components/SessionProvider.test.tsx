// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSessionProvider = vi.fn();

vi.mock("next-auth/react", () => ({
  SessionProvider: (props: Record<string, unknown>) => {
    mockSessionProvider(props);
    return React.createElement(React.Fragment, null, props.children as React.ReactNode);
  },
}));

import SessionProvider from "@/providers/SessionProvider";

describe("SessionProvider", () => {
  beforeEach(() => {
    mockSessionProvider.mockClear();
  });

  it("passes refetchOnWindowFocus={false} to NextAuthSessionProvider", () => {
    render(<SessionProvider><div /></SessionProvider>);
    expect(mockSessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ refetchOnWindowFocus: false })
    );
  });

  it("passes refetchWhenOffline={false} to NextAuthSessionProvider", () => {
    render(<SessionProvider><div /></SessionProvider>);
    expect(mockSessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ refetchWhenOffline: false })
    );
  });
});

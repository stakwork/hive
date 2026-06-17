// @vitest-environment jsdom
/**
 * Unit tests for SidebarChatMessage attachment rendering.
 *
 * Focuses on:
 * 1. Renders <img> for image/png attachment
 * 2. Renders <video> for video/mp4 attachment
 * 3. Renders download <a> for application/pdf attachment
 * 4. Click-to-enlarge dialog for images
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Next.js navigation mocks ──────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/org/test-org",
  useSearchParams: () => new URLSearchParams(),
}));

// ── framer-motion mock ────────────────────────────────────────────────────────
vi.mock("framer-motion", () => {
  const React = require("react");
  return {
    motion: {
      div: ({ children, initial: _i, animate: _a, transition: _t, ...props }: Record<string, unknown>) =>
        React.createElement("div", props, children),
    },
    AnimatePresence: ({ children }: { children: unknown }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// ── MarkdownRenderer mock ─────────────────────────────────────────────────────
vi.mock("@/components/MarkdownRenderer", () => {
  const React = require("react");
  return {
    MarkdownRenderer: ({ children }: { children: unknown }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// ── Component import (after mocks) ────────────────────────────────────────────
import { SidebarChatMessage } from "@/app/org/[githubLogin]/_components/SidebarChatMessage";

const baseMessage = {
  id: "msg-1",
  role: "user" as const,
  content: "Look at this file",
  timestamp: new Date(),
};

describe("SidebarChatMessage — attachment rendering", () => {
  it("renders <img> for image/png attachment", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/photo.png",
              filename: "photo.png",
              mimeType: "image/png",
              size: 1024,
            },
          ],
        }}
      />,
    );

    const img = screen.getByAltText("photo.png") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
    expect(img.src).toContain(
      encodeURIComponent("uploads/ws-1/canvas/photo.png"),
    );
  });

  it("renders <video> for video/mp4 attachment", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/clip.mp4",
              filename: "clip.mp4",
              mimeType: "video/mp4",
              size: 4096,
            },
          ],
        }}
      />,
    );

    const container = screen.getByTestId("attachment-video-clip.mp4");
    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.controls).toBe(true);
    expect(video?.src).toContain(
      encodeURIComponent("uploads/ws-1/canvas/clip.mp4"),
    );
  });

  it("renders download <a> for application/pdf attachment", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/doc.pdf",
              filename: "doc.pdf",
              mimeType: "application/pdf",
              size: 2048,
            },
          ],
        }}
      />,
    );

    const link = screen.getByText("doc.pdf").closest("a") as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link.download).toBe("doc.pdf");
    expect(link.href).toContain(
      encodeURIComponent("uploads/ws-1/canvas/doc.pdf"),
    );
  });

  it("opens enlarged image dialog on click", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/photo.png",
              filename: "photo.png",
              mimeType: "image/png",
              size: 1024,
            },
          ],
        }}
      />,
    );

    // Dialog not present initially
    expect(
      screen.queryByTestId("enlarged-image-dialog"),
    ).not.toBeInTheDocument();

    // Click the attachment container
    const attachmentDiv = screen.getByTestId("attachment-image-photo.png");
    fireEvent.click(attachmentDiv);

    // Dialog should now be present
    expect(screen.getByTestId("enlarged-image-dialog")).toBeInTheDocument();
  });

  it("closes enlarged image dialog on backdrop click", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/photo.png",
              filename: "photo.png",
              mimeType: "image/png",
              size: 1024,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("attachment-image-photo.png"));
    expect(screen.getByTestId("enlarged-image-dialog")).toBeInTheDocument();

    // Click backdrop to close
    fireEvent.click(screen.getByTestId("enlarged-image-dialog"));
    expect(
      screen.queryByTestId("enlarged-image-dialog"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when no content and no attachments", () => {
    const { container } = render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          content: "",
          attachments: [],
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders multiple attachments with correct MIME branching", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          attachments: [
            {
              path: "uploads/ws-1/canvas/photo.png",
              filename: "photo.png",
              mimeType: "image/png",
              size: 1024,
            },
            {
              path: "uploads/ws-1/canvas/doc.pdf",
              filename: "doc.pdf",
              mimeType: "application/pdf",
              size: 2048,
            },
          ],
        }}
      />,
    );

    expect(screen.getByAltText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });

  it("renders text bubble and attachments together", () => {
    render(
      <SidebarChatMessage
        message={{
          ...baseMessage,
          content: "Here is my screenshot",
          attachments: [
            {
              path: "uploads/ws-1/canvas/screen.png",
              filename: "screen.png",
              mimeType: "image/png",
              size: 512,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Here is my screenshot")).toBeInTheDocument();
    expect(screen.getByAltText("screen.png")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
/**
 * Tests for src/components/ui/file-drop-zone.tsx
 * Covers the .env/.txt text-read path, disabled state, and drag overlay.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FileDropZone } from "@/components/ui/file-drop-zone";

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) =>
    classes.filter(Boolean).join(" "),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(content: string, name: string, type = "") {
  const file = new File([content], name, { type });
  // jsdom File doesn't always implement .text() — polyfill it
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(content),
      configurable: true,
    });
  }
  return file;
}

function createDataTransfer(files: File[]) {
  return {
    files: Object.assign([...files], {
      length: files.length,
      item: (i: number) => files[i],
    }),
    types: ["Files"],
    items: files.map((f) => ({
      kind: "file",
      type: f.type,
      getAsFile: () => f,
    })),
  } as unknown as DataTransfer;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FileDropZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("text-read path", () => {
    it("reads .env file content and calls onFileContent", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const envFile = makeFile("DATABASE_URL=postgres://localhost/db", ".env");

      fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([envFile]) });

      await waitFor(() => {
        expect(onFileContent).toHaveBeenCalledWith(
          "DATABASE_URL=postgres://localhost/db",
          ".env"
        );
      });
    });

    it("reads .txt file content and calls onFileContent", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const txtFile = makeFile("hello world", "config.txt", "text/plain");

      fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([txtFile]) });

      await waitFor(() => {
        expect(onFileContent).toHaveBeenCalledWith("hello world", "config.txt");
      });
    });

    it("does not call onFileContent for unsupported file types (e.g. .pdf)", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const pdfFile = makeFile("binary", "doc.pdf", "application/pdf");

      fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([pdfFile]) });

      await new Promise((r) => setTimeout(r, 50));
      expect(onFileContent).not.toHaveBeenCalled();
    });

    it("reads file selected via click/file-input", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const fileInput = document.querySelector('input[type="file"]')!;
      const envFile = makeFile("SECRET=abc123", ".env");

      await act(async () => {
        Object.defineProperty(fileInput, "files", {
          value: Object.assign([envFile], { length: 1, item: () => envFile }),
          configurable: true,
        });
        fireEvent.change(fileInput);
      });

      await waitFor(() => {
        expect(onFileContent).toHaveBeenCalledWith("SECRET=abc123", ".env");
      });
    });
  });

  describe("disabled state", () => {
    it("does not show drag overlay when disabled", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} disabled />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      fireEvent.dragEnter(dropZone, { dataTransfer: createDataTransfer([]) });

      expect(screen.queryByText("Drop your file here")).not.toBeInTheDocument();
    });

    it("does not call onFileContent when disabled and file is dropped", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} disabled />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const envFile = makeFile("KEY=VALUE", ".env");

      fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([envFile]) });

      await new Promise((r) => setTimeout(r, 50));
      expect(onFileContent).not.toHaveBeenCalled();
    });

    it("does not call preventDefault on dragover when disabled (allows native browser handling)", () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} disabled />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const e = new Event("dragover", { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(e, "preventDefault");

      dropZone.dispatchEvent(e);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe("drag overlay", () => {
    it("shows 'Drop your file here' text on dragenter", () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      fireEvent.dragEnter(dropZone, { dataTransfer: createDataTransfer([]) });

      expect(screen.getByText("Drop your file here")).toBeInTheDocument();
    });

    it("hides overlay after drop", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      const envFile = makeFile("X=1", ".env");

      fireEvent.dragEnter(dropZone, { dataTransfer: createDataTransfer([envFile]) });
      expect(screen.getByText("Drop your file here")).toBeInTheDocument();

      fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([envFile]) });

      await waitFor(() => {
        expect(screen.queryByText("Drop your file here")).not.toBeInTheDocument();
      });
    });

    it("overlay clears via window drop (out-of-element drag)", async () => {
      const onFileContent = vi.fn();
      render(<FileDropZone onFileContent={onFileContent} />);

      const dropZone = screen.getByText(/Drop .env file/i).closest("div")!;
      fireEvent.dragEnter(dropZone, { dataTransfer: createDataTransfer([]) });
      expect(screen.getByText("Drop your file here")).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event("drop", { bubbles: true }));
      });

      await waitFor(() => {
        expect(screen.queryByText("Drop your file here")).not.toBeInTheDocument();
      });
    });
  });
});
